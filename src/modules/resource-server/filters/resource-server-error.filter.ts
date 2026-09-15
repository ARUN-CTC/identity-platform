import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ResourceServerAuthError } from '../errors';

/**
 * Phase 2D.5 — scoped only to routes protected by `ExternalBearerAuthGuard`
 * (`@UseFilters`), mirroring `OAuthTokenErrorFilter`'s own scoping
 * discipline (Phase 2D.4): every other controller's error shape is
 * untouched. Attaches `WWW-Authenticate: Bearer error="..."` (RFC 6750 §3)
 * on 401/403 — the one piece of standard behavior a plain `HttpException`
 * body can't express by itself. Never includes the token, a claim value,
 * or any internal reason in the header or body (brief §24).
 */
@Catch(ResourceServerAuthError)
export class ResourceServerErrorFilter implements ExceptionFilter {
  catch(exception: ResourceServerAuthError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    if (status === HttpStatus.UNAUTHORIZED) {
      response.setHeader('WWW-Authenticate', `Bearer error="${exception.code}"`);
    } else if (status === HttpStatus.FORBIDDEN) {
      // 'insufficient_scope' carries the standard scope="..." challenge
      // parameter (RFC 6750 §3.1); 'forbidden' (Phase 2D.6 — a product-IAM/
      // resource-policy denial, not a scope failure) does not, since there
      // is no missing-scope value to name.
      response.setHeader('WWW-Authenticate', exception.code === 'insufficient_scope' ? `Bearer error="${exception.code}", scope="insufficient"` : `Bearer error="${exception.code}"`);
    }
    response.status(status).json(exception.getResponse());
  }
}
