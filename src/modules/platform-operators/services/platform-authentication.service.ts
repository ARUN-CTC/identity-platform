import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException, verifyPassword } from '../../../common';
import { TokenService } from '../../jwt/services';
import { SecurityEventsService } from '../../security-audit/services';
import { UsersService } from '../../users/services';
import { PlatformOperatorSessionsRepository, PlatformOperatorsRepository } from '../repositories';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export interface PlatformAuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

interface PlatformLoginContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Every failure path (unknown email, wrong password, an account that
 * exists but has no — or a disabled — Platform Operator grant) returns the
 * exact same generic error. Deliberately: revealing "this email exists but
 * isn't a Platform Operator" is itself a security-sensitive fact (Step 27,
 * docs/PLATFORM_OPERATOR_ARCHITECTURE.md, "Error handling") — no different
 * from why AuthenticationService.login() never distinguishes "no such
 * email" from "wrong password" either.
 */
const INVALID_CREDENTIALS = () =>
  new AppException('PLATFORM_INVALID_CREDENTIALS', 'Invalid credentials', HttpStatus.UNAUTHORIZED);

/**
 * Phase 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md) — reuses the exact
 * same credential/password infrastructure as AuthenticationService
 * (Argon2id via verifyPassword(), the same security_user.failedLoginCount/
 * lockedUntil brute-force counters via UsersService) — no second password
 * system. What's different is everything downstream of "password
 * verified": no tenant is ever resolved, no Membership is ever checked,
 * and the session/token pair is issued from an entirely separate table
 * pair (platform_operator_session/platform_operator_refresh_token) via a
 * distinct claims shape (PlatformAccessTokenClaims) — see
 * PlatformJwtAuthGuard for how those are told apart from a tenant session.
 */
@Injectable()
export class PlatformAuthenticationService {
  constructor(
    private readonly usersService: UsersService,
    private readonly operators: PlatformOperatorsRepository,
    private readonly sessions: PlatformOperatorSessionsRepository,
    private readonly tokenService: TokenService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async login(email: string, password: string, deviceInfo: string | undefined, ctx: PlatformLoginContext): Promise<PlatformAuthTokens> {
    const user = await this.usersService.findAuthRecord(email);
    if (!user) {
      await this.recordLoginFailure(undefined, email, ctx);
      throw INVALID_CREDENTIALS();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLoginFailure(user.id, email, ctx);
      throw new AppException('PLATFORM_ACCOUNT_LOCKED', 'Account is locked due to too many failed login attempts', HttpStatus.FORBIDDEN);
    }

    if (user.status !== 'ACTIVE') {
      await this.recordLoginFailure(user.id, email, ctx);
      throw INVALID_CREDENTIALS();
    }

    const operator = await this.operators.findByUserId(user.id);
    if (!operator || operator.status !== 'ACTIVE') {
      // Same generic failure as "wrong password" — see this file's own
      // header comment on why this must not be distinguishable.
      await this.recordLoginFailure(user.id, email, ctx);
      throw INVALID_CREDENTIALS();
    }

    const passwordValid = user.passwordHash ? await verifyPassword(user.passwordHash, password) : false;
    if (!passwordValid) {
      await this.recordLoginFailure(user.id, email, ctx);
      throw INVALID_CREDENTIALS();
    }

    await this.usersService.recordSuccessfulLogin(user.id);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: user.id,
      eventType: 'PLATFORM_LOGIN_SUCCESS',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.issueTokens(operator.id, user.id, user.email, deviceInfo, ctx.ipAddress);
  }

  async refresh(plainToken: string): Promise<PlatformAuthTokens> {
    const hash = this.tokenService.hashRefreshToken(plainToken);
    const existing = await this.sessions.findRefreshTokenByHash(hash);
    if (!existing) {
      throw new AppException('PLATFORM_REFRESH_TOKEN_INVALID', 'Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }
    if (existing.revokedAt || existing.expiresAt < new Date()) {
      throw new AppException('PLATFORM_REFRESH_TOKEN_INVALID', 'Refresh token has been revoked or expired', HttpStatus.UNAUTHORIZED);
    }
    if (existing.rotatedAt || existing.replacedById) {
      await this.sessions.revokeSession(existing.sessionId, 'REFRESH_TOKEN_REUSE');
      await this.sessions.revokeAllRefreshTokensForSession(existing.sessionId);
      // actorUserId must be a security_user.id (a global Identity), not a
      // platform_operator.id — resolve it via the operator row rather than
      // using existing.operatorId directly (security_event.actor_user_id
      // has an FK to security_user).
      const reusedByOperator = await this.operators.findById(existing.operatorId);
      await this.securityEvents.recordPlatformEvent({
        actorUserId: reusedByOperator?.userId,
        eventType: 'PLATFORM_SUSPICIOUS_LOGIN',
        metadata: { reason: 'REFRESH_TOKEN_REUSE', sessionId: existing.sessionId },
      });
      throw new AppException(
        'PLATFORM_REFRESH_TOKEN_REUSED',
        'This refresh token was already used — the session has been revoked as a precaution',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Live status re-check — mirrors PlatformJwtAuthGuard's own: a
    // disabled-since-issuance operator must not be able to keep refreshing.
    const operator = await this.operators.findById(existing.operatorId);
    if (!operator || operator.status !== 'ACTIVE') {
      await this.sessions.revokeSession(existing.sessionId, 'OPERATOR_DISABLED');
      await this.sessions.revokeAllRefreshTokensForSession(existing.sessionId);
      throw new AppException('PLATFORM_REFRESH_TOKEN_INVALID', 'Refresh token has been revoked or expired', HttpStatus.UNAUTHORIZED);
    }

    const next = this.tokenService.generatePlatformRefreshToken();
    const nextTtlMs = this.tokenService.platformRefreshTokenTtlSeconds * 1000;
    await this.sessions.rotateRefreshToken(existing.id, existing.sessionId, existing.operatorId, next.hash, new Date(Date.now() + nextTtlMs));
    await this.sessions.touchSession(existing.sessionId);

    const user = await this.usersService.findGlobalById(operator.userId);

    const accessToken = this.tokenService.signPlatformAccessToken({
      sub: operator.userId,
      operatorId: operator.id,
      sessionId: existing.sessionId,
      email: user?.email ?? '',
      scope: 'PLATFORM_OPERATOR',
    });

    return {
      accessToken,
      refreshToken: next.plain,
      tokenType: 'Bearer',
      expiresIn: this.tokenService.platformAccessTokenTtlSeconds,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revokeSession(sessionId, 'LOGOUT');
    await this.sessions.revokeAllRefreshTokensForSession(sessionId);
  }

  async getMe(operatorId: string, userId: string): Promise<{ id: string; email: string; permissionCodes: string[] }> {
    const user = await this.usersService.findGlobalById(userId);
    const permissionCodes = await this.operators.listPermissionCodes(operatorId);
    return { id: operatorId, email: user?.email ?? '', permissionCodes };
  }

  private async recordLoginFailure(userId: string | undefined, identifier: string, ctx: PlatformLoginContext): Promise<void> {
    if (userId) {
      const record = await this.usersService.findAuthRecord(identifier);
      const failedCount = (record?.failedLoginCount ?? 0) + 1;
      const lockedUntil = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;
      await this.usersService.recordFailedLogin(userId, lockedUntil);
    }
    await this.securityEvents.recordPlatformEvent({
      actorUserId: userId,
      eventType: 'PLATFORM_LOGIN_FAILURE',
      metadata: { identifier },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async issueTokens(
    operatorId: string,
    userId: string,
    email: string,
    deviceInfo: string | undefined,
    ipAddress: string | undefined,
  ): Promise<PlatformAuthTokens> {
    const refreshTtlMs = this.tokenService.platformRefreshTokenTtlSeconds * 1000;
    const session = await this.sessions.createSession(operatorId, new Date(Date.now() + refreshTtlMs), deviceInfo, ipAddress);

    const refresh = this.tokenService.generatePlatformRefreshToken();
    await this.sessions.createRefreshToken(session.id, operatorId, refresh.hash, new Date(Date.now() + refreshTtlMs));

    const accessToken = this.tokenService.signPlatformAccessToken({
      sub: userId,
      operatorId,
      sessionId: session.id,
      email,
      scope: 'PLATFORM_OPERATOR',
    });

    return {
      accessToken,
      refreshToken: refresh.plain,
      tokenType: 'Bearer',
      expiresIn: this.tokenService.platformAccessTokenTtlSeconds,
    };
  }
}
