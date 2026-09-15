import { ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, hashPassword, verifyPassword } from '../../../common';
import { MailerService } from '../../mailer/services';
import { MembershipsService } from '../../memberships/services';
import { OrganizationsService } from '../../organizations/services/organizations.service';
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
import { MyOrganizationEntity } from '../entities/my-organization.entity';

// Tenant statuses that block ordinary use of the platform — mirrors
// TenantStatusGuard's own BLOCKED_STATUSES (src/common/guards/tenant-status.guard.ts).
// Duplicated rather than imported: that guard is wired for the ambient
// per-request CLS tenant, while context-switch/refresh here must evaluate a
// TARGET tenant that is often not the request's ambient tenant at all.
const TENANT_BLOCKED_STATUSES = new Set(['SUSPENDED', 'CANCELLED']);

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
    private readonly memberships: MembershipsService,
    private readonly organizationsService: OrganizationsService,
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

    // PHASE 2A: user is resolved globally, by email alone (docs/PHASE_2A.md)
    // — email is no longer tenant-scoped. tenantCode's job now is purely to
    // select *which* of this global Identity's Memberships becomes the
    // active session; it is not, and no longer needs to be, part of
    // resolving the account. See docs/AUTHENTICATION_ARCHITECTURE.md and
    // docs/PHASE_2A.md, "Login".
    const user = await this.usersService.findAuthRecord(dto.email);
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

    // This Identity exists globally, but does it actually belong to the
    // requested tenant? Checked as its own step, deliberately with the same
    // generic INVALID_CREDENTIALS/USER_NOT_FOUND failure shape as "no such
    // email at all" — a caller must not be able to distinguish "this email
    // doesn't exist" from "this email exists but not in this tenant" (same
    // account-enumeration defense the rest of this method already applies).
    const hasMembership = await this.memberships.hasActiveMembershipInTenant(tenant.id, user.id);
    if (!hasMembership) {
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

    await this.usersService.recordSuccessfulLogin(user.id);
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
      this.usersService.findAuthRecordInTenant(parsed.tenantId, existing.userId),
      this.sessionsRepository.findById(parsed.tenantId, existing.sessionId),
    ]);

    // PHASE 2A: a membership can be revoked mid-session (an admin removes
    // the user from the organization, or the user's last membership in this
    // tenant is removed entirely) — findAuthRecordInTenant returning null
    // means this global Identity no longer has an ACTIVE membership
    // anywhere in this tenant. A refresh must not silently keep minting new
    // access tokens for a tenant this Identity no longer belongs to; treat
    // it the same as any other revoked-session condition. See
    // docs/PHASE_2A.md, negative security tests.
    if (!user) {
      await this.sessionsRepository.revoke(parsed.tenantId, existing.sessionId, 'MEMBERSHIP_REVOKED');
      await this.refreshTokensRepository.revokeAllForSession(parsed.tenantId, existing.sessionId);
      throw new AppException(
        'IAM_REFRESH_TOKEN_INVALID',
        'Refresh token has been revoked or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — a session's
    // selected organization is re-validated LIVE on every refresh, never
    // just carried forward from the previous access token's own claim.
    // Membership can be revoked, or the organization/tenant disabled, at any
    // point during a session's lifetime; a refresh is the natural place to
    // catch that before minting another access token that would otherwise
    // still assert a context the caller no longer actually has. An invalid
    // context is cleared back to tenant-wide (never hard-fails the refresh
    // itself — logging back in tenant-wide, then re-selecting a still-valid
    // organization, is the caller's own recovery path) and audited.
    let organizationId = session?.organizationId ?? null;
    if (organizationId && !(await this.isOrganizationContextStillValid(parsed.tenantId, existing.userId, organizationId))) {
      await this.sessionsRepository.updateOrganization(parsed.tenantId, existing.sessionId, null);
      await this.securityEvents.record({
        tenantId: parsed.tenantId,
        actorUserId: existing.userId,
        eventType: 'organization_context.cleared_stale',
        resourceType: 'Session',
        resourceId: existing.sessionId,
        metadata: { clearedOrganizationId: organizationId, reason: 'REFRESH_REVALIDATION_FAILED' },
      });
      organizationId = null;
    }

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
      email: user.email,
      organizationId,
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
   * in one call. tenantId/userId/sessionId/organizationId come exclusively
   * from RequestContextService, which JwtAuthGuard already populated from
   * the verified JWT's claims — there is no code path here that accepts any
   * of these as request input, so this can only ever return the caller's
   * own context.
   *
   * PHASE 2C: organizationId is passed straight into resolveGrants() (which
   * re-validates Membership/Organization status live — see
   * UserRolesRepository), so `roles`/`permissions` here always reflect
   * exactly what PermissionsGuard would resolve for this same caller right
   * now, on any other endpoint.
   *
   * STABILIZATION FIX: `organizationContext` itself is now subject to the
   * exact same live re-validation as `roles`/`permissions` — previously
   * this echoed the claim's organizationId/looked-up organization name
   * unconditionally, so a caller holding a token whose Membership had since
   * been revoked, or whose Organization had since been disabled, would see
   * `roles`/`permissions` correctly reflect that (empty) while
   * `organizationContext` still displayed the stale organization's identity
   * as if it were still the active context. A stale claim now displays
   * identically to no claim at all — never itself trusted, consistent with
   * docs/ORGANIZATION_CONTEXT_SECURITY.md §2.
   */
  async getMe(tenantId: string, userId: string, sessionId: string, organizationId?: string | null): Promise<MeEntity> {
    const [user, tenant, grants, session, organization, membershipActiveInOrg] = await Promise.all([
      this.usersService.findOne(userId),
      this.tenantsService.findById(tenantId),
      this.userRolesService.resolveGrants(tenantId, userId, organizationId ?? undefined),
      this.sessionsRepository.findById(tenantId, sessionId),
      organizationId ? this.organizationsService.findByIdForTenant(tenantId, organizationId) : Promise.resolve(null),
      organizationId ? this.memberships.hasActiveMembership(tenantId, userId, organizationId) : Promise.resolve(false),
    ]);
    const organizationContextValid = membershipActiveInOrg && organization?.status === 'ACTIVE';

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
      organizationContext: {
        organizationId: organizationContextValid ? organization!.id : null,
        organizationName: organizationContextValid ? organization!.organizationName : null,
      },
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

  /**
   * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — every
   * organization this caller could select via switchOrganizationContext().
   */
  listMyOrganizations(userId: string): Promise<MyOrganizationEntity[]> {
    return this.memberships.listMyOrganizations(userId).then((rows) =>
      rows.map((row) => ({
        organizationId: row.organizationId,
        organizationName: row.organization.organizationName,
        organizationStatus: row.organization.status,
        tenantId: row.tenantId,
        tenantCode: row.tenant.tenantCode,
        tenantName: row.tenant.tenantName,
        tenantStatus: row.tenant.status,
        membershipStatus: row.status,
      })),
    );
  }

  /**
   * PHASE 2C — the core context-switch operation. Never trusts a
   * client-supplied tenantId: the ONLY input from the caller is the target
   * organizationId, and the tenant it belongs to is discovered server-side
   * via the caller's own ACTIVE membership (MembershipsService,
   * cross-tenant self-visibility — see its own doc comment). Follows the
   * mandated resolution order: Membership -> Organization -> Tenant, each
   * re-validated live, never assumed from any prior token/session state.
   *
   * - Same-tenant switch (target tenant === the session's current tenant):
   *   the existing session row is mutated in place (organizationId only —
   *   tenant_id, the RLS partition key, never changes) and reissued fresh
   *   tokens.
   * - Cross-tenant switch: the current session is revoked (old tenant) and
   *   a brand-new session is created under the target tenant — a
   *   security_session row cannot itself move between tenants (tenant_id is
   *   immutable, backing RLS), so a genuine new row, in the new tenant's own
   *   RLS partition, is the only sound way to represent "this caller is now
   *   operating in a different tenant".
   *
   * A denied attempt (no such membership, organization disabled, tenant
   * suspended) is audited as ORGANIZATION_CONTEXT_DENIED under the caller's
   * CURRENT tenant (the target tenant may not even be resolvable) and never
   * leaks *why* beyond a generic 403 — same account/org-enumeration
   * defense login already applies (see INVALID_CREDENTIALS).
   */
  async switchOrganizationContext(
    currentTenantId: string,
    userId: string,
    sessionId: string,
    targetOrganizationId: string,
  ): Promise<AuthTokens> {
    // Awaited (not fire-and-forget) so a failure to audit surfaces as a 500
    // rather than silently losing the audit trail — but this is the only
    // extra write before the 403 the caller sees.
    const denied = async (): Promise<never> => {
      await this.securityEvents.record({
        tenantId: currentTenantId,
        actorUserId: userId,
        eventType: 'organization_context.denied',
        resourceType: 'Organization',
        resourceId: targetOrganizationId,
        metadata: { sessionId },
      });
      throw new ForbiddenException('You do not have access to this organization');
    };

    const membership = await this.memberships.findMyMembershipInOrganization(userId, targetOrganizationId);
    if (!membership) {
      return denied();
    }

    const targetTenantId = membership.tenantId;
    const [organization, tenant] = await Promise.all([
      this.organizationsService.findByIdForTenant(targetTenantId, targetOrganizationId),
      this.tenantsService.findById(targetTenantId),
    ]);
    if (!organization || organization.status !== 'ACTIVE' || TENANT_BLOCKED_STATUSES.has(tenant.status)) {
      return denied();
    }

    const isCrossTenant = targetTenantId !== currentTenantId;
    const user = await this.usersService.findOne(userId);

    // STABILIZATION FIX: the success audit event is recorded ONLY after every
    // mutation AND token issuance has actually completed (previously it was
    // recorded before token issuance) — an audit record must never claim a
    // switch succeeded when the request that follows it could still fail
    // (docs/ORGANIZATION_CONTEXT_SECURITY.md §4). `newSessionId` lets the
    // cross-tenant branch attribute the event to the session it actually
    // switched INTO, not the one it revoked.
    let result: AuthTokens;
    let newSessionId: string;

    if (isCrossTenant) {
      await this.sessionsRepository.revoke(currentTenantId, sessionId, 'ORGANIZATION_CONTEXT_SWITCH');
      await this.refreshTokensRepository.revokeAllForSession(currentTenantId, sessionId);
      // A fresh session, fresh token pair, in the target tenant's own RLS
      // partition — deliberately reuses issueTokens() rather than
      // duplicating session/refresh-token creation here.
      const issued = await this.issueTokensWithSessionId(targetTenantId, userId, user.email, undefined, undefined, false, targetOrganizationId);
      result = issued.tokens;
      newSessionId = issued.sessionId;
    } else {
      await this.sessionsRepository.updateOrganization(currentTenantId, sessionId, targetOrganizationId);
      await this.refreshTokensRepository.revokeAllForSession(currentTenantId, sessionId);
      const refresh = this.tokenService.generateRefreshToken(currentTenantId);
      const ttlMs = this.tokenService.refreshTokenTtlSecondsFor(false) * 1000;
      await this.refreshTokensRepository.create(currentTenantId, sessionId, userId, refresh.hash, new Date(Date.now() + ttlMs));
      const accessToken = this.tokenService.signAccessToken({
        sub: userId,
        tenantId: currentTenantId,
        sessionId,
        email: user.email,
        organizationId: targetOrganizationId,
      });
      result = { accessToken, refreshToken: refresh.plain, tokenType: 'Bearer', expiresIn: this.tokenService.accessTokenTtlSeconds };
      newSessionId = sessionId;
    }

    await this.securityEvents.record({
      tenantId: targetTenantId,
      actorUserId: userId,
      eventType: 'organization_context.switched',
      resourceType: 'Organization',
      resourceId: targetOrganizationId,
      metadata: { fromTenantId: currentTenantId, toTenantId: targetTenantId, crossTenant: isCrossTenant, sessionId: newSessionId },
    });

    return result;
  }

  /**
   * Returns to tenant-wide context — always same-tenant (there is no tenant
   * to move to), so this only ever mutates the existing session in place.
   */
  async clearOrganizationContext(tenantId: string, userId: string, sessionId: string): Promise<AuthTokens> {
    const user = await this.usersService.findOne(userId);

    await this.sessionsRepository.updateOrganization(tenantId, sessionId, null);
    await this.refreshTokensRepository.revokeAllForSession(tenantId, sessionId);

    const refresh = this.tokenService.generateRefreshToken(tenantId);
    const ttlMs = this.tokenService.refreshTokenTtlSecondsFor(false) * 1000;
    await this.refreshTokensRepository.create(tenantId, sessionId, userId, refresh.hash, new Date(Date.now() + ttlMs));
    const accessToken = this.tokenService.signAccessToken({
      sub: userId,
      tenantId,
      sessionId,
      email: user.email,
      organizationId: null,
    });
    const result: AuthTokens = { accessToken, refreshToken: refresh.plain, tokenType: 'Bearer', expiresIn: this.tokenService.accessTokenTtlSeconds };

    // STABILIZATION FIX: recorded only after token issuance actually
    // completes — see the identical fix/rationale in switchOrganizationContext().
    await this.securityEvents.record({
      tenantId,
      actorUserId: userId,
      eventType: 'organization_context.cleared',
      resourceType: 'Session',
      resourceId: sessionId,
    });

    return result;
  }

  /**
   * Shared live-revalidation check for a session's organizationId — used by
   * refresh() to decide whether a previously-selected context is still
   * good. Deliberately duplicates none of switchOrganizationContext()'s own
   * membership-discovery logic: by the time a session already HAS an
   * organizationId, its tenantId is already fixed and known, so this is a
   * much narrower (tenantId, userId, organizationId) check, not a
   * cross-tenant search.
   */
  private async isOrganizationContextStillValid(tenantId: string, userId: string, organizationId: string): Promise<boolean> {
    const [membershipActive, organization] = await Promise.all([
      this.memberships.hasActiveMembership(tenantId, userId, organizationId),
      this.organizationsService.findByIdForTenant(tenantId, organizationId),
    ]);
    return membershipActive && organization?.status === 'ACTIVE';
  }

  async logout(tenantId: string, sessionId: string): Promise<void> {
    await this.sessionsRepository.revoke(tenantId, sessionId, 'LOGOUT');
    await this.refreshTokensRepository.revokeAllForSession(tenantId, sessionId);
  }

  async changePassword(tenantId: string, userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findAuthRecordInTenant(tenantId, userId);
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
    const user = tenant ? await this.usersService.findAuthRecord(dto.email) : null;
    const hasMembership = tenant && user ? await this.memberships.hasActiveMembershipInTenant(tenant.id, user.id) : false;
    if (!tenant || !user || !hasMembership || user.status !== 'ACTIVE') {
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
    await this.usersService.updatePassword(existing.userId, newHash);
    await this.passwordResetTokensRepository.markUsed(parsed.tenantId, existing.id);

    // A password reset is exactly the moment to force re-authentication
    // everywhere — the prior session that may have motivated the reset
    // must not remain valid.
    await this.sessionsRepository.revokeAllForUser(parsed.tenantId, existing.userId, 'PASSWORD_RESET');
    await this.refreshTokensRepository.revokeAllForUser(parsed.tenantId, existing.userId);

    await this.securityEvents.record({ tenantId: parsed.tenantId, actorUserId: existing.userId, eventType: 'account.password_reset_completed' });
  }

  private async handleFailedPassword(tenantId: string, userId: string, identifier: string, ctx: LoginContext): Promise<void> {
    const user = await this.usersService.findAuthRecordInTenant(tenantId, userId);
    const failedCount = (user?.failedLoginCount ?? 0) + 1;
    const lockedUntil = failedCount >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

    await this.usersService.recordFailedLogin(userId, lockedUntil);
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
    organizationId?: string | null,
  ): Promise<AuthTokens> {
    const { tokens } = await this.issueTokensWithSessionId(tenantId, userId, email, deviceInfo, ipAddress, rememberMe, organizationId);
    return tokens;
  }

  /**
   * Same as issueTokens(), but also returns the newly-created session's id —
   * needed by switchOrganizationContext()'s cross-tenant branch so its
   * success audit event can attribute the switch to the session it actually
   * switched INTO. Never itself exposed in an HTTP response body — login()/
   * issueTokens() intentionally discard the sessionId to keep the public
   * AuthTokens response shape (docs/ORGANIZATION_CONTEXT_API.md) unchanged.
   */
  private async issueTokensWithSessionId(
    tenantId: string,
    userId: string,
    email: string,
    deviceInfo: string | undefined,
    ipAddress: string | undefined,
    rememberMe = false,
    organizationId?: string | null,
  ): Promise<{ tokens: AuthTokens; sessionId: string }> {
    const refreshTtlMs = this.tokenService.refreshTokenTtlSecondsFor(rememberMe) * 1000;
    const session = await this.sessionsRepository.create(
      tenantId,
      userId,
      new Date(Date.now() + refreshTtlMs),
      deviceInfo,
      ipAddress,
      rememberMe,
      organizationId ?? null,
    );

    const refresh = this.tokenService.generateRefreshToken(tenantId);
    await this.refreshTokensRepository.create(tenantId, session.id, userId, refresh.hash, new Date(Date.now() + refreshTtlMs));

    const accessToken = this.tokenService.signAccessToken({
      sub: userId,
      tenantId,
      sessionId: session.id,
      email,
      organizationId: organizationId ?? undefined,
    });

    return {
      tokens: {
        accessToken,
        refreshToken: refresh.plain,
        tokenType: 'Bearer',
        expiresIn: this.tokenService.accessTokenTtlSeconds,
      },
      sessionId: session.id,
    };
  }
}
