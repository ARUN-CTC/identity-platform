import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { RequestWithTraceId } from '../context/request-with-trace-id';
import { RequestContextService } from '../context/request-context.service';
import { AppException } from '../exceptions/app.exception';
import { ResponseEnvelope } from '../interceptors/response-envelope.interface';

interface ErrorItem {
  code: string;
  message: string;
}

const PRISMA_STATUS_MAP: Record<string, { status: HttpStatus; code: string }> = {
  P2002: { status: HttpStatus.CONFLICT, code: 'CONFLICT' },
  P2025: { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' },
  P2003: { status: HttpStatus.BAD_REQUEST, code: 'INVALID_REFERENCE' },
};

/**
 * Global exception filter — every error response, regardless of source,
 * comes out shaped the same way. Phase 1 extracted source — copied from
 * TravelOS, classified REUSABLE.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly context: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithTraceId>();
    const traceId = request?.traceId ?? this.context.traceId ?? randomUUID();

    const { status, errors, message } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception (traceId=${traceId}): ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ResponseEnvelope<null> = {
      success: false,
      message,
      data: null,
      errors: errors.map((e) => `${e.code}: ${e.message}`),
      traceId,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: HttpStatus; message: string; errors: ErrorItem[] } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        message: exception.message,
        errors: [{ code: exception.code, message: exception.message }],
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const rawMessages =
        typeof payload === 'string'
          ? [payload]
          : Array.isArray((payload as { message?: unknown }).message)
            ? (payload as { message: string[] }).message
            : [(payload as { message?: string }).message ?? exception.message];

      const code = status === HttpStatus.BAD_REQUEST ? 'VALIDATION_FAILED' : this.codeForStatus(status);

      return {
        status,
        message: rawMessages[0] ?? exception.message,
        errors: rawMessages.map((m) => ({ code, message: m })),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_STATUS_MAP[exception.code] ?? {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'DATABASE_ERROR',
      };
      const message =
        mapped.code === 'CONFLICT'
          ? `A record with the same ${(exception.meta?.target as string[] | undefined)?.join(', ') ?? 'value'} already exists`
          : mapped.code === 'NOT_FOUND'
            ? 'Record not found'
            : mapped.code === 'INVALID_REFERENCE'
              ? 'Referenced record does not exist'
              : 'A database error occurred';

      return { status: mapped.status, message, errors: [{ code: mapped.code, message }] };
    }

    if (exception instanceof Error) {
      const rawStatus =
        (exception as Error & { status?: unknown }).status ??
        (exception as Error & { statusCode?: unknown }).statusCode;
      if (
        typeof rawStatus === 'number' &&
        rawStatus >= 400 &&
        rawStatus < 600 &&
        Object.values(HttpStatus).includes(rawStatus)
      ) {
        return {
          status: rawStatus,
          message: exception.message,
          errors: [{ code: this.codeForStatus(rawStatus), message: exception.message }],
        };
      }
    }

    const message = 'An unexpected error occurred';
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      errors: [{ code: 'INTERNAL_SERVER_ERROR', message }],
    };
  }

  private codeForStatus(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'PAYLOAD_TOO_LARGE';
      default:
        return 'ERROR';
    }
  }
}
