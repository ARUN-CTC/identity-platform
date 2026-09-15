import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, ServiceAccountTenantGrant } from '@prisma/client';
import { AppException, RequestContextService, ResourceConflictException, ResourceNotFoundException } from '../../../common';
import { TenantsService } from '../../tenants/services/tenants.service';
import { SecurityEventsService } from '../../security-audit/services';
import { PatchableGrantStatus } from '../dto/update-tenant-grant-status.dto';
import { GrantStatus, ServiceAccountTenantGrantsRepository } from '../repositories';
import { ServiceAccountsService } from './service-accounts.service';

/** The only path INTO each target status via the generic PATCH endpoint — REVOKED -> ACTIVE is deliberately excluded here (see reactivate()), the exact same shape as TenantProductEntitlementsService. */
const ALLOWED_FROM_STATUSES: Record<PatchableGrantStatus, GrantStatus[]> = {
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
  REVOKED: ['ACTIVE', 'SUSPENDED'],
};

const EVENT_TYPE_FOR_STATUS: Record<PatchableGrantStatus, string> = {
  ACTIVE: 'SERVICE_ACCOUNT_TENANT_GRANT_ACTIVATED',
  SUSPENDED: 'SERVICE_ACCOUNT_TENANT_GRANT_SUSPENDED',
  REVOKED: 'SERVICE_ACCOUNT_TENANT_GRANT_REVOKED',
};

/**
 * Phase 2D.3 (docs/PHASE_2D3.md, docs/adr/ADR-015-service-tenant-authorization.md
 * as amended) — ServiceAccountTenantGrant lifecycle management, deliberately
 * built as the direct structural twin of
 * TenantProductEntitlementsService (Phase 2B.2): state-machine-guarded
 * conditional transitions, a dedicated reactivate() action (REVOKED -> ACTIVE
 * is never reachable through the generic status PATCH), and the DB-level
 * UNIQUE(service_account_id, tenant_id) constraint — not merely an
 * application-level pre-check — as the actual concurrency guarantee.
 *
 * Every method takes tenantId explicitly from the request path
 * (/v1/platform/tenants/:tenantId/service-account-grants), existence-
 * checked before any grant operation runs, and passed to the repository as
 * the RLS acting-tenant context — never inferred from an ambient tenant a
 * Platform Operator does not have.
 *
 * A grant here answers ONE question — may this ServiceAccount act for this
 * Tenant at all — and nothing more: it never implies Product access
 * (TenantProductEntitlement's own, entirely independent question,
 * unchanged, un-duplicated — see ServiceAccountsModule's own comment) and
 * carries no organization_id (organization context remains a human/
 * Membership concern a service identity never inherits).
 */
@Injectable()
export class ServiceAccountTenantGrantsService {
  constructor(
    private readonly repository: ServiceAccountTenantGrantsRepository,
    private readonly tenantsService: TenantsService,
    private readonly serviceAccountsService: ServiceAccountsService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async list(
    tenantId: string,
  ): Promise<(ServiceAccountTenantGrant & { serviceAccount: { id: string; name: string; status: string; applicationId: string } })[]> {
    await this.tenantsService.findById(tenantId); // 404s an unknown tenant
    return this.repository.listForTenant(tenantId);
  }

  async findOne(tenantId: string, serviceAccountId: string): Promise<ServiceAccountTenantGrant> {
    await this.tenantsService.findById(tenantId);
    const grant = await this.repository.findByServiceAccountAndTenant(tenantId, serviceAccountId);
    if (!grant) {
      throw new ResourceNotFoundException('ServiceAccountTenantGrant', serviceAccountId);
    }
    return grant;
  }

  async create(tenantId: string, serviceAccountId: string): Promise<ServiceAccountTenantGrant> {
    await this.tenantsService.findById(tenantId);
    await this.serviceAccountsService.findOne(serviceAccountId); // 404s an unknown ServiceAccount

    const existing = await this.repository.findByServiceAccountAndTenant(tenantId, serviceAccountId);
    if (existing) {
      throw new ResourceConflictException('ServiceAccountTenantGrant', 'This service account already has a grant record for this tenant — use the status endpoint to change it');
    }

    // The existence check above is a courtesy for the common case — the
    // actual duplicate-prevention guarantee is uk_service_account_tenant_grant
    // (database/ddl/009_service_account.sql), the same reason
    // TenantProductEntitlementsService's own create() carries an identical
    // local P2002 catch (the global AllExceptionsFilter's P2002 mapping is
    // not wired anywhere in this codebase — a separate, pre-existing,
    // already-documented gap, not fixed by this local, contained handling).
    let grant: ServiceAccountTenantGrant;
    try {
      grant = await this.repository.create(tenantId, serviceAccountId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ResourceConflictException('ServiceAccountTenantGrant', 'This service account already has a grant record for this tenant — use the status endpoint to change it');
      }
      throw error;
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'SERVICE_ACCOUNT_TENANT_GRANT_CREATED',
      resourceType: 'ServiceAccountTenantGrant',
      resourceId: grant.id,
      metadata: { tenantId, serviceAccountId, status: grant.status },
    });
    return grant;
  }

  async updateStatus(tenantId: string, serviceAccountId: string, targetStatus: PatchableGrantStatus): Promise<ServiceAccountTenantGrant> {
    await this.tenantsService.findById(tenantId);
    const current = await this.findOne(tenantId, serviceAccountId);

    const fromStatuses = ALLOWED_FROM_STATUSES[targetStatus];
    if (current.status === targetStatus) {
      throw new AppException('GRANT_ALREADY_IN_STATUS', `This grant is already ${targetStatus}`, HttpStatus.CONFLICT);
    }
    const applied = await this.repository.transition(tenantId, serviceAccountId, fromStatuses, targetStatus);
    if (!applied) {
      const fresh = await this.repository.findByServiceAccountAndTenant(tenantId, serviceAccountId);
      throw new AppException(
        'INVALID_GRANT_TRANSITION',
        `Cannot transition to ${targetStatus} — current status is ${fresh?.status}, which does not allow this transition (or a concurrent change already applied a stronger one). Use POST .../reactivate to restore a REVOKED grant.`,
        HttpStatus.CONFLICT,
      );
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: EVENT_TYPE_FOR_STATUS[targetStatus],
      resourceType: 'ServiceAccountTenantGrant',
      resourceId: current.id,
      metadata: { tenantId, serviceAccountId, fromStatus: current.status, toStatus: targetStatus },
    });
    return this.findOne(tenantId, serviceAccountId);
  }

  /**
   * The one and only path from REVOKED back to ACTIVE — a distinct
   * action/endpoint on purpose (Step 16: "If reactivation is allowed,
   * require the explicit approved reactivation operation. Do not make
   * generic PATCH capable of bypassing lifecycle rules."), audited as its
   * own event type, not folded into the generic
   * SERVICE_ACCOUNT_TENANT_GRANT_ACTIVATED a SUSPENDED->ACTIVE transition
   * produces.
   */
  async reactivate(tenantId: string, serviceAccountId: string): Promise<ServiceAccountTenantGrant> {
    await this.tenantsService.findById(tenantId);
    const current = await this.findOne(tenantId, serviceAccountId);

    const applied = await this.repository.transition(tenantId, serviceAccountId, ['REVOKED'], 'ACTIVE');
    if (!applied) {
      throw new AppException('INVALID_GRANT_TRANSITION', `Cannot reactivate — current status is ${current.status}, not REVOKED`, HttpStatus.CONFLICT);
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'SERVICE_ACCOUNT_TENANT_GRANT_REACTIVATED',
      resourceType: 'ServiceAccountTenantGrant',
      resourceId: current.id,
      metadata: { tenantId, serviceAccountId, fromStatus: 'REVOKED', toStatus: 'ACTIVE' },
    });
    return this.findOne(tenantId, serviceAccountId);
  }

  /**
   * Future Client Credentials pipeline integration point (docs/PHASE_2D3.md
   * §Future pipeline) — narrower than a full composed eligibility facade
   * (that composition, which would also need Application/Product status,
   * belongs to whichever future phase actually builds /token — this method
   * only ever answers the ONE question that belongs to this table): is
   * there an ACTIVE grant for this exact (serviceAccount, tenant) pair,
   * right now? Never assumes anything from a token claim — always a live
   * read.
   */
  async isGrantActive(tenantId: string, serviceAccountId: string): Promise<boolean> {
    const grant = await this.repository.findByServiceAccountAndTenant(tenantId, serviceAccountId);
    return grant?.status === 'ACTIVE';
  }
}
