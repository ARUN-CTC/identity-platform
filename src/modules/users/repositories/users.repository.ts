import { Injectable } from '@nestjs/common';
import { Prisma, SecurityUser } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService } from '../../../database';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto, UserStatus } from '../dto/user-query.dto';

/** What create() actually needs to persist a user — deliberately not CreateUserDto itself, since this repository is also the write path for the internal bootstrap-password creation used by tenant provisioning. */
export interface CreateUserInput {
  email: string;
  username?: string;
  firstName: string;
  lastName: string;
}

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 *
 * PHASE 2A: security_user is a global Identity with no tenant_id column and
 * no RLS (docs/PHASE_2A.md, "Global Identity RLS posture") — a plain
 * `find*` by id/email is no longer implicitly tenant-scoped by the
 * database. Every method that needs to answer "can this tenant-scoped
 * caller see this user" now does so explicitly, by joining through
 * `membership` (the *WithTenantMembership methods) rather than relying on a
 * WHERE tenantId clause that no longer exists on this table. Methods with no
 * tenant-scoping requirement (global email lookup for login/invitation
 * dedup, raw password/status mutations by id) are plain global lookups.
 */
@Injectable()
export class UsersRepository {
  constructor(
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  async findMany(query: UserQueryDto): Promise<{ items: SecurityUser[]; total: number }> {
    const tenantId = this.context.requireTenantId();
    const where: Prisma.SecurityUserWhereInput = {
      deletedAt: null,
      memberships: { some: { tenantId, status: { not: 'REMOVED' } } },
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prismaContext.runInContext(async (tx) => {
      const [items, total] = await Promise.all([
        tx.securityUser.findMany({ where, skip: query.skip, take: query.take }),
        tx.securityUser.count({ where }),
      ]);
      return { items, total };
    }, tenantId);
  }

  /** Admin-facing lookup — only visible to a tenant-scoped caller if the user holds (or has ever held) a membership in that tenant. */
  async findById(id: string): Promise<SecurityUser | null> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securityUser.findFirst({
          where: { id, deletedAt: null, memberships: { some: { tenantId, status: { not: 'REMOVED' } } } },
        }),
      tenantId,
    );
  }

  /** Global lookup by email — no tenant scoping. Used for login resolution and invitation/create-user dedup (docs/PHASE_2A.md — a global Identity can already exist from another tenant/organization). */
  async findByEmail(email: string): Promise<SecurityUser | null> {
    return this.prismaContext.runInContext((tx) => tx.securityUser.findFirst({ where: { email, deletedAt: null } }));
  }

  /** Global lookup by id — no tenant scoping. Used mid-login/refresh/password-change once the caller's identity (not yet their tenant access) has been established. */
  async findByIdGlobal(id: string): Promise<SecurityUser | null> {
    return this.prismaContext.runInContext((tx) => tx.securityUser.findFirst({ where: { id, deletedAt: null } }));
  }

  /**
   * Global lookup by id, additionally requiring an ACTIVE membership
   * somewhere in tenantId — the refresh/change-password equivalent of the
   * login-time "does this Identity actually belong to this tenant" check
   * (docs/PHASE_2A.md). Used wherever a request carries an already-issued
   * token's tenantId and must reconfirm tenant access is still current
   * (a membership may have been revoked since the token was issued).
   */
  async findByIdWithTenantMembership(tenantId: string, id: string): Promise<SecurityUser | null> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securityUser.findFirst({
          where: { id, deletedAt: null, memberships: { some: { tenantId, status: 'ACTIVE' } } },
        }),
      tenantId,
    );
  }

  async create(dto: CreateUserInput, passwordHash: string | null): Promise<SecurityUser> {
    return this.prismaContext.runInContext((tx) =>
      tx.securityUser.create({
        data: {
          email: dto.email,
          username: dto.username,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
          passwordChangedAt: passwordHash ? new Date() : null,
          createdBy: this.context.userId,
        },
      }),
    );
  }

  async update(id: string, dto: UpdateUserDto): Promise<SecurityUser> {
    return this.prismaContext.runInContext((tx) =>
      tx.securityUser.update({ where: { id }, data: { ...dto, updatedBy: this.context.userId } }),
    );
  }

  async updatePassword(id: string, passwordHash: string): Promise<SecurityUser> {
    return this.prismaContext.runInContext((tx) =>
      tx.securityUser.update({
        where: { id },
        data: { passwordHash, passwordChangedAt: new Date(), updatedBy: this.context.userId },
      }),
    );
  }

  /**
   * Accept-invitation's write: sets the first password and activates a
   * PROVISIONED user in one conditional statement, gated on
   * status: 'PROVISIONED' so a user whose status changed in the meantime is
   * not silently activated. count === 0 tells the caller to treat this as a
   * failed accept, even though the token itself is already correctly burned.
   * PHASE 2A: no longer tenant-scoped — id alone identifies a global
   * Identity, and the invitation token itself already proved which
   * organization/tenant this accept is for (see UserInvitationsService).
   */
  async activateWithPassword(id: string, passwordHash: string): Promise<boolean> {
    const result = await this.prismaContext.runInContext((tx) =>
      tx.securityUser.updateMany({
        where: { id, status: 'PROVISIONED' },
        data: { passwordHash, passwordChangedAt: new Date(), status: 'ACTIVE' },
      }),
    );
    return result.count === 1;
  }

  async transitionStatus(id: string, status: UserStatus): Promise<SecurityUser> {
    return this.prismaContext.runInContext((tx) =>
      tx.securityUser.update({ where: { id }, data: { status, updatedBy: this.context.userId } }),
    );
  }

  async recordFailedLogin(id: string, lockedUntil: Date | null): Promise<void> {
    await this.prismaContext.runInContext((tx) =>
      tx.securityUser.update({
        where: { id },
        data: { failedLoginCount: { increment: 1 }, ...(lockedUntil ? { lockedUntil } : {}) },
      }),
    );
  }

  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.prismaContext.runInContext((tx) =>
      tx.securityUser.update({
        where: { id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
    );
  }

  // deleteMany, not delete — see the tenants repository's own comment on the soft-delete trigger.
  async remove(id: string): Promise<void> {
    await this.prismaContext.runInContext((tx) => tx.securityUser.deleteMany({ where: { id } }));
  }
}
