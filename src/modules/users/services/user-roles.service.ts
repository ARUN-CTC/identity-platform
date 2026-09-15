import { HttpStatus, Injectable } from '@nestjs/common';
import { SecurityUserRole } from '@prisma/client';
import { RequestContextService, AppException } from '../../../common';
import { MembershipsService } from '../../memberships/services';
import { SecurityEventsService } from '../../security-audit/services';
import { UserRolesRepository } from '../repositories/user-roles.repository';
import { UsersService } from './users.service';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 * PHASE 2A: assign() additionally requires an ACTIVE Membership backing the
 * grant (docs/PHASE_2A.md) — a role grant with no corresponding membership
 * would be unreachable dead data under the new resolveGrants() gating
 * anyway (see UserRolesRepository), so this rejects it up front with a
 * clear error instead of silently accepting a grant that can never apply.
 */
@Injectable()
export class UserRolesService {
  constructor(
    private readonly repository: UserRolesRepository,
    private readonly usersService: UsersService,
    private readonly memberships: MembershipsService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async list(userId: string): Promise<SecurityUserRole[]> {
    await this.usersService.findOne(userId);
    return this.repository.findMany(userId);
  }

  /**
   * ROLE-SECURITY-001: assigning a role — new or pre-existing, custom or
   * system — grants its full permission set immediately. You can only grant
   * a role whose full permission set you already hold yourself, checked
   * against the caller's own tenant-wide grants (organization-scoped grant
   * checking is deferred to Phase 2 along with organization-context
   * switching generally — see docs/PHASE_1.md).
   */
  async assign(userId: string, roleId: string, organizationId?: string): Promise<SecurityUserRole> {
    await this.usersService.findOne(userId);
    await this.assertCallerCanGrant(roleId);
    await this.assertGranteeHasMembership(userId, organizationId);
    const grant = await this.repository.assign(userId, roleId, organizationId);
    const role = await this.repository.getRoleSummary(roleId);
    await this.securityEvents.record({
      tenantId: this.context.requireTenantId(),
      actorUserId: this.context.userId,
      eventType: 'iam.role_granted',
      resourceType: 'SecurityUser',
      resourceId: userId,
      metadata: { roleId, roleCode: role?.roleCode, organizationId: organizationId ?? null },
    });
    return grant;
  }

  /**
   * A role grant is meaningless (and, per resolveGrants(), simply never
   * effective) unless the grantee already belongs to whatever it's scoped
   * to. Fails closed with a clear, specific error rather than silently
   * persisting a grant row that can never resolve to anything.
   */
  private async assertGranteeHasMembership(userId: string, organizationId?: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    if (organizationId) {
      const hasMembership = await this.memberships.hasActiveMembership(tenantId, userId, organizationId);
      if (!hasMembership) {
        throw new AppException(
          'GRANTEE_HAS_NO_MEMBERSHIP',
          `Cannot grant an organization-scoped role — this user has no active membership in organization ${organizationId}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      return;
    }
    const hasTenantMembership = await this.memberships.hasActiveMembershipInTenant(tenantId, userId);
    if (!hasTenantMembership) {
      throw new AppException(
        'GRANTEE_HAS_NO_MEMBERSHIP',
        'Cannot grant a tenant-wide role — this user has no active membership in any organization in this tenant',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async assertCallerCanGrant(roleId: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    const callerId = this.context.userId;
    const [callerPermissionCodes, rolePermissionCodes] = await Promise.all([
      callerId
        ? this.resolveGrants(tenantId, callerId).then((grants) => grants.permissionCodes)
        : Promise.resolve<string[]>([]),
      this.repository.getRolePermissionCodes(roleId),
    ]);
    const missing = rolePermissionCodes.filter((code) => !callerPermissionCodes.includes(code));
    if (missing.length > 0) {
      throw new AppException(
        'INSUFFICIENT_PRIVILEGE_TO_GRANT',
        `Cannot assign this role — it grants permissions you do not hold yourself: ${missing.join(', ')}`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async revoke(userId: string, id: string): Promise<void> {
    await this.usersService.findOne(userId);
    const existing = await this.repository.findById(id);
    await this.repository.revoke(id);
    if (existing) {
      const role = await this.repository.getRoleSummary(existing.roleId);
      await this.securityEvents.record({
        tenantId: this.context.requireTenantId(),
        actorUserId: this.context.userId,
        eventType: 'iam.role_revoked',
        resourceType: 'SecurityUser',
        resourceId: userId,
        metadata: {
          roleId: existing.roleId,
          roleCode: role?.roleCode,
          organizationId: existing.organizationId ?? null,
        },
      });
    }
  }

  resolveGrants(
    tenantId: string,
    userId: string,
    organizationId?: string,
  ): Promise<{
    roleCodes: string[];
    permissionCodes: string[];
    roles: { id: string; roleCode: string; roleName: string }[];
  }> {
    return this.repository.resolveGrants(tenantId, userId, organizationId);
  }
}
