import { HttpStatus, Injectable } from '@nestjs/common';
import { SecurityUser } from '@prisma/client';
import { RequestContextService, PaginatedResult, AppException, ResourceNotFoundException, hashPassword } from '../../../common';
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

  /** Internal — includes passwordHash. Only AuthenticationService may see it. */
  async findAuthRecord(tenantId: string, email: string): Promise<SecurityUser | null> {
    return this.repository.findByEmailInTenant(tenantId, email);
  }

  async findAuthRecordById(tenantId: string, userId: string): Promise<SecurityUser | null> {
    return this.repository.findByIdInTenant(tenantId, userId);
  }

  async recordFailedLogin(tenantId: string, userId: string, lockedUntil: Date | null): Promise<void> {
    await this.repository.recordFailedLogin(tenantId, userId, lockedUntil);
  }

  async recordSuccessfulLogin(tenantId: string, userId: string): Promise<void> {
    await this.repository.recordSuccessfulLogin(tenantId, userId);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.repository.updatePassword(userId, passwordHash);
  }

  async updatePasswordInTenant(tenantId: string, userId: string, passwordHash: string): Promise<void> {
    await this.repository.updatePasswordInTenant(tenantId, userId, passwordHash);
  }

  /**
   * The ONLY user-creation path UsersController (the public API) calls —
   * invitation-only, unconditionally. Every call creates the user
   * PROVISIONED with no password and sends an invitation so the user sets
   * their own — see UserInvitationsService. For the one other legitimate
   * caller (tenant bootstrap admin-user creation), see
   * createWithBootstrapPassword() below instead.
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
  }): Promise<SecurityUser> {
    return this.createInternal(input, await hashPassword(input.password));
  }

  private async createInternal(dto: CreateUserInput, passwordHash: string | null): Promise<SecurityUser> {
    // Duplicate (tenantId, email) surfaces as a clean 409 via the global Prisma-unique-violation mapping.
    const user = await this.repository.create(dto, passwordHash);
    const tenantId = this.context.requireTenantId();
    await this.securityEvents.record({
      tenantId,
      actorUserId: this.context.userId,
      eventType: 'iam.user_created',
      resourceType: 'SecurityUser',
      resourceId: user.id,
      metadata: { email: user.email, invited: !passwordHash },
    });
    if (!passwordHash) {
      await this.invitations.sendInvitation(tenantId, this.context.userId, user);
    }
    return this.sanitize(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<SecurityUser> {
    await this.findOne(id);
    return this.sanitize(await this.repository.update(id, dto));
  }

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

  async resendInvitation(id: string): Promise<void> {
    await this.invitations.resendInvitation(this.context.requireTenantId(), this.context.userId, id);
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
