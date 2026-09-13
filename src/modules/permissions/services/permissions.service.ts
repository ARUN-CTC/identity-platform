import { Injectable } from '@nestjs/common';
import { SecurityPermission } from '@prisma/client';
import { PaginatedResult, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { CreatePermissionDto } from '../dto/create-permission.dto';
import { PermissionQueryDto } from '../dto/permission-query.dto';
import { UpdatePermissionDto } from '../dto/update-permission.dto';
import { PermissionsRepository } from '../repositories/permissions.repository';

@Injectable()
export class PermissionsService {
  constructor(private readonly repository: PermissionsRepository) {}

  async list(query: PermissionQueryDto): Promise<PaginatedResult<SecurityPermission>> {
    const { items, total } = await this.repository.findMany(query);
    return new PaginatedResult(items, total, query);
  }

  async findOne(id: string): Promise<SecurityPermission> {
    const permission = await this.repository.findById(id);
    if (!permission) {
      throw new ResourceNotFoundException('Permission', id);
    }
    return permission;
  }

  findByCodes(codes: string[]): Promise<SecurityPermission[]> {
    return this.repository.findByCodes(codes);
  }

  create(dto: CreatePermissionDto): Promise<SecurityPermission> {
    return this.repository.create(dto);
  }

  async update(id: string, dto: UpdatePermissionDto): Promise<SecurityPermission> {
    await this.findOne(id);
    return this.repository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    const permission = await this.findOne(id);
    const activeGrants = await this.repository.countActiveGrants(id);
    if (activeGrants > 0) {
      throw new ResourceConflictException(
        'Permission',
        `'${permission.permissionCode}' is currently granted to ${activeGrants} role${activeGrants === 1 ? '' : 's'} and cannot be deleted while any grant remains — revoke it from every role first`,
      );
    }
    await this.repository.remove(id);
  }
}
