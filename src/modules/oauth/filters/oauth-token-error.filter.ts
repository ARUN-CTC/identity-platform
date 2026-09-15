import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { OAuthTokenError } from '../errors';

/**
 * Phase 2D.4 — scoped to `TokenController` only (`@UseFilters`), never
 * registered globally: this platform's own controllers keep their existing
 * error shape untouched. Its only job beyond what `HttpException`'s default
 * handling already does is attaching `WWW-Authenticate: Basic` to an
 * `invalid_client` (401) response, per RFC 6749 §5.2 / RFC 7617 — the one
 * piece of standard behavior a plain `HttpException` response body can't
 * express by itself.
 */
@Catch(OAuthTokenError)
export class OAuthTokenErrorFilter implements ExceptionFilter {
  catch(exception: OAuthTokenError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    if (status === HttpStatus.UNAUTHORIZED) {
      response.setHeader('WWW-Authenticate', 'Basic realm="oauth"');
    }
    response.status(status).json(exception.getResponse());
  }
}
