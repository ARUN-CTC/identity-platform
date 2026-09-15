import { Injectable } from '@nestjs/common';
import { SecurityUserRole } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService, PrismaService } from '../../../database';
import { MembershipsRepository } from '../../memberships/repositories';

@Injectable()
export class UserRolesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
    private readonly memberships: MembershipsRepository,
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
   *
   * PHASE 2A: a SecurityUserRole row no longer proves the granted user
   * belongs to tenantId/organizationId by itself (userId is now a global
   * Identity) — Membership is the actual gate:
   *   - No ACTIVE membership anywhere in tenantId at all -> no grants
   *     resolve, full stop (the user isn't part of this tenant, however
   *     many stale SecurityUserRole rows might still reference them).
   *   - organizationId-scoped grants only resolve when the user also holds
   *     an ACTIVE membership in that exact organization — a tenant-wide
   *     grant (organization_id IS NULL) still applies regardless, since
   *     tenant-wide access is themselves gated by the tenant-membership
   *     check above, not by any one organization.
   * See docs/PHASE_2A.md, "Membership is the authorization gate".
   *
   * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md): an
   * organizationId-scoped grant additionally requires that Organization's
   * own `status` to be ACTIVE — a disabled Organization's own grants stop
   * resolving even if the Membership itself is still ACTIVE (Security
   * Invariant "disabled organization cannot retain access"). This is
   * intentionally narrow: it only withholds *that organization's*
   * org-scoped grants, never the caller's separate tenant-wide ones — a
   * tenant-wide admin isn't blocked from acting platform-tenant-wide just
   * because the one organization they happen to have selected as their
   * active context is currently disabled.
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
    const empty = { roleCodes: [], permissionCodes: [], roles: [] };

    const hasTenantMembership = await this.memberships.hasActiveMembershipInTenant(tenantId, userId);
    if (!hasTenantMembership) {
      return empty;
    }

    return this.prismaContext.runInContext(async (tx) => {
      let orgMembershipActive = false;
      if (organizationId) {
        const [membershipActive, organization] = await Promise.all([
          this.memberships.hasActiveMembership(tenantId, userId, organizationId),
          tx.organization.findFirst({ where: { id: organizationId, tenantId }, select: { status: true } }),
        ]);
        orgMembershipActive = membershipActive && organization?.status === 'ACTIVE';
      }

      const grants = await tx.securityUserRole.findMany({
        where: {
          tenantId,
          userId,
          OR: [{ organizationId: null }, ...(organizationId && orgMembershipActive ? [{ organizationId }] : [])],
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
