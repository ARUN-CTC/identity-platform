import { CanActivate, ExecutionContext, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { EXPECTED_AUDIENCE_KEY } from '../decorators';
import { ExternalPrincipalContextService } from '../context';
import { GENERIC_INVALID_TOKEN_MESSAGE, ResourceServerAuthError } from '../errors';
import { AuthenticatedExternalPrincipal } from '../interfaces';
import { ExternalAccessTokenValidator } from '../services';
import { extractBearerToken } from '../utils';

export interface RequestWithExternalPrincipal extends Request {
  externalPrincipal?: AuthenticatedExternalPrincipal;
}

/**
 * Phase 2D.5 (docs/RESOURCE_SERVER_ARCHITECTURE.md §Resource Server guard)
 * — the reusable Bearer-authentication guard for the external (RS256)
 * trust boundary. Structurally independent of `JwtAuthGuard` (legacy HS256,
 * `src/modules/authentication/guards/jwt-auth.guard.ts`) — no shared code
 * path, no shared CLS store shape (`ExternalPrincipalClsStore`, not
 * `AppClsStore`), never registered as the global `APP_GUARD` (unlike
 * `JwtAuthGuard`) — a route opts into this guard explicitly via
 * `@UseGuards(ExternalBearerAuthGuard)`, exactly the opposite default
 * posture from the legacy guard, since this one protects a fundamentally
 * different kind of route (a Resource Server endpoint consuming an
 * externally-issued token, not this platform's own first-party API).
 *
 * Responsibilities, and ONLY these (brief §21): extract the bearer token,
 * validate it (`ExternalAccessTokenValidator`), validate the route's own
 * `@ExpectedAudience`, construct the principal, attach it to the request +
 * CLS, and reject anything invalid. It never issues/refreshes a token,
 * never mutates an entitlement/membership, never switches organization
 * context, never performs token exchange/impersonation, and never
 * evaluates product-specific IAM permission — all of that remains the
 * product/Resource Server's own responsibility, downstream of this guard.
 */
@Injectable()
export class ExternalBearerAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly validator: ExternalAccessTokenValidator,
    private readonly principalContext: ExternalPrincipalContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<RequestWithExternalPrincipal>();

    const expectedAudience = this.reflector.getAllAndOverride<string | undefined>(EXPECTED_AUDIENCE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!expectedAudience) {
      // A server-side configuration mistake (a route applied this guard
      // without @ExpectedAudience), not a caller-triggerable condition —
      // fails closed with a 500, never by silently accepting any audience
      // (brief §11: audience validation is mandatory, never defaulted).
      throw new InternalServerErrorException('This endpoint is not correctly configured for external Bearer authentication (missing @ExpectedAudience)');
    }

    // Both "missing entirely" and "malformed/ambiguous" collapse to the
    // same 401 invalid_token — matching this phase's own E2E matrix
    // (brief §31: "Missing bearer → 401", "Malformed bearer → 401"), not a
    // 400, since from the caller's perspective both are simply "you are not
    // presenting a usable credential."
    const token = extractBearerToken(request.headers['authorization']);
    if (!token) {
      throw new ResourceServerAuthError('invalid_token', 'missing_bearer', GENERIC_INVALID_TOKEN_MESSAGE);
    }

    const principal = await this.validator.validate(token, expectedAudience);

    request.externalPrincipal = principal;
    this.principalContext.setPrincipal(principal);

    return true;
  }
}
