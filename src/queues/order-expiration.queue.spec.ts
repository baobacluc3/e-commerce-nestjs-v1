import { AppConfigService } from '../config/app-config.service';
import {
  OrderExpirationQueueService,
  WorkerTerminatedError,
} from './order-expiration.queue';
import {
  buildDeadLetterJobId,
  buildOrderExpirationJobId,
  calculateExponentialBackoff,
  DEFAULT_ORDER_EXPIRY_DELAY_MS,
  EXPIRE_UNPAID_ORDER_JOB,
  ORDER_EXPIRATION_DLQ,
  ORDER_EXPIRATION_QUEUE,
  OrderExpirationJobResult,
  parseRedisConnectionOptions,
} from './queue.constants';

const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'mock-bull-job' });
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerOn = jest.fn();

let capturedWorkerProcessor:
  | ((job: {
      id?: string;
      name: string;
      data: { orderId: string };
      attemptsMade: number;
      opts: { attempts?: number };
    }) => Promise<OrderExpirationJobResult>)
  | undefined;

const workerEventHandlers: Record<
  string,
  Array<(...args: unknown[]) => void>
> = {};

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string, opts: unknown) => ({
    name,
    opts,
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest
    .fn()
    .mockImplementation(
      (
        name: string,
        processor: typeof capturedWorkerProcessor,
        opts: unknown,
      ) => {
        capturedWorkerProcessor = processor;
        return {
          name,
          opts,
          on: mockWorkerOn.mockImplementation(
            (event: string, handler: (...args: unknown[]) => void) => {
              workerEventHandlers[event] = workerEventHandlers[event] ?? [];
              workerEventHandlers[event].push(handler);
            },
          ),
          close: mockWorkerClose,
        };
      },
    ),
}));

describe('OrderExpirationQueueService (Phase 13 Async Backbone)', () => {
  let queueService: OrderExpirationQueueService;
  let mockConfig: Partial<AppConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedWorkerProcessor = undefined;
    for (const key of Object.keys(workerEventHandlers)) {
      delete workerEventHandlers[key];
    }

    mockConfig = {
      nodeEnv: 'test',
      redisUrl: 'redis://localhost:6379/0',
      orderExpiryDelayMs: DEFAULT_ORDER_EXPIRY_DELAY_MS,
      queueMaxRetries: 3,
      queueBackoffDelayMs: 1000,
    };

    queueService = new OrderExpirationQueueService(
      mockConfig as AppConfigService,
    );
  });

  afterEach(async () => {
    await queueService.gracefulShutdown();
  });

  describe('Queue constants & helpers', () => {
    it('builds colon-free deterministic job IDs for BullMQ v5 compatibility', () => {
      const jobId = buildOrderExpirationJobId('ord-123');
      expect(jobId).toBe('expire-order-ord-123');
      expect(jobId).not.toContain(':');

      const dlqId = buildDeadLetterJobId(jobId, 3);
      expect(dlqId).toBe('dlq-expire-order-ord-123-attempt-3');
      expect(dlqId).not.toContain(':');
    });

    it('calculates exponential backoff delays accurately (1s -> 2s -> 4s -> 8s)', () => {
      expect(calculateExponentialBackoff(1, 1000)).toBe(1000);
      expect(calculateExponentialBackoff(2, 1000)).toBe(2000);
      expect(calculateExponentialBackoff(3, 1000)).toBe(4000);
      expect(calculateExponentialBackoff(4, 1000)).toBe(8000);
    });

    it('parses Redis connection URLs including TLS and database index', () => {
      const localOpts = parseRedisConnectionOptions('redis://localhost:6379/2');
      expect(localOpts).toEqual(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          db: 2,
          tls: undefined,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
      );

      const tlsOpts = parseRedisConnectionOptions(
        'rediss://default:secretpass@redis.internal:6380/1',
      );
      expect(tlsOpts).toEqual(
        expect.objectContaining({
          host: 'redis.internal',
          port: 6380,
          username: 'default',
          password: 'secretpass',
          db: 1,
          tls: {},
          maxRetriesPerRequest: null,
        }),
      );
    });
  });

  describe('BullMQ Queue, Worker & DLQ initialization', () => {
    it('initializes BullMQ Queue, DLQ, and Worker and forwards exhausted BullMQ jobs to DLQ', async () => {
      queueService.registerProcessor(async (data) => ({
        orderId: data.orderId,
        cancelled: true,
        status: 'CANCELLED',
        restockedItemsCount: 1,
        idempotentSkip: false,
      }));

      queueService.initializeBullMQ();

      await queueService.enqueueOrderExpiration('ord-bull-1');

      expect(mockQueueAdd).toHaveBeenCalledWith(
        EXPIRE_UNPAID_ORDER_JOB,
        expect.objectContaining({ orderId: 'ord-bull-1' }),
        expect.objectContaining({
          jobId: 'expire-order-ord-bull-1',
          delay: 30 * 60 * 1000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        }),
      );

      // Verify BullMQ worker processor delegation
      expect(capturedWorkerProcessor).toBeDefined();
      const bullResult = await capturedWorkerProcessor!({
        id: 'expire-order-ord-bull-1',
        name: EXPIRE_UNPAID_ORDER_JOB,
        data: { orderId: 'ord-bull-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      });
      expect(bullResult.cancelled).toBe(true);

      // Simulate BullMQ worker 'failed' event on final attempt (attemptsMade === 3)
      const failedHandlers = workerEventHandlers['failed'] ?? [];
      expect(failedHandlers.length).toBeGreaterThan(0);

      failedHandlers[0](
        {
          id: 'expire-order-ord-bull-dlq',
          name: EXPIRE_UNPAID_ORDER_JOB,
          data: { orderId: 'ord-bull-dlq' },
          attemptsMade: 3,
          opts: { attempts: 3 },
          stacktrace: ['Error: Permanent DB outage'],
        },
        new Error('Permanent DB outage'),
      );

      // Allow async DLQ push to settle
      await new Promise((resolve) => setImmediate(resolve));

      const dlqJobs = queueService.getDeadLetterJobs();
      expect(dlqJobs).toHaveLength(1);
      expect(dlqJobs[0]).toEqual(
        expect.objectContaining({
          originalQueue: ORDER_EXPIRATION_QUEUE,
          originalJobId: 'expire-order-ord-bull-dlq',
          failedReason: 'Permanent DB outage',
          attemptsMade: 3,
          maxAttempts: 3,
        }),
      );
    });
  });

  describe('Delayed job scheduling & deduplication (30-min default)', () => {
    it('enqueues a 30-minute delayed job and deduplicates repeated enqueue calls for the same order', async () => {
      const first = await queueService.enqueueOrderExpiration('ord-30m');
      const second = await queueService.enqueueOrderExpiration('ord-30m');

      expect(first.id).toBe('expire-order-ord-30m');
      expect(first.delay).toBe(30 * 60 * 1000);
      expect(first.state).toBe('delayed');
      expect(second).toBe(first);
      expect(queueService.getAllJobs()).toHaveLength(1);
    });
  });

  describe('Retries with exponential backoff & Dead-Letter Queue (DLQ)', () => {
    it('retries transient errors with exponential backoff (1000ms, 2000ms) and succeeds on the 3rd attempt', async () => {
      let calls = 0;
      queueService.registerProcessor(async (data) => {
        calls += 1;
        if (calls < 3) {
          throw new Error(`Transient DB error on attempt ${calls}`);
        }
        return {
          orderId: data.orderId,
          cancelled: true,
          status: 'CANCELLED',
          restockedItemsCount: 2,
          idempotentSkip: false,
        };
      });

      await queueService.enqueueOrderExpiration('ord-retry-ok');
      const result =
        await queueService.processOrderExpirationJob('ord-retry-ok');

      expect(result.cancelled).toBe(true);
      expect(calls).toBe(3);

      const job = queueService.getJob('ord-retry-ok')!;
      expect(job.state).toBe('completed');
      expect(job.attemptsMade).toBe(3);
      expect(job.backoffHistoryMs).toEqual([1000, 2000]);
      expect(queueService.getDeadLetterJobs()).toHaveLength(0);
    });

    it('moves the job to the Dead-Letter Queue after exhausting all retry attempts and supports DLQ replay', async () => {
      let shouldFail = true;
      queueService.registerProcessor(async (data) => {
        if (shouldFail) {
          throw new Error('Fatal database serialization error');
        }
        return {
          orderId: data.orderId,
          cancelled: true,
          status: 'CANCELLED',
          restockedItemsCount: 1,
          idempotentSkip: false,
        };
      });

      await queueService.enqueueOrderExpiration('ord-dlq-1');

      await expect(
        queueService.processOrderExpirationJob('ord-dlq-1'),
      ).rejects.toThrow('Fatal database serialization error');

      const failedJob = queueService.getJob('ord-dlq-1')!;
      expect(failedJob.state).toBe('failed');
      expect(failedJob.attemptsMade).toBe(3);
      expect(failedJob.backoffHistoryMs).toEqual([1000, 2000]);

      const dlqJobs = queueService.getDeadLetterJobs();
      expect(dlqJobs).toHaveLength(1);
      expect(dlqJobs[0].originalQueue).toBe(ORDER_EXPIRATION_QUEUE);
      expect(dlqJobs[0].originalJobId).toBe('expire-order-ord-dlq-1');
      expect(dlqJobs[0].failedReason).toBe(
        'Fatal database serialization error',
      );
      expect(dlqJobs[0].attemptsMade).toBe(3);

      // Now fix the underlying issue and replay the job from the DLQ
      shouldFail = false;
      const replayResult = await queueService.retryDeadLetterJob(
        dlqJobs[0].dlqJobId,
      );

      expect(replayResult.cancelled).toBe(true);
      expect(queueService.getDeadLetterJobs()).toHaveLength(0);
      expect(queueService.getJob('ord-dlq-1')!.state).toBe('completed');
    });
  });

  describe('Mid-job worker crash & stalled-job recovery ("killing the worker mid-job loses nothing")', () => {
    it('keeps the job active (unacknowledged) when the worker is killed mid-job and completes it upon stalled-job recovery', async () => {
      let killWorker = true;
      queueService.registerProcessor(async (data) => {
        if (killWorker) {
          throw new WorkerTerminatedError('SIGKILL mid-transaction');
        }
        return {
          orderId: data.orderId,
          cancelled: true,
          status: 'CANCELLED',
          restockedItemsCount: 2,
          idempotentSkip: false,
        };
      });

      await queueService.enqueueOrderExpiration('ord-crash-1');

      await expect(
        queueService.processOrderExpirationJob('ord-crash-1'),
      ).rejects.toThrow(WorkerTerminatedError);

      // Job was NOT lost or marked completed; it remains 'active' (stalled in Redis)
      const stalledJob = queueService.getJob('ord-crash-1')!;
      expect(stalledJob.state).toBe('active');
      expect(stalledJob.attemptsMade).toBe(0);

      // Worker restarts and recovers stalled jobs
      killWorker = false;
      const recoveredResults = await queueService.recoverStalledJobs();

      expect(recoveredResults).toHaveLength(1);
      expect(recoveredResults[0]).toEqual({
        orderId: 'ord-crash-1',
        cancelled: true,
        status: 'CANCELLED',
        restockedItemsCount: 2,
        idempotentSkip: false,
      });

      const completedJob = queueService.getJob('ord-crash-1')!;
      expect(completedJob.state).toBe('completed');
      expect(completedJob.stalledCount).toBe(1);
    });
  });

  describe('Graceful shutdown', () => {
    it('waits for in-flight jobs to complete before closing worker and queues, and rejects new jobs during shutdown', async () => {
      let resolveInFlight!: (value: OrderExpirationJobResult) => void;
      const inFlightGate = new Promise<OrderExpirationJobResult>((resolve) => {
        resolveInFlight = resolve;
      });

      let jobCompleted = false;
      queueService.registerProcessor(async () => {
        const res = await inFlightGate;
        jobCompleted = true;
        return res;
      });

      queueService.initializeBullMQ();
      await queueService.enqueueOrderExpiration('ord-inflight-1');

      // Start processing the job (it is now mid-flight)
      const jobPromise =
        queueService.processOrderExpirationJob('ord-inflight-1');
      expect(queueService.inFlightCount).toBe(1);

      // Initiate graceful shutdown while the job is mid-flight
      let shutdownFinished = false;
      const shutdownPromise = queueService.gracefulShutdown().then(() => {
        shutdownFinished = true;
      });

      // Shutdown must wait for the in-flight job and NOT close the worker prematurely
      await new Promise((resolve) => setImmediate(resolve));
      expect(shutdownFinished).toBe(false);
      expect(mockWorkerClose).not.toHaveBeenCalled();

      // Any attempt to start a new job while shutting down is rejected
      await expect(
        queueService.processOrderExpirationJob('ord-new-during-shutdown'),
      ).rejects.toThrow('shutting down');

      // Complete the in-flight job
      resolveInFlight({
        orderId: 'ord-inflight-1',
        cancelled: true,
        status: 'CANCELLED',
        restockedItemsCount: 1,
        idempotentSkip: false,
      });

      const result = await jobPromise;
      await shutdownPromise;

      expect(jobCompleted).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(shutdownFinished).toBe(true);
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
      expect(mockQueueClose).toHaveBeenCalledTimes(2); // main queue + DLQ
      expect(ORDER_EXPIRATION_DLQ).toBe('order-expiration-dlq');
    });
  });
});
