import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { UpdateMembershipStatusDto } from '../dto';
import { MembershipsService } from '../services/memberships.service';

/**
 * Phase 2A — read/status-transition surface for Membership. Deliberately
 * NOT a general create/delete CRUD API: a membership is only ever created
 * by the invitation-accept flow or by UsersService.create() adding an
 * existing global Identity to a second organization (docs/PHASE_2A.md) —
 * see UsersController/InvitationsController for those paths.
 */
@ApiTags('memberships')
@ApiParam({ name: 'organizationId', format: 'uuid' })
@SkipTenantStatusCheck()
@Controller('organizations/:organizationId/members')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermissions('USER_VIEW')
  @ApiOperation({ summary: 'List memberships (users) in an organization' })
  list(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Query() query: PaginationQueryDto) {
    return this.memberships.listForOrganization(organizationId, query);
  }

  @Patch(':userId')
  @RequirePermissions('USER_MANAGE')
  @ApiOperation({
    summary: 'Change a membership status (ACTIVE / SUSPENDED / REMOVED)',
    description:
      'REMOVED ends the user\'s access to this organization; SUSPENDED pauses it without losing the membership record. Neither deletes any role grant rows scoped to this organization — those simply stop being effective once no ACTIVE membership backs them (see docs/PHASE_2A.md).',
  })
  @ResponseMessage('Membership updated successfully')
  updateStatus(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMembershipStatusDto,
  ) {
    return this.memberships.setStatus(organizationId, userId, dto.status);
  }
}
