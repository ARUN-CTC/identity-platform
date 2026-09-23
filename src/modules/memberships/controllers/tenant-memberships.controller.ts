import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, SkipTenantStatusCheck } from '../../../common';
import { ListMembershipsQueryDto } from '../dto';
import { MembershipsService } from '../services/memberships.service';

/**
 * Phase 2UI.4 — the tenant-wide counterpart to MembershipsController's
 * per-organization `/organizations/:organizationId/members`. Read-only:
 * status transitions still go through the existing nested route, since a
 * membership is always changed in the context of one specific organization.
 * Gated by the same `USER_VIEW` permission as the nested list — this is a
 * read of the same underlying rows, just unscoped from a single
 * organization, never a broader grant.
 */
@ApiTags('memberships')
@SkipTenantStatusCheck()
@Controller('memberships')
export class TenantMembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermissions('USER_VIEW')
  @ApiOperation({ summary: "List memberships across the caller's tenant, optionally filtered by organization, user, or status" })
  list(@Query() query: ListMembershipsQueryDto) {
    const { organizationId, userId, status } = query;
    return this.memberships.listForTenant(query, { organizationId, userId, status });
  }
}
