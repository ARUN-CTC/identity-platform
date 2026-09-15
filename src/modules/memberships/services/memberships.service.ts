import { HttpStatus, Injectable } from '@nestjs/common';
import { Membership } from '@prisma/client';
import { AppException, PaginatedResult, PaginationQueryDto, RequestContextService, ResourceConflictException } from '../../../common';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { SecurityEventsService } from '../../security-audit/services';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { AdminSettableMembershipStatus, MembershipStatus } from '../dto/membership-status';

/**
 * Phase 2A — the service backing the Membership entity
 * (docs/PHASE_2A.md, docs/IDENTITY_DOMAIN_MODEL.md). Membership is what
 * makes a global Identity "belong to" a Tenant/Organization; every
 * organization-scoped authorization check in this platform now depends on
 * a Membership existing and being ACTIVE — see UserRolesRepository.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly repository: MembershipsRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  /**
   * Called only from within the invitation/user-creation flow
   * (UsersService, UserInvitationsService) — never exposed directly as a
   * public "create a membership" endpoint, since a Membership is always the
   * result of either an invitation being accepted or an existing global
   * Identity being added to a second organization by an admin who already
   * holds USER_MANAGE for the tenant.
   */
  async create(tenantId: string, organizationId: string, userId: string, status: MembershipStatus): Promise<Membership> {
    const existing = await this.repository.findByUserAndOrg(tenantId, userId, organizationId);
    if (existing) {
      throw new ResourceConflictException('Membership', 'This user already has a membership in this organization');
    }
    const membership = await this.repository.create(tenantId, organizationId, userId, status, this.context.userId);
    await this.securityEvents.record({
      tenantId,
      actorUserId: this.context.userId,
      eventType: 'iam.membership_created',
      resourceType: 'Membership',
      resourceId: membership.id,
      metadata: { organizationId, userId, status },
    });
    return membership;
  }

  async hasActiveMembership(tenantId: string, userId: string, organizationId: string): Promise<boolean> {
    return this.repository.hasActiveMembership(tenantId, userId, organizationId);
  }

  async hasActiveMembershipInTenant(tenantId: string, userId: string): Promise<boolean> {
    return this.repository.hasActiveMembershipInTenant(tenantId, userId);
  }

  /**
   * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) — every
   * organization this global Identity can select as their active context,
   * across every tenant they belong to. Backs `GET /v1/me/organizations`.
   */
  listMyOrganizations(userId: string) {
    return this.repository.listActiveForUser(userId);
  }

  /**
   * PHASE 2C — cross-tenant context-switch discovery: does this user have
   * an ACTIVE membership in organizationId, and if so, which tenant does it
   * belong to? See MembershipsRepository.findByUserAndOrgAnyTenant() for why
   * this is safe without a tenantId in hand yet.
   */
  findMyMembershipInOrganization(userId: string, organizationId: string) {
    return this.repository.findByUserAndOrgAnyTenant(userId, organizationId);
  }

  async listForOrganization(organizationId: string, query: PaginationQueryDto) {
    const tenantId = this.context.requireTenantId();
    // RLS-scoped existence check — 404s a foreign-tenant organizationId
    // exactly like OrganizationAccessService does, without duplicating its
    // permission-resolution (this endpoint's own @RequirePermissions already
    // covers that — see MembershipsController).
    await this.organizationsService.findOne(organizationId);
    const { items, total } = await this.repository.listForOrganization(tenantId, organizationId, query);
    return new PaginatedResult(items, total, query);
  }

  async setStatus(organizationId: string, userId: string, status: AdminSettableMembershipStatus): Promise<Membership> {
    const tenantId = this.context.requireTenantId();
    await this.organizationsService.findOne(organizationId);
    const existing = await this.repository.findByUserAndOrg(tenantId, userId, organizationId);
    if (!existing) {
      throw new AppException('MEMBERSHIP_NOT_FOUND', `No membership found for this user in organization ${organizationId}`, HttpStatus.NOT_FOUND);
    }
    const updated = await this.repository.setStatus(tenantId, userId, organizationId, status, this.context.userId);
    await this.securityEvents.record({
      tenantId,
      actorUserId: this.context.userId,
      eventType: status === 'REMOVED' ? 'iam.membership_removed' : 'iam.membership_status_changed',
      resourceType: 'Membership',
      resourceId: updated.id,
      metadata: { organizationId, userId, fromStatus: existing.status, toStatus: status },
    });
    return updated;
  }
}
