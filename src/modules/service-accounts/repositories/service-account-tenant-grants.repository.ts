import { Injectable } from '@nestjs/common';
import { ServiceAccountTenantGrant } from '@prisma/client';
import { RequestContextService } from '../../../common';
import { PrismaContextService } from '../../../database';

export type GrantStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

/**
 * Phase 2D.3 — service_account_tenant_grant is tenant-scoped and
 * RLS-protected (apply_tenant_rls, database/ddl/009_service_account.sql) —
 * every method takes tenantId explicitly and passes it as
 * PrismaContextService's actingAsTenantId, the exact pattern
 * TenantProductEntitlementsRepository already uses for the identical
 * reason: the caller is a Platform Operator with no ambient tenant
 * context, administering a tenant named explicitly in the request path
 * (/v1/platform/tenants/:tenantId/service-account-grants) — RLS is fully
 * enforced for the duration of each call, scoped to precisely that tenant.
 */
@Injectable()
export class ServiceAccountTenantGrantsRepository {
  constructor(
    private readonly prismaContext: PrismaContextService,
    private readonly context: RequestContextService,
  ) {}

  private actor(): string | undefined {
    return this.context.userId;
  }

  findByServiceAccountAndTenant(tenantId: string, serviceAccountId: string): Promise<ServiceAccountTenantGrant | null> {
    return this.prismaContext.runInContext((tx) => tx.serviceAccountTenantGrant.findFirst({ where: { tenantId, serviceAccountId } }), tenantId);
  }

  async listForTenant(
    tenantId: string,
  ): Promise<(ServiceAccountTenantGrant & { serviceAccount: { id: string; name: string; status: string; applicationId: string } })[]> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.serviceAccountTenantGrant.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'asc' },
          include: { serviceAccount: { select: { id: true, name: true, status: true, applicationId: true } } },
        }),
      tenantId,
    );
  }

  create(tenantId: string, serviceAccountId: string): Promise<ServiceAccountTenantGrant> {
    return this.prismaContext.runInContext(
      (tx) => tx.serviceAccountTenantGrant.create({ data: { tenantId, serviceAccountId, createdBy: this.actor() } }),
      tenantId,
    );
  }

  /**
   * State-machine-guarded UPDATE — same pattern as
   * TenantProductEntitlementsRepository.transition(): the WHERE clause
   * checks the expected current status(es) atomically under the row's own
   * lock, so concurrent transitions resolve deterministically (REVOKE,
   * reachable from both ACTIVE and SUSPENDED, always wins over a
   * concurrent SUSPEND, reachable only from ACTIVE — the same asymmetric-
   * fromStatuses mechanism, not a special case). Returns whether the
   * transition actually applied.
   */
  async transition(tenantId: string, serviceAccountId: string, fromStatuses: GrantStatus[], toStatus: GrantStatus): Promise<boolean> {
    const result = await this.prismaContext.runInContext(
      (tx) =>
        tx.serviceAccountTenantGrant.updateMany({
          where: { tenantId, serviceAccountId, status: { in: fromStatuses } },
          data: { status: toStatus, updatedBy: this.actor() },
        }),
      tenantId,
    );
    return result.count === 1;
  }
}
