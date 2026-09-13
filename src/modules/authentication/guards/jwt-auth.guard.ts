import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { IS_PUBLIC_KEY, RequestContextService, RequestWithTraceId } from '../../../common';
import { SessionsRepository } from '../../sessions/repositories';
import { AccessTokenClaims, TokenService } from '../../jwt/services';

const TRACE_HEADER = 'x-request-id';
const TRACE_RESPONSE_HEADER = 'x-trace-id';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE
 * (organizationId claim handling dropped along with organization-context
 * switching — see docs/TRAVELOS_COUPLING.md).
 *
 * Global identity guard. Validates the signed access token from
 * `Authorization: Bearer <jwt>` and populates RequestContextService from its
 * claims, so every downstream repository/service (built against
 * RequestContextService's interface) needs zero changes.
 *
 * Registered first in the guard chain — TenantStatusGuard and
 * PermissionsGuard both depend on context.tenantId/userId already being set
 * by the time they run.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly context: RequestContextService,
    private readonly sessions: SessionsRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithTraceId>();
    const res = ctx.switchToHttp().getResponse<Response>();

    // Set first: if token validation below throws, the trace ID must still
    // be available for the error to be correlatable.
    const traceId = this.readTraceId(req);
    req.traceId = traceId;
    this.context.setTraceId(traceId);
    res.setHeader(TRACE_RESPONSE_HEADER, traceId);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) {
      return true;
    }

    const token = this.readBearerToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing bearer access token');
    }

    let claims: AccessTokenClaims;
    try {
      claims = this.tokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Signature/expiry validity alone is not enough — an access token stays
    // cryptographically valid for its full TTL even after the session it
    // was issued under has been revoked (logout, password reset, an
    // administrative suspend/deactivate). Checking the session on every
    // request is what actually makes revocation take effect on the very
    // next call instead of only on the next refresh/login.
    const session = await this.sessions.findById(claims.tenantId, claims.sessionId);
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }

    this.context.setTenantId(claims.tenantId);
    this.context.setUserId(claims.sub);
    this.context.setSessionId(claims.sessionId);

    return true;
  }

  private readBearerToken(req: RequestWithTraceId): string | undefined {
    const value = req.headers['authorization'];
    const header = Array.isArray(value) ? value[0] : value;
    if (!header || !header.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length).trim() || undefined;
  }

  private readTraceId(req: RequestWithTraceId): string {
    const value = req.headers[TRACE_HEADER];
    const raw = Array.isArray(value) ? value[0] : value;
    return raw && raw.length > 0 ? raw : randomUUID();
  }
}
