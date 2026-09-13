import { Injectable } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { PaginatedResult, PaginationQueryDto, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { TenantsRepository } from '../repositories/tenants.repository';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly tenantsRepository: TenantsRepository) {}

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantsRepository.findById(id);
    if (!tenant) {
      throw new ResourceNotFoundException('Tenant', id);
    }
    return tenant;
  }

  /** Login/refresh/forgot-password lookup — the caller has no tenant context of its own yet. */
  async findByCode(tenantCode: string): Promise<Tenant> {
    const tenant = await this.tenantsRepository.findByCode(tenantCode);
    if (!tenant) {
      throw new ResourceNotFoundException('Tenant', tenantCode);
    }
    return tenant;
  }

  async list(query: PaginationQueryDto): Promise<PaginatedResult<Tenant>> {
    const [items, total] = await this.tenantsRepository.list(query.skip, query.take);
    return new PaginatedResult(items, total, query);
  }

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantsRepository.findByCode(dto.tenantCode);
    if (existing) {
      throw new ResourceConflictException('Tenant', `Tenant code '${dto.tenantCode}' is already in use`);
    }
    try {
      return await this.tenantsRepository.create(dto);
    } catch (err) {
      // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Error handling) — the
      // pre-check above narrows, but does not eliminate, the race: two
      // concurrent requests for the same tenantCode can both pass it before
      // either INSERT commits. The `uk_tenant_tenant_code` constraint is the
      // actual authority; without this catch, the loser would surface as an
      // unhandled 500 (no global P2002 filter is wired in this codebase —
      // the same reason `ApplicationsService`/`ServiceAccountsService`
      // already catch this locally) instead of the same 409 the pre-check
      // above already promises callers.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ResourceConflictException('Tenant', `Tenant code '${dto.tenantCode}' is already in use`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    await this.findById(id);
    return this.tenantsRepository.update(id, dto);
  }

  async activate(id: string): Promise<Tenant> {
    await this.findById(id);
    return this.tenantsRepository.activate(id);
  }

  async suspend(id: string): Promise<Tenant> {
    await this.findById(id);
    return this.tenantsRepository.suspend(id);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.tenantsRepository.softDelete(id);
  }
}
