import { Injectable } from '@nestjs/common';
import { OrganizationType } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService, PrismaService } from '../../../database';
import { CreateOrganizationTypeDto } from '../dto/create-organization-type.dto';
import { UpdateOrganizationTypeDto } from '../dto/update-organization-type.dto';

/** organization_type is global reference data (no tenant_id). */
@Injectable()
export class OrganizationTypesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  async findMany(skip: number, take: number): Promise<[OrganizationType[], number]> {
    const where = { deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.organizationType.findMany({ where, skip, take, orderBy: { typeName: 'asc' } }),
      this.prisma.organizationType.count({ where }),
    ]);
    return [items, total];
  }

  findById(id: string): Promise<OrganizationType | null> {
    return this.prisma.organizationType.findFirst({ where: { id, deletedAt: null } });
  }

  create(dto: CreateOrganizationTypeDto): Promise<OrganizationType> {
    return this.prisma.organizationType.create({ data: { ...dto, createdBy: this.context.userId } });
  }

  update(id: string, dto: UpdateOrganizationTypeDto): Promise<OrganizationType> {
    return this.prisma.organizationType.update({ where: { id }, data: { ...dto, updatedBy: this.context.userId } });
  }

  // deleteMany, not delete — see the tenants repository's own comment on the soft-delete trigger.
  async remove(id: string): Promise<void> {
    await this.prismaContext.runInContext((tx) => tx.organizationType.deleteMany({ where: { id } }));
  }
}
