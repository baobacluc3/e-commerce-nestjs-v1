import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from './env.validation';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  get nodeEnv(): Environment['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get logLevel(): Environment['LOG_LEVEL'] {
    return this.config.get('LOG_LEVEL', { infer: true });
  }

  get jwtAccessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  get jwtAccessTtl(): string {
    return this.config.get('JWT_ACCESS_TTL', { infer: true });
  }

  get refreshTokenTtlDays(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  get stripeSecretKey(): string {
    return this.config.get('STRIPE_SECRET_KEY', { infer: true });
  }

  get stripeWebhookSecret(): string {
    return this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  get redisUrl(): string {
    return (
      this.config.get('REDIS_URL', { infer: true }) ?? 'redis://localhost:6379'
    );
  }

  get orderExpiryDelayMs(): number {
    return (
      this.config.get('ORDER_EXPIRY_DELAY_MS', { infer: true }) ??
      30 * 60 * 1000
    );
  }

  get queueMaxRetries(): number {
    return this.config.get('QUEUE_MAX_RETRIES', { infer: true }) ?? 3;
  }

  get queueBackoffDelayMs(): number {
    return this.config.get('QUEUE_BACKOFF_DELAY_MS', { infer: true }) ?? 1000;
  }
}
