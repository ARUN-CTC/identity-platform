import { Injectable } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { PaginatedResult, PaginationQueryDto, RequestContextService, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { SecurityEventsService } from '../../security-audit/services';
import { TenantsRepository } from '../repositories/tenants.repository';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { UpdateOwnTenantDto } from '../dto/update-own-tenant.dto';

/**
 * Phase 2D (tenant registry security remediation —
 * [[tenant-manage-unscoped-registry-vulnerability]]). `findById`/`findByCode`
 * remain plain lookups (no ownership check of their own — see this class's
 * own callers for who may reach them): `findByCode` is used only by the
 * unauthenticated login/refresh/forgot-password flows, which have no tenant
 * context yet by definition. Every other method here is now reachable only
 * one of two ways, never both:
 *
 *   - `findById`/`updateOwn`, via `TenantsController` (`/tenants/me`),
 *     called ONLY with a tenantId the controller derived from
 *     `RequestContextService.requireTenantId()` — never a client-supplied
 *     path param (that controller no longer accepts one at all).
 *   - `list`/`create`/`update`/`activate`/`suspend`/`remove`, via
 *     `PlatformTenantsController` (`/platform/tenants`), gated by
 *     `PlatformJwtAuthGuard` + `PlatformPermissionsGuard` with
 *     `PLATFORM_TENANT_VIEW`/`PLATFORM_TENANT_MANAGE` — permissions that
 *     are `platform_only = TRUE` and can never be granted to a tenant Role,
 *     unlike the tenant-grantable `TENANT_MANAGE` this same surface used to
 *     be gated by.
 *
 * `TenantsRepository` itself still has no ownership scoping (the `tenant`
 * table still has no RLS — it remains, correctly, the platform-wide
 * registry) — the fix is entirely at this layer and the controller/routing
 * layer above it: WHO can call which shape of these methods, not a change
 * to what the repository itself will do with an id it's given. This
 * mirrors the exact pattern every other Platform-Operator-only registry in
 * this codebase already uses (Product, Application, ServiceAccount).
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly tenantsRepository: TenantsRepository,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

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

  /**
   * Self-service update — `tenantId` must always be the caller's own,
   * resolved by `TenantsController` from `RequestContextService`, never a
   * path param. Recorded as a TENANT-scoped event (visible in that
   * tenant's own Security & Audit), distinct from the PLATFORM-scoped
   * `TENANT_UPDATED` a Platform Operator's own mutation produces via
   * `update()` below — same tenant row, different actor class, different
   * audit visibility, on purpose.
   */
  async updateOwn(tenantId: string, dto: UpdateOwnTenantDto): Promise<Tenant> {
    await this.findById(tenantId);
    const updated = await this.tenantsRepository.update(tenantId, dto);
    await this.securityEvents.record({
      tenantId,
      actorUserId: this.context.userId,
      eventType: 'TENANT_PROFILE_UPDATED',
      resourceType: 'Tenant',
      resourceId: tenantId,
      metadata: { tenantName: updated.tenantName },
      correlationId: this.context.traceId,
    });
    return updated;
  }

  // --- Platform Operator-only from here down (PlatformTenantsController) ---

  async list(query: PaginationQueryDto): Promise<PaginatedResult<Tenant>> {
    const [items, total] = await this.tenantsRepository.list(query.skip, query.take);
    return new PaginatedResult(items, total, query);
  }

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantsRepository.findByCode(dto.tenantCode);
    if (existing) {
      throw new ResourceConflictException('Tenant', `Tenant code '${dto.tenantCode}' is already in use`);
    }
    let tenant: Tenant;
    try {
      // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Error handling) — the
      // pre-check above narrows, but does not eliminate, the race: two
      // concurrent requests for the same tenantCode can both pass it before
      // either INSERT commits. The `uk_tenant_tenant_code` constraint is the
      // actual authority; without this catch, the loser would surface as an
      // unhandled 500 (no global P2002 filter is wired in this codebase —
      // the same reason `ApplicationsService`/`ServiceAccountsService`
      // already catch this locally) instead of the same 409 the pre-check
      // above already promises callers.
      tenant = await this.tenantsRepository.create(dto);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ResourceConflictException('Tenant', `Tenant code '${dto.tenantCode}' is already in use`);
      }
      throw err;
    }
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'TENANT_CREATED',
      resourceType: 'Tenant',
      resourceId: tenant.id,
      metadata: { tenantCode: tenant.tenantCode, tenantName: tenant.tenantName },
    });
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const existing = await this.findById(id);
    const updated = await this.tenantsRepository.update(id, dto);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'TENANT_UPDATED',
      resourceType: 'Tenant',
      resourceId: id,
      metadata: { before: { tenantName: existing.tenantName, status: existing.status }, after: { tenantName: updated.tenantName, status: updated.status } },
    });
    return updated;
  }

  async activate(id: string): Promise<Tenant> {
    await this.findById(id);
    const updated = await this.tenantsRepository.activate(id);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'TENANT_ACTIVATED',
      resourceType: 'Tenant',
      resourceId: id,
    });
    return updated;
  }

  async suspend(id: string): Promise<Tenant> {
    await this.findById(id);
    const updated = await this.tenantsRepository.suspend(id);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'TENANT_SUSPENDED',
      resourceType: 'Tenant',
      resourceId: id,
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.tenantsRepository.softDelete(id);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'TENANT_DELETED',
      resourceType: 'Tenant',
      resourceId: id,
    });
  }
}
