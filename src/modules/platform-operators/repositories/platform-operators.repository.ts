import { Injectable } from '@nestjs/common';
import { PlatformOperator, SecurityPermission } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaService } from '../../../database';

export type PlatformOperatorStatus = 'ACTIVE' | 'DISABLED';

/**
 * Phase 2B.1 — platform_operator/platform_operator_permission are
 * platform-level (no tenant_id, no RLS — database/ddl/006_platform_operator.sql).
 * Plain PrismaService throughout, same as ProductsRepository/
 * ApplicationsRepository for exactly the same reason.
 */
@Injectable()
export class PlatformOperatorsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  findByUserId(userId: string): Promise<PlatformOperator | null> {
    return this.prisma.platformOperator.findFirst({ where: { userId } });
  }

  findById(id: string): Promise<PlatformOperator | null> {
    return this.prisma.platformOperator.findFirst({ where: { id } });
  }

  async findMany(skip: number, take: number): Promise<[PlatformOperator[], number]> {
    const [items, total] = await Promise.all([
      this.prisma.platformOperator.findMany({ skip, take, orderBy: { createdAt: 'asc' }, include: { user: { select: { email: true, firstName: true, lastName: true } } } }),
      this.prisma.platformOperator.count(),
    ]);
    return [items, total];
  }

  create(userId: string): Promise<PlatformOperator> {
    return this.prisma.platformOperator.create({ data: { userId, createdBy: this.context.userId ?? this.context.operatorId } });
  }

  /**
   * The last-active-operator invariant is enforced by
   * trg_platform_operator_protect_last_active (database/ddl/006_platform_operator.sql)
   * — this call can throw if it would violate that invariant; callers
   * translate the resulting Postgres error into a clean 409 (see
   * PlatformOperatorsService.setStatus()).
   */
  setStatus(id: string, status: PlatformOperatorStatus): Promise<PlatformOperator> {
    return this.prisma.platformOperator.update({ where: { id }, data: { status, updatedBy: this.context.userId ?? this.context.operatorId } });
  }

  countActive(): Promise<number> {
    return this.prisma.platformOperator.count({ where: { status: 'ACTIVE' } });
  }

  findPermissionByCode(code: string): Promise<SecurityPermission | null> {
    return this.prisma.securityPermission.findFirst({ where: { permissionCode: code, deletedAt: null } });
  }

  async listPermissionCodes(operatorId: string): Promise<string[]> {
    const grants = await this.prisma.platformOperatorPermission.findMany({
      where: { operatorId },
      include: { permission: { select: { permissionCode: true } } },
    });
    return grants.map((g) => g.permission.permissionCode);
  }

  async hasPermission(operatorId: string, permissionCode: string): Promise<boolean> {
    const grant = await this.prisma.platformOperatorPermission.findFirst({
      where: { operatorId, permission: { permissionCode } },
      select: { id: true },
    });
    return grant !== null;
  }

  async grantPermission(operatorId: string, permissionId: string): Promise<void> {
    await this.prisma.platformOperatorPermission.create({
      data: { operatorId, permissionId, createdBy: this.context.userId ?? this.context.operatorId },
    });
  }

  async revokePermission(operatorId: string, permissionCode: string): Promise<void> {
    await this.prisma.platformOperatorPermission.deleteMany({
      where: { operatorId, permission: { permissionCode } },
    });
  }
}
