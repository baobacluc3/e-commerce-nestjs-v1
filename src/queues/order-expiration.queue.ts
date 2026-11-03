import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { AppConfigService } from '../config/app-config.service';
import {
  buildDeadLetterJobId,
  buildOrderExpirationJobId,
  calculateExponentialBackoff,
  DEAD_LETTER_JOB,
  DeadLetterJobData,
  DEFAULT_ORDER_EXPIRY_DELAY_MS,
  DEFAULT_QUEUE_BACKOFF_DELAY_MS,
  DEFAULT_QUEUE_MAX_RETRIES,
  EXPIRE_UNPAID_ORDER_JOB,
  ORDER_EXPIRATION_DLQ,
  ORDER_EXPIRATION_QUEUE,
  OrderExpirationJobData,
  OrderExpirationJobResult,
  parseRedisConnectionOptions,
  TrackedOrderExpirationJob,
  WORKER_LOCK_DURATION_MS,
  WORKER_MAX_STALLED_COUNT,
  WORKER_STALLED_INTERVAL_MS,
} from './queue.constants';

export type OrderExpirationProcessorFn = (
  data: OrderExpirationJobData,
  attempt: number,
) => Promise<OrderExpirationJobResult>;

/**
 * Error representing an abrupt worker termination (e.g. SIGKILL / OOM / process crash)
 * while a job is mid-flight before BullMQ receives a completion or failure ACK.
 */
export class WorkerTerminatedError extends Error {
  readonly isWorkerCrash = true;

  constructor(
    message = 'Worker process terminated abruptly mid-job before acknowledging completion',
  ) {
    super(message);
    this.name = 'WorkerTerminatedError';
  }
}

@Injectable()
export class OrderExpirationQueueService
  implements OnModuleInit, BeforeApplicationShutdown, OnModuleDestroy
{
  private readonly logger = new Logger(OrderExpirationQueueService.name);

  private orderExpirationQueue?: Queue<
    OrderExpirationJobData,
    OrderExpirationJobResult
  >;
  private deadLetterQueue?: Queue<DeadLetterJobData>;
  private worker?: Worker<OrderExpirationJobData, OrderExpirationJobResult>;

  private processor?: OrderExpirationProcessorFn;
  private isShuttingDown = false;
  private isClosed = false;

  private readonly jobs = new Map<string, TrackedOrderExpirationJob>();
  private readonly deadLetterJobs = new Map<string, DeadLetterJobData>();
  private readonly inFlightPromises = new Set<Promise<unknown>>();

  constructor(private readonly config: AppConfigService) {}

  get defaultDelayMs(): number {
    return this.config.orderExpiryDelayMs ?? DEFAULT_ORDER_EXPIRY_DELAY_MS;
  }

  get maxRetries(): number {
    return this.config.queueMaxRetries ?? DEFAULT_QUEUE_MAX_RETRIES;
  }

  get backoffDelayMs(): number {
    return this.config.queueBackoffDelayMs ?? DEFAULT_QUEUE_BACKOFF_DELAY_MS;
  }

  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  get inFlightCount(): number {
    return this.inFlightPromises.size;
  }

  /**
   * Registers the idempotent job handler (provided by OrdersService).
   */
  registerProcessor(processor: OrderExpirationProcessorFn): void {
    this.processor = processor;
  }

  onModuleInit(): void {
    if (this.config.nodeEnv !== 'test' && process.env.NODE_ENV !== 'test') {
      this.initializeBullMQ();
    }
  }

  /**
   * Initializes BullMQ Queue, Dead-Letter Queue, and Worker instances backed by Redis.
   */
  initializeBullMQ(): void {
    if (this.orderExpirationQueue || this.worker) {
      return;
    }

    const connection = parseRedisConnectionOptions(this.config.redisUrl);

    this.orderExpirationQueue = new Queue<
      OrderExpirationJobData,
      OrderExpirationJobResult
    >(ORDER_EXPIRATION_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: this.maxRetries,
        backoff: {
          type: 'exponential',
          delay: this.backoffDelayMs,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 3600,
        },
        removeOnFail: false,
      },
    });

    this.deadLetterQueue = new Queue<DeadLetterJobData>(ORDER_EXPIRATION_DLQ, {
      connection,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    this.worker = new Worker<OrderExpirationJobData, OrderExpirationJobResult>(
      ORDER_EXPIRATION_QUEUE,
      async (job: Job<OrderExpirationJobData, OrderExpirationJobResult>) => {
        return this.handleBullJob(job);
      },
      {
        connection: parseRedisConnectionOptions(this.config.redisUrl),
        concurrency: 5,
        lockDuration: WORKER_LOCK_DURATION_MS,
        stalledInterval: WORKER_STALLED_INTERVAL_MS,
        maxStalledCount: WORKER_MAX_STALLED_COUNT,
      },
    );

    this.worker.on('failed', (job, error) => {
      if (!job) {
        return;
      }
      const maxAttempts = job.opts.attempts ?? this.maxRetries;
      if (job.attemptsMade >= maxAttempts) {
        void this.moveToDeadLetterQueue({
          originalJobId: job.id ?? buildOrderExpirationJobId(job.data.orderId),
          originalJobName: job.name,
          data: job.data,
          failedReason: error.message,
          stacktrace: job.stacktrace?.length
            ? job.stacktrace
            : error.stack
              ? [error.stack]
              : [],
          attemptsMade: job.attemptsMade,
          maxAttempts,
        }).catch((dlqErr: unknown) => {
          this.logger.error(
            `Failed to push exhausted job '${job.id}' to DLQ`,
            dlqErr instanceof Error ? dlqErr.stack : String(dlqErr),
          );
        });
      }
    });

    this.worker.on('error', (err) => {
      this.logger.error(`BullMQ worker error: ${err.message}`, err.stack);
    });
  }

  /**
   * Internal handler invoked by the BullMQ Worker when processing a Redis job.
   */
  async handleBullJob(
    job: Job<OrderExpirationJobData, OrderExpirationJobResult>,
  ): Promise<OrderExpirationJobResult> {
    if (!this.processor) {
      throw new Error('No order expiration processor registered');
    }

    const attempt = job.attemptsMade + 1;
    const taskPromise = this.processor(job.data, attempt);
    this.trackInFlight(taskPromise);

    try {
      return await taskPromise;
    } finally {
      this.inFlightPromises.delete(taskPromise);
    }
  }

  /**
   * Enqueues a delayed job to auto-cancel an unpaid order after 30 minutes (by default).
   * Uses a deterministic jobId (`expire-order-${orderId}`) so duplicate enqueue calls
   * for the same order are idempotent no-ops.
   */
  async enqueueOrderExpiration(
    orderId: string,
    options?: {
      userId?: string;
      expiresAt?: Date;
      delayMs?: number;
    },
  ): Promise<TrackedOrderExpirationJob> {
    const jobId = buildOrderExpirationJobId(orderId);
    const existing = this.jobs.get(jobId);

    // BullMQ deduplicates jobs sharing an existing jobId in the queue
    if (existing && existing.state !== 'failed') {
      return existing;
    }

    const delay = options?.delayMs ?? this.defaultDelayMs;
    const now = new Date();
    const data: OrderExpirationJobData = {
      orderId,
      userId: options?.userId,
      expiresAt: options?.expiresAt?.toISOString(),
      enqueuedAt: now.toISOString(),
    };

    const trackedJob: TrackedOrderExpirationJob = {
      id: jobId,
      name: EXPIRE_UNPAID_ORDER_JOB,
      data,
      delay,
      maxAttempts: this.maxRetries,
      backoffDelayMs: this.backoffDelayMs,
      attemptsMade: 0,
      backoffHistoryMs: [],
      state: delay > 0 ? 'delayed' : 'waiting',
      stalledCount: 0,
      stacktrace: [],
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(jobId, trackedJob);

    if (this.orderExpirationQueue && !this.isShuttingDown) {
      await this.orderExpirationQueue.add(EXPIRE_UNPAID_ORDER_JOB, data, {
        jobId,
        delay,
        attempts: this.maxRetries,
        backoff: {
          type: 'exponential',
          delay: this.backoffDelayMs,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 3600,
        },
        removeOnFail: false,
      });
    }

    return trackedJob;
  }

  /**
   * Processes a specific order expiration job through the worker pipeline,
   * applying exponential backoff retries on transient errors and routing
   * to the Dead-Letter Queue (`order-expiration-dlq`) when retries are exhausted.
   *
   * If the job is already completed (or invoked a second time for the same order),
   * the processor still runs against the database idempotently to prove that
   * running the same job twice changes nothing.
   */
  async processOrderExpirationJob(
    orderIdOrJobId: string,
  ): Promise<OrderExpirationJobResult> {
    if (this.isShuttingDown) {
      throw new Error(
        'Cannot start new job while worker is shutting down gracefully',
      );
    }

    if (!this.processor) {
      throw new Error('No order expiration processor registered');
    }

    const jobId = orderIdOrJobId.startsWith('expire-order-')
      ? orderIdOrJobId
      : buildOrderExpirationJobId(orderIdOrJobId);
    const orderId = orderIdOrJobId.startsWith('expire-order-')
      ? orderIdOrJobId.slice('expire-order-'.length)
      : orderIdOrJobId;

    let job = this.jobs.get(jobId);
    if (!job) {
      job = await this.enqueueOrderExpiration(orderId, { delayMs: 0 });
    }

    const executionPromise = this.runJobExecutionLoop(job);
    this.trackInFlight(executionPromise);

    try {
      return await executionPromise;
    } finally {
      this.inFlightPromises.delete(executionPromise);
    }
  }

  private async runJobExecutionLoop(
    job: TrackedOrderExpirationJob,
  ): Promise<OrderExpirationJobResult> {
    if (!this.processor) {
      throw new Error('No order expiration processor registered');
    }

    // If re-running an already completed job (to verify idempotency),
    // execute the processor directly and update returnvalue.
    if (job.state === 'completed') {
      job.state = 'active';
      job.attemptsMade += 1;
      job.updatedAt = new Date();
      const result = await this.processor(job.data, job.attemptsMade);
      job.state = 'completed';
      job.returnvalue = result;
      job.updatedAt = new Date();
      return result;
    }

    while (job.attemptsMade < job.maxAttempts) {
      job.state = 'active';
      job.updatedAt = new Date();

      const currentAttempt = job.attemptsMade + 1;

      try {
        const result = await this.processor(job.data, currentAttempt);
        job.attemptsMade = currentAttempt;
        job.state = 'completed';
        job.returnvalue = result;
        job.failedReason = undefined;
        job.updatedAt = new Date();
        return result;
      } catch (error) {
        // If the worker process was killed mid-job (SIGKILL / crash),
        // the job is NOT marked completed or failed in Redis; it remains 'active' (stalled)
        // with its previous attemptsMade count so stalled-job recovery will re-deliver it.
        if (
          error instanceof WorkerTerminatedError ||
          (error instanceof Error &&
            (error as { isWorkerCrash?: boolean }).isWorkerCrash === true)
        ) {
          job.state = 'active';
          job.updatedAt = new Date();
          throw error;
        }

        job.attemptsMade = currentAttempt;
        const errMessage =
          error instanceof Error ? error.message : String(error);
        const errStack =
          error instanceof Error && error.stack ? error.stack : errMessage;

        job.failedReason = errMessage;
        job.stacktrace.push(errStack);
        job.updatedAt = new Date();

        if (job.attemptsMade < job.maxAttempts) {
          const backoffMs = calculateExponentialBackoff(
            job.attemptsMade,
            job.backoffDelayMs,
          );
          job.backoffHistoryMs.push(backoffMs);
          job.state = 'delayed';
          job.updatedAt = new Date();
          continue;
        }

        // All retry attempts exhausted -> mark failed and route to Dead-Letter Queue
        job.state = 'failed';
        job.updatedAt = new Date();

        await this.moveToDeadLetterQueue({
          originalJobId: job.id,
          originalJobName: job.name,
          data: job.data,
          failedReason: errMessage,
          stacktrace: [...job.stacktrace],
          attemptsMade: job.attemptsMade,
          maxAttempts: job.maxAttempts,
        });

        throw error;
      }
    }

    throw new Error(
      `Job '${job.id}' already exhausted all ${job.maxAttempts} attempts`,
    );
  }

  /**
   * Recovers jobs that were left in 'active' (stalled) state when a worker was killed mid-job,
   * moving them back to 'waiting' and re-processing them to completion.
   * Mirrors BullMQ's stalled-job recovery mechanism (`stalledInterval` / `maxStalledCount`).
   */
  async recoverStalledJobs(): Promise<OrderExpirationJobResult[]> {
    const stalledJobs = Array.from(this.jobs.values()).filter(
      (job) => job.state === 'active',
    );

    const results: OrderExpirationJobResult[] = [];
    for (const job of stalledJobs) {
      job.stalledCount += 1;
      job.state = 'waiting';
      job.updatedAt = new Date();

      const res = await this.processOrderExpirationJob(job.id);
      results.push(res);
    }

    return results;
  }

  /**
   * Promotes and processes all delayed jobs whose delay window has elapsed.
   */
  async processDueJobs(): Promise<OrderExpirationJobResult[]> {
    const dueJobs = Array.from(this.jobs.values()).filter(
      (job) => job.state === 'delayed' || job.state === 'waiting',
    );

    const results: OrderExpirationJobResult[] = [];
    for (const job of dueJobs) {
      if (this.isShuttingDown) {
        break;
      }
      const res = await this.processOrderExpirationJob(job.id);
      results.push(res);
    }

    return results;
  }

  /**
   * Moves an exhausted job into the Dead-Letter Queue (`order-expiration-dlq`).
   */
  async moveToDeadLetterQueue(params: {
    originalJobId: string;
    originalJobName: string;
    data: OrderExpirationJobData;
    failedReason: string;
    stacktrace: string[];
    attemptsMade: number;
    maxAttempts: number;
  }): Promise<DeadLetterJobData> {
    const dlqJobId = buildDeadLetterJobId(
      params.originalJobId,
      params.attemptsMade,
    );

    const dlqEntry: DeadLetterJobData = {
      dlqJobId,
      originalQueue: ORDER_EXPIRATION_QUEUE,
      originalJobId: params.originalJobId,
      originalJobName: params.originalJobName,
      data: params.data,
      failedReason: params.failedReason,
      stacktrace: params.stacktrace,
      attemptsMade: params.attemptsMade,
      maxAttempts: params.maxAttempts,
      failedAt: new Date().toISOString(),
    };

    this.deadLetterJobs.set(dlqJobId, dlqEntry);

    if (this.deadLetterQueue && !this.isShuttingDown) {
      await this.deadLetterQueue.add(DEAD_LETTER_JOB, dlqEntry, {
        jobId: dlqJobId,
      });
    }

    return dlqEntry;
  }

  /**
   * Replays a job from the Dead-Letter Queue by resetting its retry counters
   * and re-running it through the main `order-expiration` pipeline.
   */
  async retryDeadLetterJob(
    dlqJobId: string,
  ): Promise<OrderExpirationJobResult> {
    const dlqEntry = this.deadLetterJobs.get(dlqJobId);
    if (!dlqEntry) {
      throw new Error(`Dead-letter job '${dlqJobId}' not found`);
    }

    const job = this.jobs.get(dlqEntry.originalJobId);
    if (job) {
      job.attemptsMade = 0;
      job.state = 'waiting';
      job.failedReason = undefined;
      job.stacktrace = [];
      job.updatedAt = new Date();
    }

    const result = await this.processOrderExpirationJob(dlqEntry.data.orderId);
    this.deadLetterJobs.delete(dlqJobId);
    return result;
  }

  getJob(orderIdOrJobId: string): TrackedOrderExpirationJob | undefined {
    const jobId = orderIdOrJobId.startsWith('expire-order-')
      ? orderIdOrJobId
      : buildOrderExpirationJobId(orderIdOrJobId);
    return this.jobs.get(jobId);
  }

  getAllJobs(): TrackedOrderExpirationJob[] {
    return Array.from(this.jobs.values());
  }

  getDeadLetterJobs(): DeadLetterJobData[] {
    return Array.from(this.deadLetterJobs.values());
  }

  clearTrackedJobs(): void {
    this.jobs.clear();
    this.deadLetterJobs.clear();
  }

  private trackInFlight(promise: Promise<unknown>): void {
    const settled = promise.then(
      () => undefined,
      () => undefined,
    );
    this.inFlightPromises.add(settled);
    void settled.finally(() => {
      this.inFlightPromises.delete(settled);
    });
  }

  /**
   * Graceful shutdown hook:
   * 1. Stops accepting new jobs (`isShuttingDown = true`).
   * 2. Waits for all active in-flight jobs to complete and commit their DB transactions.
   * 3. Closes BullMQ Worker, main Queue, and Dead-Letter Queue Redis connections cleanly.
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.gracefulShutdown();
  }

  async onModuleDestroy(): Promise<void> {
    await this.gracefulShutdown();
  }

  async gracefulShutdown(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isShuttingDown = true;

    if (this.inFlightPromises.size > 0) {
      await Promise.allSettled(Array.from(this.inFlightPromises));
    }

    if (this.worker) {
      await this.worker.close();
      this.worker = undefined;
    }

    if (this.orderExpirationQueue) {
      await this.orderExpirationQueue.close();
      this.orderExpirationQueue = undefined;
    }

    if (this.deadLetterQueue) {
      await this.deadLetterQueue.close();
      this.deadLetterQueue = undefined;
    }

    this.isClosed = true;
  }
}
