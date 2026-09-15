import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TenantProductEntitlement } from '@prisma/client';
import { AppException, RequestContextService, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { ProductsService } from '../../products/services';
import { SecurityEventsService } from '../../security-audit/services';
import { TenantsService } from '../../tenants/services/tenants.service';
import { PatchableEntitlementStatus } from '../dto/update-entitlement-status.dto';
import { EntitlementStatus, TenantProductEntitlementsRepository } from '../repositories/tenant-product-entitlements.repository';
import { ProductAccessService } from './product-access.service';

/** The only path INTO each target status via the generic PATCH endpoint — REVOKED -> ACTIVE is deliberately excluded here (see reactivate()). */
const ALLOWED_FROM_STATUSES: Record<PatchableEntitlementStatus, EntitlementStatus[]> = {
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
  REVOKED: ['ACTIVE', 'SUSPENDED'],
};

const EVENT_TYPE_FOR_STATUS: Record<PatchableEntitlementStatus, string> = {
  ACTIVE: 'PRODUCT_ENTITLEMENT_ACTIVATED',
  SUSPENDED: 'PRODUCT_ENTITLEMENT_SUSPENDED',
  REVOKED: 'PRODUCT_ENTITLEMENT_REVOKED',
};

/**
 * Phase 2B.2 — Product Entitlement lifecycle management
 * (docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md). Every method is reachable only
 * through PlatformPermissionsGuard (`PRODUCT_ENTITLEMENT_VIEW`/`_MANAGE`) —
 * see TenantEntitlementsController. tenantId always comes from the request
 * path, existence-checked (TenantsService.findById) before any entitlement
 * operation runs, and passed explicitly to the repository as the RLS
 * acting-tenant context — never inferred from the (nonexistent, for a
 * Platform Operator) ambient tenant.
 */
@Injectable()
export class TenantProductEntitlementsService {
  constructor(
    private readonly repository: TenantProductEntitlementsRepository,
    private readonly tenantsService: TenantsService,
    private readonly productsService: ProductsService,
    private readonly access: ProductAccessService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async list(tenantId: string): Promise<(TenantProductEntitlement & { product: { id: string; name: string; slug: string; status: string } })[]> {
    await this.tenantsService.findById(tenantId); // 404s an unknown tenant
    return this.repository.listForTenant(tenantId);
  }

  async findOne(tenantId: string, productId: string): Promise<TenantProductEntitlement> {
    await this.tenantsService.findById(tenantId);
    const entitlement = await this.repository.findByTenantAndProduct(tenantId, productId);
    if (!entitlement) {
      throw new ResourceNotFoundException('TenantProductEntitlement', productId);
    }
    return entitlement;
  }

  async create(tenantId: string, productId: string): Promise<TenantProductEntitlement> {
    await this.tenantsService.findById(tenantId);
    await this.productsService.findOne(productId); // 404s an unknown product

    const existing = await this.repository.findByTenantAndProduct(tenantId, productId);
    if (existing) {
      throw new ResourceConflictException('TenantProductEntitlement', 'This tenant already has an entitlement record for this product — use the status endpoint to change it');
    }

    // The existence check above is a courtesy for the common case — the
    // actual duplicate-prevention guarantee is uk_tenant_product_entitlement
    // (database/ddl/007_tenant_product_entitlement.sql), which is what
    // makes this race-safe: two concurrent creates for the same
    // (tenant, product) can both pass the check above, but only one INSERT
    // ever succeeds; the other hits this constraint and is translated to
    // the same 409 rather than surfacing as an unhandled error (Step 24/45,
    // Case A). AllExceptionsFilter's own P2002 mapping exists but isn't
    // globally wired in this codebase yet (a separate, pre-existing gap —
    // see docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md's Known Issues) — this
    // catch is a local, contained fix, not a redesign of error handling.
    let entitlement: TenantProductEntitlement;
    try {
      entitlement = await this.repository.create(tenantId, productId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ResourceConflictException('TenantProductEntitlement', 'This tenant already has an entitlement record for this product — use the status endpoint to change it');
      }
      throw error;
    }
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'PRODUCT_ENTITLEMENT_CREATED',
      resourceType: 'TenantProductEntitlement',
      resourceId: entitlement.id,
      metadata: { tenantId, productId, status: entitlement.status },
    });
    return entitlement;
  }

  async updateStatus(tenantId: string, productId: string, targetStatus: PatchableEntitlementStatus): Promise<TenantProductEntitlement> {
    await this.tenantsService.findById(tenantId);
    const current = await this.findOne(tenantId, productId);

    const fromStatuses = ALLOWED_FROM_STATUSES[targetStatus];
    if (current.status === targetStatus) {
      throw new AppException('ENTITLEMENT_ALREADY_IN_STATUS', `This entitlement is already ${targetStatus}`, HttpStatus.CONFLICT);
    }
    const applied = await this.repository.transition(tenantId, productId, fromStatuses, targetStatus);
    if (!applied) {
      const fresh = await this.repository.findByTenantAndProduct(tenantId, productId);
      throw new AppException(
        'INVALID_ENTITLEMENT_TRANSITION',
        `Cannot transition to ${targetStatus} — current status is ${fresh?.status}, which does not allow this transition (or a concurrent change already applied a stronger one). Use POST .../reactivate to restore a REVOKED entitlement.`,
        HttpStatus.CONFLICT,
      );
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: EVENT_TYPE_FOR_STATUS[targetStatus],
      resourceType: 'TenantProductEntitlement',
      resourceId: current.id,
      metadata: { tenantId, productId, fromStatus: current.status, toStatus: targetStatus },
    });
    return this.findOne(tenantId, productId);
  }

  /**
   * The one and only path from REVOKED back to ACTIVE — a distinct
   * action/endpoint on purpose (Step 28: "Do not silently convert REVOKED
   * back to ACTIVE. If reactivation is supported, make it an explicit
   * transition."), audited as its own event type
   * (`PRODUCT_ENTITLEMENT_REACTIVATED`), not folded into the generic
   * `PRODUCT_ENTITLEMENT_ACTIVATED` a SUSPENDED->ACTIVE transition produces.
   */
  async reactivate(tenantId: string, productId: string): Promise<TenantProductEntitlement> {
    await this.tenantsService.findById(tenantId);
    const current = await this.findOne(tenantId, productId);

    const applied = await this.repository.transition(tenantId, productId, ['REVOKED'], 'ACTIVE');
    if (!applied) {
      throw new AppException(
        'INVALID_ENTITLEMENT_TRANSITION',
        `Cannot reactivate — current status is ${current.status}, not REVOKED`,
        HttpStatus.CONFLICT,
      );
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'PRODUCT_ENTITLEMENT_REACTIVATED',
      resourceType: 'TenantProductEntitlement',
      resourceId: current.id,
      metadata: { tenantId, productId, fromStatus: 'REVOKED', toStatus: 'ACTIVE' },
    });
    return this.findOne(tenantId, productId);
  }

  /** Tenant self-service view — see TenantEntitlementsSelfController. Includes the computed, deny-by-default `eligible` flag (ProductAccessService), not just the raw entitlement status, so a caller doesn't have to re-derive Product-status precedence themselves. */
  async listForCallersOwnTenant(tenantId: string) {
    const rows = await this.repository.listForTenant(tenantId);
    return Promise.all(
      rows.map(async (row) => ({
        productId: row.productId,
        productName: row.product.name,
        productSlug: row.product.slug,
        status: row.status,
        eligible: (await this.access.canAccess(tenantId, row.productId)).allowed,
      })),
    );
  }
}
