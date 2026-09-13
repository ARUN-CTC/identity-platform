import { HttpStatus, Injectable } from '@nestjs/common';
import { SecurityUserRole } from '@prisma/client';
import { RequestContextService, AppException } from '../../../common';
import { SecurityEventsService } from '../../security-audit/services';
import { UserRolesRepository } from '../repositories/user-roles.repository';
import { UsersService } from './users.service';

/** Phase 1 extracted source — copied from TravelOS, classified REUSABLE. */
@Injectable()
export class UserRolesService {
  constructor(
    private readonly repository: UserRolesRepository,
    private readonly usersService: UsersService,
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
