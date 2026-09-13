import { Injectable } from '@nestjs/common';
import { SecurityRolePermission } from '@prisma/client';
import { PrismaService } from '../../../database';

/**
 * security_role_permission has no tenant_id and no RLS — the parent role's
 * own tenant ownership is what gates who can call these methods, enforced
 * one layer up in RolePermissionsService via RolesService.findOne(roleId).
 */
@Injectable()
export class RolePermissionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(roleId: string): Promise<SecurityRolePermission[]> {
    return this.prisma.securityRolePermission.findMany({ where: { roleId } });
  }

  assign(roleId: string, permissionId: string): Promise<SecurityRolePermission> {
    return this.prisma.securityRolePermission.create({ data: { roleId, permissionId } });
  }

  async revoke(roleId: string, permissionId: string): Promise<void> {
    await this.prisma.securityRolePermission.deleteMany({ where: { roleId, permissionId } });
  }
}
