import type { ConnectionOptions } from 'bullmq';

export const ORDER_EXPIRATION_QUEUE = 'order-expiration';
export const ORDER_EXPIRATION_DLQ = 'order-expiration-dlq';

export const EXPIRE_UNPAID_ORDER_JOB = 'expire-unpaid-order';
export const DEAD_LETTER_JOB = 'dead-letter-order-expiration';

export const DEFAULT_ORDER_EXPIRY_DELAY_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_QUEUE_MAX_RETRIES = 3;
export const DEFAULT_QUEUE_BACKOFF_DELAY_MS = 1000;

export const WORKER_LOCK_DURATION_MS = 30_000;
export const WORKER_STALLED_INTERVAL_MS = 5_000;
export const WORKER_MAX_STALLED_COUNT = 3;

export interface OrderExpirationJobData {
  orderId: string;
  userId?: string;
  expiresAt?: string;
  enqueuedAt?: string;
}

export interface OrderExpirationJobResult {
  orderId: string;
  cancelled: boolean;
  status: string;
  restockedItemsCount: number;
  idempotentSkip: boolean;
}

export interface DeadLetterJobData {
  dlqJobId: string;
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  data: OrderExpirationJobData;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  maxAttempts: number;
  failedAt: string;
}

export type TrackedJobState =
  'delayed' | 'waiting' | 'active' | 'completed' | 'failed';

export interface TrackedOrderExpirationJob {
  id: string;
  name: string;
  data: OrderExpirationJobData;
  delay: number;
  maxAttempts: number;
  backoffDelayMs: number;
  attemptsMade: number;
  backoffHistoryMs: number[];
  state: TrackedJobState;
  stalledCount: number;
  failedReason?: string;
  stacktrace: string[];
  returnvalue?: OrderExpirationJobResult;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Deterministic job ID for order expiration.
 * Note: BullMQ v5+ forbids ':' in custom jobIds, so we use hyphens.
 */
export function buildOrderExpirationJobId(orderId: string): string {
  return `expire-order-${orderId}`;
}

/**
 * Deterministic job ID for Dead-Letter Queue entries.
 */
export function buildDeadLetterJobId(
  originalJobId: string,
  attemptsMade: number,
): string {
  return `dlq-${originalJobId}-attempt-${attemptsMade}`;
}

/**
 * Calculates exponential backoff delay in milliseconds:
 * attempt 1 -> baseDelay * 2^0
 * attempt 2 -> baseDelay * 2^1
 * attempt 3 -> baseDelay * 2^2
 */
export function calculateExponentialBackoff(
  attempt: number,
  baseDelayMs: number = DEFAULT_QUEUE_BACKOFF_DELAY_MS,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return baseDelayMs * Math.pow(2, normalizedAttempt - 1);
}

/**
 * Parses a Redis URL into BullMQ-compatible ConnectionOptions.
 * BullMQ requires `maxRetriesPerRequest: null` for blocking worker connections.
 */
export function parseRedisConnectionOptions(
  redisUrl: string,
): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const dbPath = parsed.pathname?.replace(/^\//, '');
  const db = dbPath ? Number.parseInt(dbPath, 10) : 0;

  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isNaN(db) ? 0 : db,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
