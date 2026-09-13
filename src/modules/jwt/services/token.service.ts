import { randomBytes, createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 * Phase 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) adds `organizationId`
 * — additive, optional: a token minted before Phase 2C (or for a session
 * with no organization selected) simply omits it, and every consumer
 * treats a missing/null value as "no organization context, tenant-wide
 * only," unchanged behavior from every prior phase. This claim is a
 * convenience/identity fact only — it is never trusted as authorization by
 * itself; PermissionsGuard/UserRolesRepository.resolveGrants() re-validate
 * Membership/Organization status against the database on every request
 * (see that document, "Why the JWT claim is never trusted alone").
 */
export interface AccessTokenClaims {
  sub: string; // userId
  tenantId: string;
  sessionId: string;
  email: string;
  organizationId?: string | null;
}

/**
 * Phase 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md) — deliberately a
 * separate claims shape, not an extension of AccessTokenClaims: a platform
 * session has no tenantId, ever, and `scope` lets a bearer token be told
 * apart at a glance from a tenant-scoped one (defense in depth alongside
 * the fact that the two are validated by entirely separate guards against
 * entirely separate session tables — see PlatformJwtAuthGuard).
 */
export interface PlatformAccessTokenClaims {
  sub: string; // security_user.id (global Identity)
  operatorId: string; // platform_operator.id
  sessionId: string; // platform_operator_session.id
  email: string;
  scope: 'PLATFORM_OPERATOR';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Numeric env vars come back from ConfigService as strings — coerced explicitly since Phase 1 has no Joi/class-validator env schema (see docs/PHASE_1.md, Phase 2 recommendations). */
  private numberEnv(key: string): number {
    return Number(this.config.get<string>(key));
  }

  /** Short-lived (default 15 min) signed JWT access token. */
  signAccessToken(claims: AccessTokenClaims): string {
    return this.jwt.sign(claims, {
      expiresIn: this.numberEnv('JWT_ACCESS_TOKEN_TTL'),
    });
  }

  /**
   * Phase 2D.1 (docs/EXTERNAL_API_TRUST_BOUNDARY.md §0) — `algorithms:
   * ['HS256']` is pinned explicitly rather than left to `@nestjs/jwt`'s own
   * default inference, so this legacy verifier can never be tricked into
   * accepting a token signed with any other algorithm (including a future
   * RS256-signed external/OAuth token — see src/modules/oauth,
   * ExternalTokenService, a structurally separate verifier this one shares
   * no code path with). This makes the legacy/external trust boundary
   * explicit in code, not just true by accident of the current secret's
   * shape — the exact hardening docs/PHASE_2D_THREAT_MODEL.md #7
   * (algorithm confusion) requires of every verifier in this codebase.
   */
  verifyAccessToken(token: string): AccessTokenClaims {
    return this.jwt.verify<AccessTokenClaims>(token, { algorithms: ['HS256'] });
  }

  /** Platform Operator access token — same signing secret (HS256, unchanged — ADR-003 still governs any future move to asymmetric per-audience keys), different claims shape and TTL. */
  signPlatformAccessToken(claims: PlatformAccessTokenClaims): string {
    return this.jwt.sign(claims, { expiresIn: this.platformAccessTokenTtlSeconds });
  }

  verifyPlatformAccessToken(token: string): PlatformAccessTokenClaims {
    // Same explicit algorithm pin as verifyAccessToken() above, same reason.
    const claims = this.jwt.verify<PlatformAccessTokenClaims>(token, { algorithms: ['HS256'] });
    // A tenant-scoped access token is a structurally valid JWT signed with
    // the same secret — verify() alone can't tell the two apart. This is
    // the one runtime check that does: no scope discriminator, no
    // platform session.
    if (claims.scope !== 'PLATFORM_OPERATOR') {
      throw new Error('Not a Platform Operator access token');
    }
    return claims;
  }

  get platformAccessTokenTtlSeconds(): number {
    return this.numberEnv('PLATFORM_ACCESS_TOKEN_TTL');
  }

  get platformRefreshTokenTtlSeconds(): number {
    return this.numberEnv('PLATFORM_REFRESH_TOKEN_TTL');
  }

  /**
   * Platform refresh tokens are pure opaque random values — unlike
   * generateRefreshToken(), no tenantId prefix is needed: the table they're
   * looked up in (platform_operator_refresh_token) has no RLS at all, so
   * there's no per-tenant GUC to resolve before the lookup can run.
   */
  generatePlatformRefreshToken(): { plain: string; hash: string } {
    const plain = randomBytes(48).toString('base64url');
    return { plain, hash: this.hashRefreshToken(plain) };
  }

  /**
   * Refresh tokens are opaque random values, not JWTs — trivial to revoke by
   * looking up their hash, unlike a self-contained signed token. Only the
   * SHA-256 hash is ever persisted.
   *
   * Prefixed with the (cleartext, non-secret) tenantId because refresh —
   * unlike every other request — arrives with no tenant context yet, and RLS
   * requires app.current_tenant_id to be set before the row can be looked
   * up. Only the random suffix is secret.
   */
  generateRefreshToken(tenantId: string): { plain: string; hash: string } {
    const secret = randomBytes(48).toString('base64url');
    const plain = `${Buffer.from(tenantId).toString('base64url')}.${secret}`;
    return { plain, hash: this.hashRefreshToken(secret) };
  }

  hashRefreshToken(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** Splits a presented token into its (cleartext) tenantId and secret. */
  parseRefreshToken(plain: string): { tenantId: string; secret: string } | null {
    const [tenantIdPart, secret] = plain.split('.');
    if (!tenantIdPart || !secret) {
      return null;
    }
    try {
      const tenantId = Buffer.from(tenantIdPart, 'base64url').toString('utf8');
      return { tenantId, secret };
    } catch {
      return null;
    }
  }

  get accessTokenTtlSeconds(): number {
    return this.numberEnv('JWT_ACCESS_TOKEN_TTL');
  }

  get refreshTokenTtlSeconds(): number {
    return this.numberEnv('JWT_REFRESH_TOKEN_TTL');
  }

  get refreshTokenTtlSecondsShort(): number {
    return this.numberEnv('JWT_REFRESH_TOKEN_TTL_SHORT');
  }

  refreshTokenTtlSecondsFor(rememberMe: boolean): number {
    return rememberMe ? this.refreshTokenTtlSeconds : this.refreshTokenTtlSecondsShort;
  }

  get passwordResetTokenTtlHours(): number {
    return this.numberEnv('PASSWORD_RESET_TOKEN_TTL_HOURS');
  }

  /** Reuses the exact same opaque, tenant-prefixed, hash-only design as refresh tokens. */
  generatePasswordResetToken(tenantId: string): { plain: string; hash: string } {
    return this.generateRefreshToken(tenantId);
  }

  hashPasswordResetToken(secret: string): string {
    return this.hashRefreshToken(secret);
  }

  parsePasswordResetToken(plain: string): { tenantId: string; secret: string } | null {
    return this.parseRefreshToken(plain);
  }

  get invitationTokenTtlHours(): number {
    return this.numberEnv('USER_INVITATION_TOKEN_TTL_HOURS');
  }

  generateInvitationToken(tenantId: string): { plain: string; hash: string } {
    return this.generateRefreshToken(tenantId);
  }

  hashInvitationToken(secret: string): string {
    return this.hashRefreshToken(secret);
  }

  parseInvitationToken(plain: string): { tenantId: string; secret: string } | null {
    return this.parseRefreshToken(plain);
  }

  /**
   * Phase 2D.7 (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §5) — the OAuth
   * Authorization Code grant's own single-use artifact. Target lifetime is
   * short (≤60s, docs/OAUTH_ARCHITECTURE.md §5) — deliberately a distinct
   * env var from every other TTL here, never conflated with
   * JWT_ACCESS_TOKEN_TTL or a refresh-token TTL.
   */
  get authorizationCodeTtlSeconds(): number {
    const configured = this.config.get<string>('OAUTH_AUTHORIZATION_CODE_TTL_SECONDS');
    return configured ? Number(configured) : 60;
  }

  /**
   * Reuses the exact same opaque, tenant-prefixed, hash-only design as
   * refresh/password-reset/invitation tokens above — a cryptographically
   * random, non-sequential, non-JWT value (brief §14: "do not use UUID v4
   * alone, sequential values, timestamp-based codes, JWT authorization
   * codes"). A distinct method name (not merely an undocumented alias) so
   * this credential's own lifecycle stays conceptually and auditably
   * separate from a refresh token (brief §36) even though the underlying
   * opaque-value shape is identical.
   */
  generateAuthorizationCode(tenantId: string): { plain: string; hash: string } {
    return this.generateRefreshToken(tenantId);
  }

  hashAuthorizationCode(secret: string): string {
    return this.hashRefreshToken(secret);
  }

  parseAuthorizationCode(plain: string): { tenantId: string; secret: string } | null {
    return this.parseRefreshToken(plain);
  }
}
