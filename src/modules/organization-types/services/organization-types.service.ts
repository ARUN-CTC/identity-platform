import { Injectable } from '@nestjs/common';
import { OrganizationType } from '@prisma/client';
import { PaginatedResult, PaginationQueryDto, ResourceNotFoundException } from '../../../common';
import { CreateOrganizationTypeDto } from '../dto/create-organization-type.dto';
import { UpdateOrganizationTypeDto } from '../dto/update-organization-type.dto';
import { OrganizationTypesRepository } from '../repositories/organization-types.repository';

@Injectable()
export class OrganizationTypesService {
  constructor(private readonly repository: OrganizationTypesRepository) {}

  async list(query: PaginationQueryDto): Promise<PaginatedResult<OrganizationType>> {
    const [items, total] = await this.repository.findMany(query.skip, query.take);
    return new PaginatedResult(items, total, query);
  }

  async findOne(id: string): Promise<OrganizationType> {
    const type = await this.repository.findById(id);
    if (!type) {
      throw new ResourceNotFoundException('OrganizationType', id);
    }
    return type;
  }

  create(dto: CreateOrganizationTypeDto): Promise<OrganizationType> {
    return this.repository.create(dto);
  }

  async update(id: string, dto: UpdateOrganizationTypeDto): Promise<OrganizationType> {
    await this.findOne(id);
    return this.repository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.remove(id);
  }
}
