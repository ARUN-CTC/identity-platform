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
 * security_user has strict RLS (tenant_id NOT NULL), so every operation runs
 * through PrismaContextService with the ambient tenant as the acting tenant
 * — except the *InTenant methods, explicitly given the tenant to act as,
 * for flows that run before the caller has any tenant context of their own
 * (login, refresh, forgot/reset password).
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
      tenantId,
      deletedAt: null,
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
    });
  }

  async findById(id: string): Promise<SecurityUser | null> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext((tx) =>
      tx.securityUser.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
  }

  /** Login-time lookup — the caller doesn't have tenant context yet. */
  async findByEmailInTenant(tenantId: string, email: string): Promise<SecurityUser | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityUser.findFirst({ where: { tenantId, email, deletedAt: null } }),
      tenantId,
    );
  }

  /** Same as findByEmailInTenant, by id — used mid-login/refresh/password-change. */
  async findByIdInTenant(tenantId: string, id: string): Promise<SecurityUser | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityUser.findFirst({ where: { tenantId, id, deletedAt: null } }),
      tenantId,
    );
  }

  async create(dto: CreateUserInput, passwordHash: string | null): Promise<SecurityUser> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext((tx) =>
      tx.securityUser.create({
        data: {
          email: dto.email,
          username: dto.username,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
          passwordChangedAt: passwordHash ? new Date() : null,
          tenantId,
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

  /** For the forgot-password reset flow — runs with no authenticated request context. */
  async updatePasswordInTenant(tenantId: string, id: string, passwordHash: string): Promise<SecurityUser> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securityUser.update({
          where: { id },
          data: { passwordHash, passwordChangedAt: new Date() },
        }),
      tenantId,
    );
  }

  /**
   * Accept-invitation's write: sets the first password and activates a
   * PROVISIONED user in one conditional statement, gated on
   * status: 'PROVISIONED' so a user whose status changed in the meantime is
   * not silently activated. count === 0 tells the caller to treat this as a
   * failed accept, even though the token itself is already correctly burned.
   */
  async activateWithPassword(tenantId: string, id: string, passwordHash: string): Promise<boolean> {
    const result = await this.prismaContext.runInContext(
      (tx) =>
        tx.securityUser.updateMany({
          where: { id, tenantId, status: 'PROVISIONED' },
          data: { passwordHash, passwordChangedAt: new Date(), status: 'ACTIVE' },
        }),
      tenantId,
    );
    return result.count === 1;
  }

  async transitionStatus(id: string, status: UserStatus): Promise<SecurityUser> {
    return this.prismaContext.runInContext((tx) =>
      tx.securityUser.update({ where: { id }, data: { status, updatedBy: this.context.userId } }),
    );
  }

  async recordFailedLogin(tenantId: string, id: string, lockedUntil: Date | null): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securityUser.update({
          where: { id },
          data: { failedLoginCount: { increment: 1 }, ...(lockedUntil ? { lockedUntil } : {}) },
        }),
      tenantId,
    );
  }

  async recordSuccessfulLogin(tenantId: string, id: string): Promise<void> {
    await this.prismaContext.runInContext(
      (tx) =>
        tx.securityUser.update({
          where: { id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        }),
      tenantId,
    );
  }

  // deleteMany, not delete — see the tenants repository's own comment on the soft-delete trigger.
  async remove(id: string): Promise<void> {
    await this.prismaContext.runInContext((tx) => tx.securityUser.deleteMany({ where: { id } }));
  }
}
