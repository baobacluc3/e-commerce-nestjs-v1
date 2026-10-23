import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

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
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
