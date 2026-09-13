import { Injectable } from '@nestjs/common';
import { Prisma, SecurityRole } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService } from '../../../database';
import { CreateRoleDto } from '../dto/create-role.dto';
import { RoleQueryDto } from '../dto/role-query.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';

/**
 * security_role uses apply_tenant_rls_nullable() — the RLS policy already
 * returns "tenant_id IS NULL (system roles) OR tenant_id = current tenant"
 * for every query, so findMany()/findById() don't add their own tenant
 * filter; doing so would incorrectly hide system roles.
 */
@Injectable()
export class RolesRepository {
  constructor(
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  async findMany(
    query: RoleQueryDto,
    options?: { excludeSuperAdmin?: boolean },
  ): Promise<{ items: SecurityRole[]; total: number }> {
    const tenantId = this.context.requireTenantId();
    const where: Prisma.SecurityRoleWhereInput = {
      deletedAt: null,
      ...(query.includeSystem === false ? { tenantId } : {}),
      // SUPER_ADMIN must not be listed/visible to a caller who doesn't hold it themselves.
      ...(options?.excludeSuperAdmin ? { roleCode: { not: 'SUPER_ADMIN' } } : {}),
      ...(query.search
        ? { OR: [{ roleCode: { contains: query.search, mode: 'insensitive' } }, { roleName: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };

    return this.prismaContext.runInContext(async (tx) => {
      const [items, total] = await Promise.all([
        tx.securityRole.findMany({ where, skip: query.skip, take: query.take }),
        tx.securityRole.count({ where }),
      ]);
      return { items, total };
    }, tenantId);
  }

  async findById(id: string): Promise<SecurityRole | null> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.securityRole.findFirst({ where: { id, deletedAt: null } }),
      tenantId,
    );
  }

  async findByCodeForTenant(tenantId: string, roleCode: string): Promise<SecurityRole | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.securityRole.findFirst({ where: { roleCode, OR: [{ tenantId }, { tenantId: null }], deletedAt: null } }),
      tenantId,
    );
  }

  async create(dto: CreateRoleDto): Promise<SecurityRole> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.securityRole.create({ data: { ...dto, tenantId, isSystem: false, createdBy: this.context.userId } }),
      tenantId,
    );
  }

  async update(id: string, dto: UpdateRoleDto): Promise<SecurityRole> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.securityRole.update({ where: { id }, data: { ...dto, updatedBy: this.context.userId } }),
      tenantId,
    );
  }

  // deleteMany, not delete — see the tenants repository's own comment on the soft-delete trigger.
  async remove(id: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await this.prismaContext.runInContext((tx) => tx.securityRole.deleteMany({ where: { id } }), tenantId);
  }

  /**
   * Active security_user_role grants referencing this role — checked before
   * deleting: fn_enforce_soft_delete() rewrites every DELETE into an
   * UPDATE, so ON DELETE CASCADE never actually fires, and without this
   * check a soft-deleted role would silently stay fully effective for
   * every user who still holds it.
   */
  async countActiveGrants(id: string): Promise<number> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext((tx) => tx.securityUserRole.count({ where: { roleId: id } }), tenantId);
  }
}
