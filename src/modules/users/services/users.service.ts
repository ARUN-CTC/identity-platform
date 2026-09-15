import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, SecurityUser } from '@prisma/client';
import { RequestContextService, PaginatedResult, AppException, ResourceNotFoundException, hashPassword } from '../../../common';
import { MembershipsService } from '../../memberships/services';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { SecurityEventsService } from '../../security-audit/services';
import { SessionsService } from '../../sessions/services';
import { UserInvitationsService } from '../invitations/services';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto, UserStatus } from '../dto/user-query.dto';
import { CreateUserInput, UsersRepository } from '../repositories/users.repository';

type UserLifecycleAction = 'activate' | 'suspend' | 'deactivate';

// PROVISIONED -> ACTIVE <-> SUSPENDED -> DEACTIVATED.
const LIFECYCLE_TRANSITIONS: Record<UserLifecycleAction, { from: UserStatus[]; to: UserStatus }> = {
  activate: { from: ['PROVISIONED', 'SUSPENDED'], to: 'ACTIVE' },
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  deactivate: { from: ['PROVISIONED', 'ACTIVE', 'SUSPENDED'], to: 'DEACTIVATED' },
};

const LIFECYCLE_EVENT_TYPES: Record<UserLifecycleAction, string> = {
  activate: 'iam.user_activated',
  suspend: 'iam.user_suspended',
  deactivate: 'iam.user_deactivated',
};

// Suspend/deactivate must not leave an already-issued access token usable —
// revoking the session/refresh-token DB rows here is one half of the fix;
// JwtAuthGuard checking session liveness on every request is the other half
// that actually makes revocation bite on the very next call. `activate` is
// intentionally absent — it only ever increases access, nothing to revoke.
const LIFECYCLE_REVOKE_REASON: Partial<Record<UserLifecycleAction, string>> = {
  suspend: 'ACCOUNT_SUSPENDED',
  deactivate: 'ACCOUNT_DEACTIVATED',
};

/** Phase 1 extracted source — copied from TravelOS, classified REUSABLE. */
@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
    private readonly sessions: SessionsService,
    private readonly invitations: UserInvitationsService,
    private readonly memberships: MembershipsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async list(query: UserQueryDto): Promise<PaginatedResult<SecurityUser>> {
    const { items, total } = await this.repository.findMany(query);
    return new PaginatedResult(items.map((u) => this.sanitize(u)), total, query);
  }

  async findOne(id: string): Promise<SecurityUser> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw new ResourceNotFoundException('User', id);
    }
    return this.sanitize(user);
  }

  /** Internal — includes passwordHash. Only AuthenticationService/PlatformAuthenticationService may see it. Global lookup — no tenant scoping (docs/PHASE_2A.md); the caller separately checks tenant membership (or Platform Operator status). */
  async findAuthRecord(email: string): Promise<SecurityUser | null> {
    return this.repository.findByEmail(email);
  }

  /** Global lookup by id, requiring an ACTIVE membership in tenantId — the refresh/change-password equivalent of login's membership check. */
  async findAuthRecordInTenant(tenantId: string, userId: string): Promise<SecurityUser | null> {
    return this.repository.findByIdWithTenantMembership(tenantId, userId);
  }

  /** Phase 2B.1 — global lookup by id, sanitized (no passwordHash), no tenant scoping. Used by PlatformAuthenticationService, which has no tenant context to check against. */
  async findGlobalById(userId: string): Promise<SecurityUser | null> {
    const user = await this.repository.findByIdGlobal(userId);
    return user ? this.sanitize(user) : null;
  }

  /**
   * Phase 2B.1 — for PlatformOperatorsService only: "does this email
   * already resolve to an existing, already-activated global Identity."
   * Deliberately returns only what a cross-module caller needs (id,
   * whether a password is set) — never the passwordHash itself, which
   * stays inside this service/AuthenticationService's own trust boundary.
   */
  async findGlobalIdentitySummaryByEmail(email: string): Promise<{ id: string; email: string; hasPassword: boolean } | null> {
    const user = await this.repository.findByEmail(email);
    if (!user) {
      return null;
    }
    return { id: user.id, email: user.email, hasPassword: !!user.passwordHash };
  }

  async recordFailedLogin(userId: string, lockedUntil: Date | null): Promise<void> {
    await this.repository.recordFailedLogin(userId, lockedUntil);
  }

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.repository.recordSuccessfulLogin(userId);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.repository.updatePassword(userId, passwordHash);
  }

  /**
   * The ONLY user-creation path UsersController (the public API) calls —
   * invitation-only, unconditionally. Every call onboards the given email
   * into `dto.organizationId`: a brand-new global Identity is created
   * PROVISIONED with no password and sent an invitation (see
   * UserInvitationsService); an email that already resolves to an existing
   * global Identity (this person already has an account via another
   * tenant/organization — docs/IDENTITY_DOMAIN_MODEL.md §2.1) instead gets
   * a new Membership attached to that same Identity — see createInternal().
   * For the one other legitimate caller (tenant bootstrap admin-user
   * creation), see createWithBootstrapPassword() below instead.
   */
  async create(dto: CreateUserDto): Promise<SecurityUser> {
    return this.createInternal(dto, null);
  }

  /**
   * INTERNAL ONLY — never exposed by UsersController. A freshly provisioned
   * tenant's very first admin has no one to accept an invitation yet (the
   * provisioning request itself supplies their password), and the caller
   * activates the account immediately afterward. Do not wire this into
   * UsersController — doing so would let any caller set an arbitrary
   * password for any new user, bypassing the invitation/identity-proof step.
   */
  async createWithBootstrapPassword(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationId: string;
  }): Promise<SecurityUser> {
    return this.createInternal(input, await hashPassword(input.password));
  }

  private async createInternal(
    dto: CreateUserInput & { organizationId: string },
    passwordHash: string | null,
  ): Promise<SecurityUser> {
    const tenantId = this.context.requireTenantId();
    // RLS-scoped existence check — 404s an organizationId from another tenant exactly like any other org-scoped write.
    await this.organizationsService.findOne(dto.organizationId);

    let user = await this.repository.findByEmail(dto.email);
    const isNewIdentity = !user;
    if (!user) {
      try {
        user = await this.repository.create(dto, passwordHash);
      } catch (err) {
        // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Error handling) — the
        // findByEmail check above narrows, but does not eliminate, the race
        // between two concurrent requests for the same brand-new email; the
        // unique constraint on security_user.email is the actual authority.
        // No global P2002 filter is wired in this codebase, so without this
        // catch the race's loser would surface as an unhandled 500 instead
        // of the same conflict semantics the passwordHash branch below
        // already gives a duplicate.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppException('IAM_EMAIL_ALREADY_REGISTERED', `An account for '${dto.email}' already exists`, HttpStatus.CONFLICT);
        }
        throw err;
      }
    } else if (passwordHash) {
      // Only createWithBootstrapPassword ever passes a passwordHash, and it
      // exists to bootstrap a brand-new Identity — colliding with one that
      // already exists is a genuine conflict, never a "just add a
      // membership" case (this caller supplied a password for someone who
      // may already have one).
      throw new AppException(
        'IAM_EMAIL_ALREADY_REGISTERED',
        `An account for '${dto.email}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    // Reusing an existing, already-activated global Identity: they're a
    // proven account already (they have a password), so the new membership
    // can go straight to ACTIVE with no invitation-accept step. A brand-new
    // Identity, or an existing one still mid-setup elsewhere (no password
    // yet), gets an INVITED membership completed via the same
    // invitation-accept flow Phase 1 already had.
    const membershipStatus = user.passwordHash ? 'ACTIVE' : 'INVITED';
    await this.memberships.create(tenantId, dto.organizationId, user.id, membershipStatus);

    await this.securityEvents.record({
      tenantId,
      actorUserId: this.context.userId,
      eventType: 'iam.user_created',
      resourceType: 'SecurityUser',
      resourceId: user.id,
      metadata: { email: user.email, organizationId: dto.organizationId, isNewIdentity, invited: membershipStatus === 'INVITED' },
    });

    if (membershipStatus === 'INVITED') {
      await this.invitations.sendInvitation(tenantId, this.context.userId, user, dto.organizationId);
    } else {
      await this.invitations.notifyAddedToOrganization(user);
    }
    return this.sanitize(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<SecurityUser> {
    await this.findOne(id);
    return this.sanitize(await this.repository.update(id, dto));
  }

  /**
   * PHASE 2A NOTE: activate/suspend/deactivate act on the global Identity's
   * own account status — since a single Identity can now hold Memberships
   * in more than one Tenant (docs/IDENTITY_DOMAIN_MODEL.md §2.1), suspending
   * or deactivating a user here affects them everywhere they have a
   * Membership, not just in the calling admin's own tenant. Whether that is
   * actually the right behavior for a genuinely multi-tenant person (a
   * consultant should likely be suspendable from one tenant without losing
   * access to another) is a real, undecided question — it depends on how a
   * "suspended in Tenant A, active in Tenant B" Identity should behave at
   * login, which is exactly the kind of cross-cutting question
   * docs/ORGANIZATION_CONTEXT.md and Phase 2C are scoped to resolve, not
   * something to guess at here. Documented as a known limitation
   * (docs/PHASE_2A.md) rather than silently redesigned. To remove a user
   * from just one organization without touching their global account,
   * use MembershipsController's status endpoint
   * (PATCH /organizations/:organizationId/members/:userId) instead.
   */
  async activate(id: string): Promise<SecurityUser> {
    return this.applyLifecycleAction(id, 'activate');
  }

  async suspend(id: string): Promise<SecurityUser> {
    return this.applyLifecycleAction(id, 'suspend');
  }

  async deactivate(id: string): Promise<SecurityUser> {
    return this.applyLifecycleAction(id, 'deactivate');
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.remove(id);
  }

  async resendInvitation(id: string, organizationId: string): Promise<void> {
    await this.invitations.resendInvitation(this.context.requireTenantId(), this.context.userId, id, organizationId);
  }

  private async applyLifecycleAction(id: string, action: UserLifecycleAction): Promise<SecurityUser> {
    const raw = await this.repository.findById(id);
    if (!raw) {
      throw new ResourceNotFoundException('User', id);
    }
    const transition = LIFECYCLE_TRANSITIONS[action];
    if (!transition.from.includes(raw.status as UserStatus)) {
      throw new AppException(
        'INVALID_USER_TRANSITION',
        `Cannot ${action} a user in status ${raw.status} (must be one of: ${transition.from.join(', ')})`,
        HttpStatus.BAD_REQUEST,
      );
    }
    // An invited user (created without a password) has no passwordHash to
    // authenticate with — activating them here would leave an ACTIVE user
    // who can never log in. They must complete the invitation flow instead.
    if (action === 'activate' && !raw.passwordHash) {
      throw new AppException(
        'IAM_USER_HAS_NO_PASSWORD',
        'This user has not completed account setup yet — resend their invitation instead of activating directly',
        HttpStatus.BAD_REQUEST,
      );
    }
    const updated = await this.repository.transitionStatus(id, transition.to);
    await this.securityEvents.record({
      tenantId: this.context.requireTenantId(),
      actorUserId: this.context.userId,
      eventType: LIFECYCLE_EVENT_TYPES[action],
      resourceType: 'SecurityUser',
      resourceId: id,
      metadata: { fromStatus: raw.status, toStatus: transition.to },
    });
    const revokeReason = LIFECYCLE_REVOKE_REASON[action];
    if (revokeReason) {
      await this.sessions.revokeAllForUser(this.context.requireTenantId(), id, revokeReason);
    }
    return this.sanitize(updated);
  }

  private sanitize(user: SecurityUser): SecurityUser {
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest as SecurityUser;
  }
}
