import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, hashPassword, verifyPassword } from '../../../common';
import { MailerService } from '../../mailer/services';
import { TenantsService } from '../../tenants/services/tenants.service';
import { PasswordResetTokensRepository, RefreshTokensRepository } from '../../jwt/repositories';
import { TokenService } from '../../jwt/services';
import { SecurityEventsService } from '../../security-audit/services';
import { SessionsRepository } from '../../sessions/repositories';
import { UserRolesService, UsersService } from '../../users/services';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { MeEntity } from '../entities/me.entity';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Every failure path (unknown tenant, unknown email, wrong password,
 * locked/disabled account) throws the *same* generic error at the API
 * boundary — do not expose password validation details that enable account
 * enumeration. Internally each path is still distinguished for
 * logging/lockout purposes.
 */
const INVALID_CREDENTIALS = () =>
  new AppException('IAM_INVALID_CREDENTIALS', 'Invalid credentials', HttpStatus.UNAUTHORIZED);

/**
 * Phase 1 extracted source — copied from TravelOS, classified REFACTOR
 * REQUIRED: organization-context switching
 * (switchOrganizationContext/resolveOrganizationContext/
 * listGrantedOrganizations) was cut for Phase 1 (see
 * docs/TRAVELOS_COUPLING.md) — every remaining method is otherwise
 * unchanged. PlatformEmailService is replaced with this platform's own
 * MailerService.
 */
@Injectable()
export class AuthenticationService {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly usersService: UsersService,
    private readonly userRolesService: UserRolesService,
    private readonly sessionsRepository: SessionsRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly passwordResetTokensRepository: PasswordResetTokensRepository,
    private readonly tokenService: TokenService,
    private readonly securityEvents: SecurityEventsService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, ctx: LoginContext): Promise<AuthTokens> {
    const tenant = await this.tenantsService.findByCode(dto.tenantCode).catch(() => null);
    if (!tenant) {
      throw INVALID_CREDENTIALS();
    }

    const user = await this.usersService.findAuthRecord(tenant.id, dto.email);
    if (!user) {
      await this.securityEvents.recordLoginAttempt({
        tenantId: tenant.id,
        identifier: dto.email,
        success: false,
        failureReason: 'USER_NOT_FOUND',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw INVALID_CREDENTIALS();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.securityEvents.recordLoginAttempt({
        tenantId: tenant.id,
        userId: user.id,
        identifier: dto.email,
        success: false,
        failureReason: 'ACCOUNT_LOCKED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new AppException('IAM_ACCOUNT_LOCKED', 'Account is locked due to too many failed login attempts', HttpStatus.FORBIDDEN);
    }

    if (user.status !== 'ACTIVE') {
      await this.securityEvents.recordLoginAttempt({
        tenantId: tenant.id,
        userId: user.id,
        identifier: dto.email,
        success: false,
        failureReason: 'ACCOUNT_DISABLED',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new AppException('IAM_ACCOUNT_DISABLED', `Account is ${user.status.toLowerCase()}`, HttpStatus.FORBIDDEN);
    }

    // Defense in depth, not the primary guard: an ACTIVE user should always
    // have a passwordHash by construction (activateWithPassword() sets both
    // atomically), so this is unreachable in practice.
    const passwordValid = user.passwordHash ? await verifyPassword(user.passwordHash, dto.password) : false;
    if (!passwordValid) {
      await this.handleFailedPassword(tenant.id, user.id, dto.email, ctx);
      throw INVALID_CREDENTIALS();
    }

    await this.usersService.recordSuccessfulLogin(tenant.id, user.id);
    await this.securityEvents.recordLoginAttempt({
      tenantId: tenant.id,
      userId: user.id,
      identifier: dto.email,
      success: true,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    await this.securityEvents.record({
      tenantId: tenant.id,
      actorUserId: user.id,
      eventType: 'LOGIN_SUCCESS',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.issueTokens(tenant.id, user.id, user.email, dto.deviceInfo, ctx.ipAddress, dto.rememberMe ?? false);
  }

  /**
   * Refresh-token rotation with reuse detection. A token that already has
   * rotatedAt/replacedById set has already been exchanged once —
   * presenting it again means either a client retry race (benign) or a
   * stolen token being replayed after the legitimate client already rotated
   * it (theft). Either way the safe response is the same: treat it as
   * compromise and revoke the entire session, forcing re-login.
   */
  async refresh(plainToken: string): Promise<AuthTokens> {
    const parsed = this.tokenService.parseRefreshToken(plainToken);
    if (!parsed) {
      throw new AppException('IAM_REFRESH_TOKEN_INVALID', 'Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }

    const hash = this.tokenService.hashRefreshToken(parsed.secret);
    const existing = await this.refreshTokensRepository.findByHash(parsed.tenantId, hash);
    if (!existing) {
      throw new AppException('IAM_REFRESH_TOKEN_INVALID', 'Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }

    if (existing.revokedAt || existing.expiresAt < new Date()) {
      throw new AppException('IAM_REFRESH_TOKEN_INVALID', 'Refresh token has been revoked or expired', HttpStatus.UNAUTHORIZED);
    }

    if (existing.rotatedAt || existing.replacedById) {
      await this.sessionsRepository.revoke(parsed.tenantId, existing.sessionId, 'REFRESH_TOKEN_REUSE');
      await this.refreshTokensRepository.revokeAllForSession(parsed.tenantId, existing.sessionId);
      await this.securityEvents.record({
        tenantId: parsed.tenantId,
        actorUserId: existing.userId,
        eventType: 'security.suspicious_login',
        metadata: { reason: 'REFRESH_TOKEN_REUSE', sessionId: existing.sessionId },
      });
      throw new AppException(
        'IAM_REFRESH_TOKEN_REUSED',
        'This refresh token was already used — the session has been revoked as a precaution',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [user, session] = await Promise.all([
      this.usersService.findAuthRecordById(parsed.tenantId, existing.userId),
      this.sessionsRepository.findById(parsed.tenantId, existing.sessionId),
    ]);

    const next = this.tokenService.generateRefreshToken(parsed.tenantId);
    const nextTtlMs = this.tokenService.refreshTokenTtlSecondsFor(session?.rememberMe ?? false) * 1000;
    await this.refreshTokensRepository.rotate(
      parsed.tenantId,
      existing.id,
      existing.sessionId,
      existing.userId,
      next.hash,
      new Date(Date.now() + nextTtlMs),
    );
    await this.sessionsRepository.touch(parsed.tenantId, existing.sessionId);
    const accessToken = this.tokenService.signAccessToken({
      sub: existing.userId,
      tenantId: parsed.tenantId,
      sessionId: existing.sessionId,
      email: user?.email ?? '',
    });

    return {
      accessToken,
      refreshToken: next.plain,
      tokenType: 'Bearer',
      expiresIn: this.tokenService.accessTokenTtlSeconds,
    };
  }

  /**
   * "Who am I?" — the authenticated caller's own session/security context
   * in one call. tenantId/userId/sessionId come exclusively from
   * RequestContextService, which JwtAuthGuard already populated from the
   * verified JWT's claims — there is no code path here that accepts any of
   * these as request input, so this can only ever return the caller's own
   * context.
   */
  async getMe(tenantId: string, userId: string, sessionId: string): Promise<MeEntity> {
    const [user, tenant, grants, session] = await Promise.all([
      this.usersService.findOne(userId),
      this.tenantsService.findById(tenantId),
      this.userRolesService.resolveGrants(tenantId, userId),
      this.sessionsRepository.findById(tenantId, sessionId),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
      },
      tenant: { id: tenant.id, tenantCode: tenant.tenantCode, tenantName: tenant.tenantName },
      roles: grants.roles,
      permissions: grants.permissionCodes,
      session: {
        id: sessionId,
        // A session lookup miss here would mean the JWT outlived its own
        // session row — fall back to "now" rather than throw, since the
        // access token itself is still valid for this request per JwtAuthGuard.
        expiresAt: session?.expiresAt ?? new Date(),
      },
    };
  }

  async logout(tenantId: string, sessionId: string): Promise<void> {
    await this.sessionsRepository.revoke(tenantId, sessionId, 'LOGOUT');
    await this.refreshTokensRepository.revokeAllForSession(tenantId, sessionId);
  }

  async changePassword(tenantId: string, userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findAuthRecordById(tenantId, userId);
    if (!user) {
      throw INVALID_CREDENTIALS();
    }
    const valid = user.passwordHash ? await verifyPassword(user.passwordHash, dto.currentPassword) : false;
    if (!valid) {
      throw new AppException('IAM_INVALID_CREDENTIALS', 'Current password is incorrect', HttpStatus.BAD_REQUEST);
    }
    const newHash = await hashPassword(dto.newPassword);
    await this.usersService.updatePassword(userId, newHash);

    // Changing a password — self-service or admin-forced — is exactly the
    // moment to force re-authentication everywhere, including the session
    // that made this very call.
    await this.sessionsRepository.revokeAllForUser(tenantId, userId, 'PASSWORD_CHANGED');
    await this.refreshTokensRepository.revokeAllForUser(tenantId, userId);

    await this.securityEvents.record({ tenantId, actorUserId: userId, eventType: 'account.password_changed' });
  }

  /**
   * Always resolves the same way — no signal to the caller about whether
   * tenantCode/email matched a real account — same account-enumeration
   * defense INVALID_CREDENTIALS already applies to login. A locked/disabled
   * account is treated the same as no match for the same reason.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const tenant = await this.tenantsService.findByCode(dto.tenantCode).catch(() => null);
    const user = tenant ? await this.usersService.findAuthRecord(tenant.id, dto.email) : null;
    if (!tenant || !user || user.status !== 'ACTIVE') {
      return;
    }

    await this.passwordResetTokensRepository.invalidateAllForUser(tenant.id, user.id);

    const resetToken = this.tokenService.generatePasswordResetToken(tenant.id);
    const ttlHours = this.tokenService.passwordResetTokenTtlHours;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await this.passwordResetTokensRepository.create(tenant.id, user.id, resetToken.hash, expiresAt);

    const baseUrl = this.config.get<string>('WEB_APP_BASE_URL');
    const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken.plain)}`;
    const greetingName = user.firstName ?? 'there';
    // The reset link alone isn't enough to sign back in — login also
    // requires the tenant code, which nothing else in this flow surfaces.
    await this.mailer.send({
      to: user.email,
      subject: 'Reset your password',
      text:
        `Hi ${greetingName}, reset your password here (expires in ${ttlHours}h): ${resetLink}\n\n` +
        `Your organization's tenant code (needed to sign back in afterward): ${tenant.tenantCode}\n\n` +
        `If you didn't request this, ignore this email — your password hasn't been changed.`,
    });

    await this.securityEvents.record({ tenantId: tenant.id, actorUserId: user.id, eventType: 'account.password_reset_requested' });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const parsed = this.tokenService.parsePasswordResetToken(dto.token);
    const invalid = () =>
      new AppException('IAM_RESET_TOKEN_INVALID', 'This reset link is invalid or has expired', HttpStatus.BAD_REQUEST);
    if (!parsed) {
      throw invalid();
    }

    const hash = this.tokenService.hashPasswordResetToken(parsed.secret);
    const existing = await this.passwordResetTokensRepository.findByHash(parsed.tenantId, hash);
    if (!existing || existing.usedAt || existing.expiresAt < new Date()) {
      throw invalid();
    }

    const newHash = await hashPassword(dto.newPassword);
    await this.usersService.updatePasswordInTenant(parsed.tenantId, existing.userId, newHash);
    await this.passwordResetTokensRepository.markUsed(parsed.tenantId, existing.id);

    // A password reset is exactly the moment to force re-authentication
    // everywhere — the prior session that may have motivated the reset
    // must not remain valid.
    await this.sessionsRepository.revokeAllForUser(parsed.tenantId, existing.userId, 'PASSWORD_RESET');
    await this.refreshTokensRepository.revokeAllForUser(parsed.tenantId, existing.userId);

    await this.securityEvents.record({ tenantId: parsed.tenantId, actorUserId: existing.userId, eventType: 'account.password_reset_completed' });
  }

  private async handleFailedPassword(tenantId: string, userId: string, identifier: string, ctx: LoginContext): Promise<void> {
    const user = await this.usersService.findAuthRecordById(tenantId, userId);
    const failedCount = (user?.failedLoginCount ?? 0) + 1;
    const lockedUntil = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

    await this.usersService.recordFailedLogin(tenantId, userId, lockedUntil);
    await this.securityEvents.recordLoginAttempt({
      tenantId,
      userId,
      identifier,
      success: false,
      failureReason: 'INVALID_PASSWORD',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    if (lockedUntil) {
      await this.securityEvents.record({ tenantId, actorUserId: userId, eventType: 'account.locked', metadata: { failedCount } });
    }
  }

  private async issueTokens(
    tenantId: string,
    userId: string,
    email: string,
    deviceInfo: string | undefined,
    ipAddress: string | undefined,
    rememberMe = false,
  ): Promise<AuthTokens> {
    const refreshTtlMs = this.tokenService.refreshTokenTtlSecondsFor(rememberMe) * 1000;
    const session = await this.sessionsRepository.create(
      tenantId,
      userId,
      new Date(Date.now() + refreshTtlMs),
      deviceInfo,
      ipAddress,
      rememberMe,
    );

    const refresh = this.tokenService.generateRefreshToken(tenantId);
    await this.refreshTokensRepository.create(tenantId, session.id, userId, refresh.hash, new Date(Date.now() + refreshTtlMs));

    const accessToken = this.tokenService.signAccessToken({ sub: userId, tenantId, sessionId: session.id, email });

    return {
      accessToken,
      refreshToken: refresh.plain,
      tokenType: 'Bearer',
      expiresIn: this.tokenService.accessTokenTtlSeconds,
    };
  }
}
