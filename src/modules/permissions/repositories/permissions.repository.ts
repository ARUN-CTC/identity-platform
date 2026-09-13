import { Injectable } from '@nestjs/common';
import { Prisma, SecurityPermission } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService, PrismaService } from '../../../database';
import { CreatePermissionDto } from '../dto/create-permission.dto';
import { PermissionQueryDto } from '../dto/permission-query.dto';
import { UpdatePermissionDto } from '../dto/update-permission.dto';

/** security_permission is global reference data (no tenant_id). */
@Injectable()
export class PermissionsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  async findMany(query: PermissionQueryDto): Promise<{ items: SecurityPermission[]; total: number }> {
    const where: Prisma.SecurityPermissionWhereInput = {
      deletedAt: null,
      ...(query.resource ? { resource: query.resource } : {}),
      ...(query.search ? { permissionCode: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.securityPermission.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { permissionCode: 'asc' },
      }),
      this.prisma.securityPermission.count({ where }),
    ]);

    return { items, total };
  }

  findById(id: string): Promise<SecurityPermission | null> {
    return this.prisma.securityPermission.findFirst({ where: { id, deletedAt: null } });
  }

  findByCodes(codes: string[]): Promise<SecurityPermission[]> {
    return this.prisma.securityPermission.findMany({ where: { permissionCode: { in: codes }, deletedAt: null } });
  }

  create(dto: CreatePermissionDto): Promise<SecurityPermission> {
    return this.prisma.securityPermission.create({ data: { ...dto, createdBy: this.context.userId } });
  }

  update(id: string, dto: UpdatePermissionDto): Promise<SecurityPermission> {
    return this.prisma.securityPermission.update({ where: { id }, data: { ...dto, updatedBy: this.context.userId } });
  }

  // deleteMany, not delete — see the tenants repository's own comment on the soft-delete trigger.
  async remove(id: string): Promise<void> {
    await this.prismaContext.runInContext((tx) => tx.securityPermission.deleteMany({ where: { id } }));
  }

  /** Active security_role_permission grants referencing this permission — checked before deleting so a still-granted permission can't be silently soft-deleted out from under every role that holds it. */
  countActiveGrants(id: string): Promise<number> {
    return this.prisma.securityRolePermission.count({ where: { permissionId: id } });
  }
}
