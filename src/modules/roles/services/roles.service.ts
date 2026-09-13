import { HttpStatus, Injectable } from '@nestjs/common';
import { SecurityRole } from '@prisma/client';
import { RequestContextService, PaginatedResult, AppException, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { UserRolesService } from '../../users/services';
import { CreateRoleDto } from '../dto/create-role.dto';
import { RoleQueryDto } from '../dto/role-query.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { RolesRepository } from '../repositories/roles.repository';

@Injectable()
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly userRolesService: UserRolesService,
    private readonly context: RequestContextService,
  ) {}

  async list(query: RoleQueryDto): Promise<PaginatedResult<SecurityRole>> {
    const excludeSuperAdmin = !(await this.callerHoldsSuperAdmin());
    const { items, total } = await this.repository.findMany(query, { excludeSuperAdmin });
    return new PaginatedResult(items, total, query);
  }

  /**
   * SUPER_ADMIN must not be visible via GET /roles to a caller who doesn't
   * themselves hold it (even though actually assigning it is separately —
   * and correctly — blocked at write time by
   * UserRolesService.assertCallerCanGrant()). Reuses
   * UserRolesService.resolveGrants() rather than a second, parallel check.
   */
  private async callerHoldsSuperAdmin(): Promise<boolean> {
    const tenantId = this.context.tenantId;
    const callerId = this.context.userId;
    if (!tenantId || !callerId) {
      return false;
    }
    const { roleCodes } = await this.userRolesService.resolveGrants(tenantId, callerId);
    return roleCodes.includes('SUPER_ADMIN');
  }

  async findOne(id: string): Promise<SecurityRole> {
    const role = await this.repository.findById(id);
    if (!role) {
      throw new ResourceNotFoundException('Role', id);
    }
    return role;
  }

  findByCodeForTenant(tenantId: string, roleCode: string): Promise<SecurityRole | null> {
    return this.repository.findByCodeForTenant(tenantId, roleCode);
  }

  create(dto: CreateRoleDto): Promise<SecurityRole> {
    return this.repository.create(dto);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<SecurityRole> {
    await this.assertMutable(id);
    return this.repository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    const role = await this.assertMutable(id);
    const activeGrants = await this.repository.countActiveGrants(id);
    if (activeGrants > 0) {
      throw new ResourceConflictException(
        'Role',
        `'${role.roleCode}' is currently assigned to ${activeGrants} user${activeGrants === 1 ? '' : 's'} and cannot be deleted while any assignment remains — revoke it from every user first`,
      );
    }
    await this.repository.remove(id);
  }

  /** System roles (SUPER_ADMIN, TENANT_ADMIN, MEMBER) are seed-managed only. */
  private async assertMutable(id: string): Promise<SecurityRole> {
    const role = await this.findOne(id);
    if (role.isSystem) {
      throw new AppException(
        'SYSTEM_ROLE_IMMUTABLE',
        `'${role.roleCode}' is a system role and cannot be modified through this API`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return role;
  }
}
