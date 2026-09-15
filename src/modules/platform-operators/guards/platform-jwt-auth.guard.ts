import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { RequestContextService, RequestWithTraceId } from '../../../common';
import { PlatformAccessTokenClaims, TokenService } from '../../jwt/services';
import { PlatformOperatorSessionsRepository, PlatformOperatorsRepository } from '../repositories';

const TRACE_HEADER = 'x-request-id';
const TRACE_RESPONSE_HEADER = 'x-trace-id';

/**
 * Phase 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md) — the Platform
 * Operator equivalent of JwtAuthGuard, deliberately NOT the same guard:
 * validates PlatformAccessTokenClaims against
 * platform_operator_session/platform_operator (never security_session,
 * never a tenant), and populates ONLY
 * RequestContextService.operatorId/isPlatformOperator — tenantId/userId
 * stay unset (see AppClsStore's own comment on why that's structurally
 * safe, not just a convention).
 *
 * Applied locally (`@UseGuards(PlatformJwtAuthGuard, ...)`) on platform
 * controllers, which are also marked `@Public()` so the *global* JwtAuthGuard
 * (which only understands tenant-scoped AccessTokenClaims) does not also
 * run and reject them for lacking a tenantId claim.
 *
 * Re-checks the operator's live `status` on every request (not just at
 * login) — this is what actually closes the gap in docs/PLATFORM_OPERATOR_ARCHITECTURE.md
 * §"Token security, Scenario A": a signature-valid access token issued
 * before an operator was disabled must stop working on the very next
 * request, not just once it naturally expires.
 */
@Injectable()
export class PlatformJwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly context: RequestContextService,
    private readonly sessions: PlatformOperatorSessionsRepository,
    private readonly operators: PlatformOperatorsRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithTraceId>();
    const res = ctx.switchToHttp().getResponse<Response>();

    // Platform routes are @Public() (skip the global JwtAuthGuard, which
    // would otherwise set this), so this guard sets it itself — same
    // logic as JwtAuthGuard's own.
    const traceId = this.readTraceId(req);
    req.traceId = traceId;
    this.context.setTraceId(traceId);
    res.setHeader(TRACE_RESPONSE_HEADER, traceId);

    const token = this.readBearerToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing bearer access token');
    }

    let claims: PlatformAccessTokenClaims;
    try {
      claims = this.tokenService.verifyPlatformAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired Platform Operator access token');
    }

    const session = await this.sessions.findSessionById(claims.sessionId);
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Platform Operator session has been revoked or expired');
    }

    const operator = await this.operators.findById(claims.operatorId);
    if (!operator || operator.status !== 'ACTIVE') {
      throw new UnauthorizedException('This Platform Operator is disabled');
    }

    this.context.setUserId(claims.sub);
    this.context.setOperatorId(claims.operatorId);
    this.context.setIsPlatformOperator(true);
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
