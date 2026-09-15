import { Injectable } from '@nestjs/common';
import { Membership, Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../../common';
import { PrismaContextService } from '../../../database';
import { MembershipStatus } from '../dto/membership-status';

/**
 * Phase 2A — the Identity <-> Organization link (docs/PHASE_2A.md,
 * docs/adr/ADR-002-tenant-organization-model.md). Every method takes
 * tenantId explicitly rather than reading it from ambient
 * RequestContextService: membership existence/status is checked from
 * places that don't have an authenticated request context yet (login,
 * invitation accept) as well as from places that do (guards,
 * admin endpoints) — same reasoning SessionsRepository/
 * InvitationTokensRepository already document for themselves.
 */
@Injectable()
export class MembershipsRepository {
  constructor(private readonly prismaContext: PrismaContextService) {}

  async create(
    tenantId: string,
    organizationId: string,
    userId: string,
    status: MembershipStatus,
    actorUserId: string | undefined,
  ): Promise<Membership> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.membership.create({
          data: { tenantId, organizationId, userId, status, createdBy: actorUserId },
        }),
      tenantId,
    );
  }

  async findByUserAndOrg(tenantId: string, userId: string, organizationId: string): Promise<Membership | null> {
    return this.prismaContext.runInContext(
      (tx) => tx.membership.findFirst({ where: { tenantId, userId, organizationId } }),
      tenantId,
    );
  }

  async findById(tenantId: string, id: string): Promise<Membership | null> {
    return this.prismaContext.runInContext((tx) => tx.membership.findFirst({ where: { tenantId, id } }), tenantId);
  }

  /**
   * Authorization's other core precondition, alongside
   * UserRolesRepository.resolveGrants(): does this (global) user actually
   * belong to organizationId at all, right now? A role grant scoped to an
   * organization is only ever effective when this also returns true — see
   * docs/PHASE_2A.md, "Membership is the authorization gate".
   */
  async hasActiveMembership(tenantId: string, userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.prismaContext.runInContext(
      (tx) => tx.membership.findFirst({ where: { tenantId, userId, organizationId, status: 'ACTIVE' }, select: { id: true } }),
      tenantId,
    );
    return membership !== null;
  }

  /**
   * Is this user part of tenantId at all — via ANY organization? Backs
   * tenant-wide (organization_id IS NULL) role grants, and login's
   * "does this global Identity actually belong to the tenant named by
   * tenantCode" check.
   */
  async hasActiveMembershipInTenant(tenantId: string, userId: string): Promise<boolean> {
    const membership = await this.prismaContext.runInContext(
      (tx) => tx.membership.findFirst({ where: { tenantId, userId, status: 'ACTIVE' }, select: { id: true } }),
      tenantId,
    );
    return membership !== null;
  }

  async listForOrganization(
    tenantId: string,
    organizationId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: (Membership & { user: { id: string; email: string; firstName: string | null; lastName: string | null; status: string } })[]; total: number }> {
    const where: Prisma.MembershipWhereInput = { tenantId, organizationId };
    return this.prismaContext.runInContext(async (tx) => {
      const [items, total] = await Promise.all([
        tx.membership.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } } },
        }),
        tx.membership.count({ where }),
      ]);
      return { items, total };
    }, tenantId);
  }

  /**
   * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — org-context
   * discovery, run BEFORE any tenant is known. Given only an authenticated
   * userId and a client-requested organizationId, finds that user's ACTIVE
   * membership in that organization regardless of which tenant it belongs
   * to. This is what lets context-switch resolve "which tenant does this
   * organization belong to, for THIS caller" without ever trusting a
   * client-supplied tenantId.
   *
   * Deliberately passes no actingAsTenantId to runInContext: there is no
   * tenant to act as yet — that's exactly the chicken-and-egg problem this
   * method exists to break. It relies entirely on the narrow, read-only
   * self-visibility carve-out in the `membership` RLS policy
   * (database/ddl/008_organization_context.sql), which matches rows only
   * against this connection's OWN authenticated current_user_id() GUC (set
   * from ambient RequestContextService.userId by PrismaContextService,
   * never from client input) — never a client-supplied tenantId or userId.
   * The `userId` parameter here is redundant with that GUC by construction
   * (both trace back to the same authenticated caller) and is kept as an
   * explicit, defense-in-depth WHERE clause rather than relying on RLS alone.
   */
  async findByUserAndOrgAnyTenant(userId: string, organizationId: string): Promise<Membership | null> {
    return this.prismaContext.runInContext((tx) =>
      tx.membership.findFirst({ where: { userId, organizationId, status: 'ACTIVE' } }),
    );
  }

  /**
   * Every ACTIVE membership this (global) user holds, across every tenant
   * and organization — backs `GET /v1/me/organizations`, the list a caller
   * chooses their next context-switch target from. Same cross-tenant
   * self-visibility RLS carve-out as findByUserAndOrgAnyTenant() for the
   * membership rows themselves.
   *
   * Deliberately does NOT `include: { organization, tenant }` on the same
   * query: `organization` (unlike `membership`) still has the STANDARD,
   * unrelaxed apply_tenant_rls policy, which is exactly right for every
   * other caller of that table — but it means a single ambient-GUC query
   * spanning multiple tenants can only ever see one tenant's organizations
   * at a time. So this fetches the plain membership rows first (no
   * tenant-scoped GUC needed, same as findByUserAndOrgAnyTenant), groups
   * them by tenantId, then fetches each tenant's organizations with THAT
   * tenant's own actingAsTenantId — the same explicit-tenant-override
   * pattern PlatformOperator cross-tenant administration already uses
   * (Phase 2B.1) — and merges the results in application code. `tenant`
   * itself carries no RLS at all (it has no tenant_id column to scope by),
   * so those rows are fetched in one plain query with no override needed.
   */
  async listActiveForUser(userId: string): Promise<
    (Membership & {
      organization: { id: string; organizationName: string; status: string };
      tenant: { id: string; tenantCode: string; tenantName: string; status: string };
    })[]
  > {
    const memberships = await this.prismaContext.runInContext((tx) =>
      tx.membership.findMany({ where: { userId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } }),
    );
    if (memberships.length === 0) {
      return [];
    }

    const tenantIds = [...new Set(memberships.map((m) => m.tenantId))];
    const organizationsByTenant = await Promise.all(
      tenantIds.map((tenantId) =>
        this.prismaContext.runInContext(
          (tx) =>
            tx.organization.findMany({
              where: { tenantId, id: { in: memberships.filter((m) => m.tenantId === tenantId).map((m) => m.organizationId) } },
              select: { id: true, organizationName: true, status: true },
            }),
          tenantId,
        ),
      ),
    );
    const organizationsById = new Map(organizationsByTenant.flat().map((o) => [o.id, o]));

    const tenants = await this.prismaContext.runInContext((tx) =>
      tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, tenantCode: true, tenantName: true, status: true } }),
    );
    const tenantsById = new Map(tenants.map((t) => [t.id, t]));

    return memberships.flatMap((membership) => {
      const organization = organizationsById.get(membership.organizationId);
      const tenant = tenantsById.get(membership.tenantId);
      // Both lookups are expected to always hit (FKs guarantee the rows
      // exist) — skip defensively rather than throw if a row was ever
      // hard-deleted out from under a still-referencing membership.
      if (!organization || !tenant) {
        return [];
      }
      return [{ ...membership, organization, tenant }];
    });
  }

  async setStatus(
    tenantId: string,
    userId: string,
    organizationId: string,
    status: MembershipStatus,
    actorUserId: string | undefined,
  ): Promise<Membership> {
    return this.prismaContext.runInContext(
      (tx) =>
        tx.membership.update({
          where: { userId_organizationId: { userId, organizationId } },
          data: { status, updatedBy: actorUserId },
        }),
      tenantId,
    );
  }
}
