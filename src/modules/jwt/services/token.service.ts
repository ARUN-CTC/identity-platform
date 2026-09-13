import { randomBytes, createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** Phase 1 extracted source — copied from TravelOS, classified REUSABLE. */
export interface AccessTokenClaims {
  sub: string; // userId
  tenantId: string;
  sessionId: string;
  email: string;
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

  verifyAccessToken(token: string): AccessTokenClaims {
    return this.jwt.verify<AccessTokenClaims>(token);
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
}
