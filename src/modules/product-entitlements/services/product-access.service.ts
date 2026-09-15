import { Injectable } from '@nestjs/common';
import { ProductsRepository } from '../../products/repositories';
import { TenantProductEntitlementsRepository } from '../repositories/tenant-product-entitlements.repository';

export type ProductAccessDenialReason = 'PRODUCT_NOT_FOUND' | 'PRODUCT_DISABLED' | 'NO_ENTITLEMENT' | 'ENTITLEMENT_SUSPENDED' | 'ENTITLEMENT_REVOKED';

export interface ProductAccessDecision {
  allowed: boolean;
  reason?: ProductAccessDenialReason;
}

/**
 * Phase 2B.2 — the single, central "may this Tenant use this Product"
 * decision point (docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md, "Access
 * evaluation"). Every caller that needs this answer — the tenant
 * self-service read endpoint today, a future per-product API-boundary
 * check, Phase 2C's organization-context integration — calls this one
 * service. It knows nothing about TravelOS, Healthcare, or Gym
 * specifically, and nothing about product business logic — only Product.status
 * and TenantProductEntitlement.status.
 *
 * Deny-by-default (Security Invariant #6-#9): every branch below defaults
 * to denying; only the one fully-valid path (product ACTIVE + entitlement
 * ACTIVE) allows. Product.status takes precedence over entitlement status
 * (Step 11) — a disabled Product denies every tenant regardless of their
 * own entitlement's own status.
 */
@Injectable()
export class ProductAccessService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly entitlements: TenantProductEntitlementsRepository,
  ) {}

  async canAccess(tenantId: string, productId: string): Promise<ProductAccessDecision> {
    const product = await this.products.findById(productId);
    if (!product) {
      return { allowed: false, reason: 'PRODUCT_NOT_FOUND' };
    }
    if (product.status !== 'ACTIVE') {
      return { allowed: false, reason: 'PRODUCT_DISABLED' };
    }

    const entitlement = await this.entitlements.findByTenantAndProduct(tenantId, productId);
    if (!entitlement) {
      return { allowed: false, reason: 'NO_ENTITLEMENT' };
    }
    if (entitlement.status === 'SUSPENDED') {
      return { allowed: false, reason: 'ENTITLEMENT_SUSPENDED' };
    }
    if (entitlement.status === 'REVOKED') {
      return { allowed: false, reason: 'ENTITLEMENT_REVOKED' };
    }

    return { allowed: true };
  }
}
