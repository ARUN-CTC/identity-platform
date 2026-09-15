import { Injectable } from '@nestjs/common';
import { TenantProductEntitlement } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService } from '../../../database';

export type EntitlementStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

/**
 * Phase 2B.2 — tenant_product_entitlement is tenant-scoped and RLS-protected
 * (apply_tenant_rls, database/ddl/007_tenant_product_entitlement.sql) —
 * every method takes tenantId explicitly and passes it as
 * PrismaContextService's actingAsTenantId, exactly the pattern
 * SessionsRepository/RefreshTokensRepository already use for callers with
 * no ambient tenant context. Here the caller is usually a Platform
 * Operator managing another tenant's entitlement — this is the "explicit,
 * server-validated tenant administration context" docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md
 * describes, never a BYPASSRLS shortcut: the tenantId comes from the
 * request path, is existence-checked by the service layer
 * (TenantsService.findById), and the RLS GUC is set to *exactly* that
 * tenant for the duration of the call — a request naming tenant A can
 * never see or write tenant B's rows through this repository.
 */
@Injectable()
export class TenantProductEntitlementsRepository {
  constructor(
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  private actor(): string | undefined {
    // A Platform Operator's own security_user.id (RequestContextService.userId
    // is populated by PlatformJwtAuthGuard too — see its own comment) or, for
    // the tenant self-service read path, the ambient tenant user.
    return this.context.userId;
  }

  findByTenantAndProduct(tenantId: string, productId: string): Promise<TenantProductEntitlement | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.tenantProductEntitlement.findFirst({ where: { tenantId, productId } }),
      tenantId,
    );
  }

  findById(tenantId: string, id: string): Promise<TenantProductEntitlement | null> {
    return this.prismaContext.runInContext((tx) => tx.tenantProductEntitlement.findFirst({ where: { id, tenantId } }), tenantId);
  }

  async listForTenant(tenantId: string): Promise<(TenantProductEntitlement & { product: { id: string; name: string; slug: string; status: string } })[]> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.tenantProductEntitlement.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'asc' },
          include: { product: { select: { id: true, name: true, slug: true, status: true } } },
        }),
      tenantId,
    );
  }

  create(tenantId: string, productId: string): Promise<TenantProductEntitlement> {
    return this.prismaContext.runInContext(
      (tx) => tx.tenantProductEntitlement.create({ data: { tenantId, productId, createdBy: this.actor() } }),
      tenantId,
    );
  }

  /**
   * State-machine-guarded UPDATE: the WHERE clause checks the expected
   * current status(es) atomically, under the row's own lock — this is what
   * makes concurrent transitions resolve deterministically (including
   * "REVOKE wins over a concurrent SUSPEND" — see
   * docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md, "Concurrency") rather than a
   * plain last-write-wins overwrite. Returns whether the transition
   * actually applied (false = the row was no longer in an expected
   * fromStatus by the time this ran, e.g. a concurrent stronger transition
   * already won).
   */
  async transition(tenantId: string, productId: string, fromStatuses: EntitlementStatus[], toStatus: EntitlementStatus): Promise<boolean> {
    const result = await this.prismaContext.runInContext(
      (tx) =>
        tx.tenantProductEntitlement.updateMany({
          where: { tenantId, productId, status: { in: fromStatuses } },
          data: { status: toStatus, updatedBy: this.actor() },
        }),
      tenantId,
    );
    return result.count === 1;
  }
}
