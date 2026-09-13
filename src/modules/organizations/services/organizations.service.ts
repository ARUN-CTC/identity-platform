import { Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { PaginatedResult, PaginationQueryDto, ResourceNotFoundException } from '../../../common';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { OrganizationsRepository } from '../repositories/organizations.repository';

@Injectable()
export class OrganizationsService {
  constructor(private readonly repository: OrganizationsRepository) {}

  async list(query: PaginationQueryDto): Promise<PaginatedResult<Organization>> {
    const { items, total } = await this.repository.findMany(query);
    return new PaginatedResult(items, total, query);
  }

  async findOne(id: string): Promise<Organization> {
    const organization = await this.repository.findById(id);
    if (!organization) {
      throw new ResourceNotFoundException('Organization', id);
    }
    return organization;
  }

  create(dto: CreateOrganizationDto): Promise<Organization> {
    return this.repository.create(dto);
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    await this.findOne(id);
    return this.repository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.remove(id);
  }
}
