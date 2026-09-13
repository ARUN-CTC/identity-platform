import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService, PrismaService } from '../../../database';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';

/**
 * `tenant` has no RLS (it is the tenant registry itself, not tenant-scoped),
 * so reads/creates/updates use PrismaService directly. Only softDelete()
 * routes through PrismaContextService: the soft-delete trigger pulls
 * deleted_by from the app.current_user_id session GUC, which only
 * runInContext sets.
 */
@Injectable()
export class TenantsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
  }

  findByCode(tenantCode: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({ where: { tenantCode, deletedAt: null } });
  }

  async list(skip: number, take: number): Promise<[Tenant[], number]> {
    const where = { deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.tenant.count({ where }),
    ]);
    return [items, total];
  }

  create(dto: CreateTenantDto): Promise<Tenant> {
    return this.prisma.tenant.create({
      data: { ...dto, status: 'PROVISIONING', createdBy: this.context.userId },
    });
  }

  update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    return this.prisma.tenant.update({ where: { id }, data: { ...dto, updatedBy: this.context.userId } });
  }

  activate(id: string): Promise<Tenant> {
    return this.prisma.tenant.update({
      where: { id },
      data: { status: 'ACTIVE', activatedAt: new Date(), updatedBy: this.context.userId },
    });
  }

  suspend(id: string): Promise<Tenant> {
    return this.prisma.tenant.update({
      where: { id },
      data: { status: 'SUSPENDED', suspendedAt: new Date(), updatedBy: this.context.userId },
    });
  }

  // Uses deleteMany, not delete: the soft-delete trigger (fn_enforce_soft_delete)
  // rewrites the physical DELETE into an UPDATE ... SET deleted_at = NOW() and
  // cancels the row deletion, so `delete()`'s required RETURNING would throw
  // P2025 on the resulting 0-row result. See docs/PHASE_1.md known-issues.
  // Routed through PrismaContextService (with tenantId override = the
  // tenant's own id) purely so app.current_user_id is set for deleted_by
  // attribution — tenant itself has no RLS policy to satisfy.
  async softDelete(id: string): Promise<void> {
    await this.prismaContext.runInContext((tx) => tx.tenant.deleteMany({ where: { id } }), id);
  }
}
