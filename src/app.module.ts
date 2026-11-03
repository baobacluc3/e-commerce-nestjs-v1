import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { QueuesModule } from './queues/queues.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          transport:
            config.nodeEnv === 'production'
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { colorize: true, singleLine: true },
                },
          genReqId: (request, response) => {
            const header = request.headers['x-request-id'];
            const requestId =
              typeof header === 'string' && /^[\w.-]{1,128}$/.test(header)
                ? header
                : randomUUID();
            response.setHeader('x-request-id', requestId);
            return requestId;
          },
          customProps: (request) => ({ requestId: request.id }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'password',
              'token',
              '*.password',
              '*.token',
              '*.*.password',
              '*.*.token',
              '*.*.*.password',
              '*.*.*.token',
              '*.*.*.*.password',
              '*.*.*.*.token',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        {
          ttl: 60000,
          limit: config.nodeEnv === 'test' ? 10000 : 100,
        },
      ],
    }),
    PrismaModule,
    QueuesModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    InventoryModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
