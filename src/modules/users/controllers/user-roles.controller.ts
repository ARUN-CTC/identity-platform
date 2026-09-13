import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { AssignRoleDto } from '../dto/assign-role.dto';
import { UserRolesService } from '../services/user-roles.service';

@ApiTags('user-roles')
@ApiParam({ name: 'userId', format: 'uuid' })
@SkipTenantStatusCheck()
@Controller('users/:userId/roles')
export class UserRolesController {
  constructor(private readonly service: UserRolesService) {}

  @Get()
  @RequirePermissions('USER_VIEW')
  @ApiOperation({ summary: "List a user's role grants" })
  list(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.service.list(userId);
  }

  @Post()
  @RequirePermissions('USER_MANAGE')
  @ApiOperation({ summary: 'Grant a role to a user, optionally scoped to one organization' })
  @ResponseMessage('Role granted successfully')
  assign(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: AssignRoleDto) {
    return this.service.assign(userId, dto.roleId, dto.organizationId);
  }

  @Delete(':id')
  @RequirePermissions('USER_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a role grant' })
  @ResponseMessage('Role revoked successfully')
  async revoke(@Param('userId', ParseUUIDPipe) userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.revoke(userId, id);
    return null;
  }
}
