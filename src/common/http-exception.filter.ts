import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string[];
  path: string;
  timestamp: string;
  requestId: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const middlewareRequestId = request.id;
    const requestId =
      typeof middlewareRequestId === 'string'
        ? middlewareRequestId
        : (request.header('x-request-id') ?? 'unknown');

    if (statusCode >= 500) {
      this.logger.error({ err: exception, requestId }, 'Request failed');
    }

    const result: ErrorResponse = {
      statusCode,
      error: this.getErrorName(exception, statusCode),
      message: this.getMessages(exception, statusCode),
      path: request.path,
      timestamp: new Date().toISOString(),
      requestId,
    };

    response.status(statusCode).json(result);
  }

  private getErrorName(exception: unknown, statusCode: number): string {
    if (exception instanceof HttpException && statusCode < 500) {
      const body: unknown = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const error = body.error;
        if (typeof error === 'string') {
          return error;
        }
      }
    }

    return (
      HttpStatus[statusCode]
        ?.toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase()) ??
      'Internal Server Error'
    );
  }

  private getMessages(exception: unknown, statusCode: number): string[] {
    if (statusCode >= 500) {
      return [
        statusCode === 503 ? 'Service unavailable' : 'Internal server error',
      ];
    }

    if (exception instanceof HttpException) {
      const body: unknown = exception.getResponse();
      if (typeof body === 'string') {
        return [body];
      }
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const message = body.message;
        if (typeof message === 'string') {
          return [message];
        }
        if (Array.isArray(message)) {
          return message.filter(
            (item): item is string => typeof item === 'string',
          );
        }
      }
    }

    return ['Request failed'];
  }
}
