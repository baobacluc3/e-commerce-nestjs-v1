import { z } from 'zod';

export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters long'),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  STRIPE_SECRET_KEY: z.string().min(1).default('sk_test_local_placeholder'),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .default('whsec_test_local_placeholder'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  ORDER_EXPIRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(10)
    .default(30 * 60 * 1000),
  QUEUE_MAX_RETRIES: z.coerce.number().int().min(1).max(20).default(3),
  QUEUE_BACKOFF_DELAY_MS: z.coerce.number().int().min(10).default(1000),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
