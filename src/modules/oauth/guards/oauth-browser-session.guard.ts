import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { RequestContextService } from '../../../common';
import { SessionsRepository } from '../../sessions/repositories';
import { TokenService } from '../../jwt/services';

const COOKIE_NAME = 'identity_browser_session';

/**
 * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md §6). Used ONLY
 * on GET /oauth/authorize and GET /oauth/authorize/resume — every other
 * route in this API remains exactly as it was, authenticated exclusively
 * by JwtAuthGuard (unmodified by this phase). This guard NEVER rejects a
 * request: it only ATTEMPTS to resolve an authenticated caller (via the
 * SAME Authorization: Bearer header JwtAuthGuard already checks, or, as a
 * fallback, the new browser-session cookie) and populates
 * RequestContextService exactly as JwtAuthGuard already does when it
 * succeeds. What happens when NEITHER credential resolves is the
 * CONTROLLER's decision (redirect to login with a pending-authorization
 * reference, §7/§8) — never a bare 401 here, which is the exact gap this
 * phase exists to close.
 *
 * The Bearer path preserves 100% backward compatibility with the one
 * caller shape Phase 2UI.5 already exercised (an already-authenticated SPA
 * calling this endpoint via fetch with its own access token).
 */
@Injectable()
export class OAuthBrowserSessionGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly context: RequestContextService,
    private readonly sessions: SessionsRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    const bearerResolved = await this.tryBearer(req);
    if (!bearerResolved) {
      await this.tryCookie(req);
    }
    // Always true — see this class's own doc comment on why rejecting here
    // would only ever reproduce the flat-401 status quo this phase fixes.
    return true;
  }

  private async tryBearer(req: Request): Promise<boolean> {
    const header = req.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith('Bearer ')) return false;
    const token = value.slice('Bearer '.length).trim();
    if (!token) return false;

    let claims;
    try {
      claims = this.tokenService.verifyAccessToken(token);
    } catch {
      return false;
    }

    const session = await this.sessions.findById(claims.tenantId, claims.sessionId);
    if (!session || session.revokedAt) return false;

    this.applyContext(claims.tenantId, claims.sub, claims.sessionId, claims.organizationId ?? undefined);
    return true;
  }

  private async tryCookie(req: Request): Promise<boolean> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
    if (!raw) return false;

    const parsed = this.tokenService.parseBrowserSessionSecret(raw);
    if (!parsed) return false;

    const hash = this.tokenService.hashBrowserSessionSecret(parsed.secret);
    const session = await this.sessions.findByBrowserSessionSecretHash(parsed.tenantId, hash);
    if (!session) return false;

    this.applyContext(session.tenantId, session.userId, session.id, session.organizationId ?? undefined);
    return true;
  }

  private applyContext(tenantId: string, userId: string, sessionId: string, organizationId: string | undefined): void {
    this.context.setTenantId(tenantId);
    this.context.setUserId(userId);
    this.context.setSessionId(sessionId);
    this.context.setOrganizationId(organizationId);
  }
}

export { COOKIE_NAME as OAUTH_BROWSER_SESSION_COOKIE_NAME };
