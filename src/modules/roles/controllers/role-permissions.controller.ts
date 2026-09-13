import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { AssignPermissionDto } from '../dto/assign-permission.dto';
import { RolePermissionsService } from '../services/role-permissions.service';

@ApiTags('role-permissions')
@ApiParam({ name: 'roleId', format: 'uuid' })
@SkipTenantStatusCheck()
@Controller('roles/:roleId/permissions')
export class RolePermissionsController {
  constructor(private readonly service: RolePermissionsService) {}

  @Get()
  @RequirePermissions('ROLE_VIEW')
  list(@Param('roleId', ParseUUIDPipe) roleId: string) {
    return this.service.list(roleId);
  }

  @Post()
  @RequirePermissions('ROLE_MANAGE')
  @ResponseMessage('Permission granted successfully')
  assign(@Param('roleId', ParseUUIDPipe) roleId: string, @Body() dto: AssignPermissionDto) {
    return this.service.assign(roleId, dto.permissionId);
  }

  @Delete(':permissionId')
  @RequirePermissions('ROLE_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Permission revoked successfully')
  async revoke(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ) {
    await this.service.revoke(roleId, permissionId);
    return null;
  }
}
