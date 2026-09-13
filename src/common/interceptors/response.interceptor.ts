import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RequestContextService } from '../context/request-context.service';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { ResponseEnvelope } from './response-envelope.interface';

const DEFAULT_MESSAGES: Record<string, string> = {
  GET: 'Request successful',
  POST: 'Resource created successfully',
  PUT: 'Resource updated successfully',
  PATCH: 'Resource updated successfully',
  DELETE: 'Resource deleted successfully',
};

/**
 * Wraps every response in a uniform envelope. Phase 1 extracted source —
 * copied from TravelOS, classified REUSABLE.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<T> | T> {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<ResponseEnvelope<T> | T> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, ctx.getHandler()) ??
      DEFAULT_MESSAGES[request.method] ??
      'Request successful';

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) {
          return data;
        }
        return {
          success: true,
          message,
          data,
          errors: [],
          traceId: this.context.traceId,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
