import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/http-exception.filter';

export function configureApp(app: INestApplication): void {
  // Quick security win: secure HTTP headers with helmet
  // (contentSecurityPolicy: false allows Swagger UI scripts and styles)
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  // Quick security win: CORS allow-list
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : '*';
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(app.get(Logger)));
  app.useLogger(app.get(Logger));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('E-commerce API')
    .setDescription(
      'Production-grade E-commerce REST API built with NestJS & Prisma',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );
}
