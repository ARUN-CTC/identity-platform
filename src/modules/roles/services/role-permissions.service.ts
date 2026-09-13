import { HttpStatus, Injectable } from '@nestjs/common';
import { SecurityRolePermission } from '@prisma/client';
import { RequestContextService, AppException } from '../../../common';
import { PermissionsService } from '../../permissions/services';
import { SecurityEventsService } from '../../security-audit/services';
import { UserRolesService } from '../../users/services';
import { RolePermissionsRepository } from '../repositories/role-permissions.repository';
import { RolesService } from './roles.service';

@Injectable()
export class RolePermissionsService {
  constructor(
    private readonly repository: RolePermissionsRepository,
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
    private readonly userRolesService: UserRolesService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async list(roleId: string): Promise<SecurityRolePermission[]> {
    await this.rolesService.findOne(roleId);
    return this.repository.findMany(roleId);
  }

  /**
   * ROLE-SECURITY-001: a caller holding only ROLE_MANAGE could otherwise
   * grant a role ANY permission in the catalog — including ones they don't
   * hold themselves — with nothing to stop it. Standard RBAC delegation
   * rule: you can only grant what you already hold. TENANT_MANAGE holders
   * are exempt from the "must already hold it" clause specifically: without
   * it, a brand-new permission nobody has ever been granted (which is every
   * permission the moment PermissionsController.create() makes it) could
   * never be attached to ANY role by ANYONE, including the SUPER_ADMIN who
   * just created it. Deliberately scoped to this method only —
   * TENANT_MANAGE does not bypass UserRolesService.assign() (assigning a
   * whole role to a user), which must stay governed by the plain subset rule.
   */
  async assign(roleId: string, permissionId: string): Promise<SecurityRolePermission> {
    const role = await this.rolesService.findOne(roleId);
    const permission = await this.permissionsService.findOne(permissionId);
    await this.assertCallerCanGrant(permission.permissionCode);
    const grant = await this.repository.assign(roleId, permissionId);
    await this.securityEvents.record({
      tenantId: this.context.requireTenantId(),
      actorUserId: this.context.userId,
      eventType: 'iam.role_permission_granted',
      resourceType: 'SecurityRole',
      resourceId: roleId,
      metadata: { roleCode: role.roleCode, permissionId, permissionCode: permission.permissionCode },
    });
    return grant;
  }

  private async assertCallerCanGrant(permissionCode: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.userId;
    const permissionCodes = userId ? (await this.userRolesService.resolveGrants(tenantId, userId)).permissionCodes : [];
    if (permissionCodes.includes('TENANT_MANAGE') || permissionCodes.includes(permissionCode)) {
      return;
    }
    throw new AppException(
      'INSUFFICIENT_PRIVILEGE_TO_GRANT',
      `Cannot grant '${permissionCode}' — you do not hold this permission yourself`,
      HttpStatus.FORBIDDEN,
    );
  }

  async revoke(roleId: string, permissionId: string): Promise<void> {
    const role = await this.rolesService.findOne(roleId);
    const permission = await this.permissionsService.findOne(permissionId);
    await this.repository.revoke(roleId, permissionId);
    await this.securityEvents.record({
      tenantId: this.context.requireTenantId(),
      actorUserId: this.context.userId,
      eventType: 'iam.role_permission_revoked',
      resourceType: 'SecurityRole',
      resourceId: roleId,
      metadata: { roleCode: role.roleCode, permissionId, permissionCode: permission.permissionCode },
    });
  }
}
