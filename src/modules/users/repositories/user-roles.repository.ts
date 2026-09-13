import { Injectable } from '@nestjs/common';
import { SecurityUserRole } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService, PrismaService } from '../../../database';

@Injectable()
export class UserRolesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  async findMany(userId: string): Promise<SecurityUserRole[]> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.securityUserRole.findMany({ where: { userId, tenantId }, include: { role: true } }),
      tenantId,
    );
  }

  async assign(userId: string, roleId: string, organizationId: string | undefined): Promise<SecurityUserRole> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) =>
        tx.securityUserRole.create({
          data: { tenantId, userId, roleId, organizationId, createdBy: this.context.userId },
        }),
      tenantId,
    );
  }

  async revoke(id: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await this.prismaContext.runInContext(
      (tx) => tx.securityUserRole.deleteMany({ where: { id, tenantId } }),
      tenantId,
    );
  }

  /** Fetches a grant row before it's revoked — the only way to know which role a revoke removed. */
  async findById(id: string): Promise<SecurityUserRole | null> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.securityUserRole.findFirst({ where: { id, tenantId } }),
      tenantId,
    );
  }

  async getRoleSummary(roleId: string): Promise<{ roleCode: string; roleName: string } | null> {
    return this.prisma.securityRole.findUnique({
      where: { id: roleId },
      select: { roleCode: true, roleName: true },
    });
  }

  /**
   * Authorization's core resolution query — role codes and permission codes
   * effectively granted to a user, optionally narrowed to one organization
   * (a tenant-wide grant, organization_id IS NULL, always applies). Takes
   * tenantId explicitly since this runs from JwtAuthGuard/PermissionsGuard
   * before request-scoped context is fully populated.
   */
  async resolveGrants(
    tenantId: string,
    userId: string,
    organizationId?: string,
  ): Promise<{
    roleCodes: string[];
    permissionCodes: string[];
    roles: { id: string; roleCode: string; roleName: string }[];
  }> {
    return this.prismaContext.runInContext(async (tx) => {
      const grants = await tx.securityUserRole.findMany({
        where: {
          tenantId,
          userId,
          OR: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])],
        },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      });

      const roleCodes = new Set<string>();
      const permissionCodes = new Set<string>();
      const rolesById = new Map<string, { id: string; roleCode: string; roleName: string }>();
      for (const grant of grants) {
        roleCodes.add(grant.role.roleCode);
        rolesById.set(grant.role.id, {
          id: grant.role.id,
          roleCode: grant.role.roleCode,
          roleName: grant.role.roleName,
        });
        for (const rp of grant.role.rolePermissions) {
          permissionCodes.add(rp.permission.permissionCode);
        }
      }
      return { roleCodes: [...roleCodes], permissionCodes: [...permissionCodes], roles: [...rolesById.values()] };
    }, tenantId);
  }

  /**
   * A role's full granted-permission-code set, independent of any user's
   * grants — used to check a role being assigned doesn't carry more
   * privilege than the assigner themselves holds (ROLE-SECURITY-001).
   * Deliberately outside RLS/tenant scoping: a system role (tenant_id NULL)
   * must be readable here too.
   */
  async getRolePermissionCodes(roleId: string): Promise<string[]> {
    const rolePermissions = await this.prisma.securityRolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
    return rolePermissions.map((rp) => rp.permission.permissionCode);
  }
}
