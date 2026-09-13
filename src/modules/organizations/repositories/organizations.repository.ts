import { Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { PaginationQueryDto, RequestContextService } from '../../../common';
import { PrismaContextService } from '../../../database';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';

/** organization has RLS (apply_tenant_rls) — every operation runs through PrismaContextService with the ambient tenant. */
@Injectable()
export class OrganizationsRepository {
  constructor(
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  async findMany(query: PaginationQueryDto): Promise<{ items: Organization[]; total: number }> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(async (tx) => {
      const where = { tenantId, deletedAt: null };
      const [items, total] = await Promise.all([
        tx.organization.findMany({ where, skip: query.skip, take: query.take }),
        tx.organization.count({ where }),
      ]);
      return { items, total };
    }, tenantId);
  }

  async findById(id: string): Promise<Organization | null> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.organization.findFirst({ where: { id, tenantId, deletedAt: null } }),
      tenantId,
    );
  }

  async create(dto: CreateOrganizationDto): Promise<Organization> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.organization.create({ data: { ...dto, tenantId, createdBy: this.context.userId } }),
      tenantId,
    );
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    const tenantId = this.context.requireTenantId();
    return this.prismaContext.runInContext(
      (tx) => tx.organization.update({ where: { id }, data: { ...dto, updatedBy: this.context.userId } }),
      tenantId,
    );
  }

  // deleteMany, not delete — see the tenants repository's own comment on the soft-delete trigger.
  async remove(id: string): Promise<void> {
    const tenantId = this.context.requireTenantId();
    await this.prismaContext.runInContext((tx) => tx.organization.deleteMany({ where: { id } }), tenantId);
  }
}
