import { HttpStatus, Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { AppException, RequestContextService } from '../../../common';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import { UserRolesService } from '../../users/services/user-roles.service';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 *
 * The one place a client-supplied `organizationId` is turned into "yes, this
 * caller may act against this organization" for an organization-scoped
 * write. Composes two mechanisms that already exist and are already
 * authoritative:
 *   - OrganizationsService.findOne() — RLS/tenant-scoped existence check.
 *   - UserRolesService.resolveGrants(tenantId, userId, organizationId) —
 *     the single authoritative grant-resolution function, which unions the
 *     caller's tenant-wide grants (organizationId IS NULL) with grants
 *     scoped to exactly this organization.
 * Tenant match is implicit: RequestContextService.requireTenantId() throws
 * before either check runs if the caller has no verified tenant context.
 *
 * Callers pass the exact same permission code already required by the
 * route's own @RequirePermissions(...) decorator — this method does not
 * replace that check; it re-resolves the same permission against the
 * *specific* organizationId in the request body.
 */
@Injectable()
export class OrganizationAccessService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly userRolesService: UserRolesService,
    private readonly context: RequestContextService,
  ) {}

  /**
   * Resolves and authorizes `organizationId` for the current caller,
   * returning the Organization so callers don't need a second read. Fails
   * closed with the application's standard authorization exception
   * (AppException, 403 FORBIDDEN) — never silently falls back to
   * tenant-wide access, another organization, or partial success.
   */
  async requireOrganizationAccess(organizationId: string, permission: string): Promise<Organization> {
    const tenantId = this.context.requireTenantId();
    const userId = this.context.userId;

    // Also the existence check every call site would otherwise need;
    // RLS-scoped, so a foreign-tenant id 404s exactly like a nonexistent one.
    const organization = await this.organizationsService.findOne(organizationId);

    if (!userId) {
      throw new AppException('ORGANIZATION_ACCESS_DENIED', 'Authentication required to operate against an organization', HttpStatus.FORBIDDEN);
    }

    const { permissionCodes } = await this.userRolesService.resolveGrants(tenantId, userId, organizationId);
    if (!permissionCodes.includes(permission)) {
      throw new AppException(
        'ORGANIZATION_ACCESS_DENIED',
        `You do not have ${permission} for organization ${organizationId} — this requires either a tenant-wide grant or a grant scoped to this organization.`,
        HttpStatus.FORBIDDEN,
      );
    }

    return organization;
  }
}
