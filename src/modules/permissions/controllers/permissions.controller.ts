import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { CreatePermissionDto } from '../dto/create-permission.dto';
import { PermissionQueryDto } from '../dto/permission-query.dto';
import { UpdatePermissionDto } from '../dto/update-permission.dto';
import { PermissionsService } from '../services/permissions.service';

@ApiTags('permissions')
@SkipTenantStatusCheck()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions('PERMISSION_VIEW')
  list(@Query() query: PermissionQueryDto) {
    return this.permissionsService.list(query);
  }

  @Get(':id')
  @RequirePermissions('PERMISSION_VIEW')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissionsService.findOne(id);
  }

  @Post()
  @RequirePermissions('ROLE_MANAGE')
  @ResponseMessage('Permission created successfully')
  create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('ROLE_MANAGE')
  @ResponseMessage('Permission updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePermissionDto) {
    return this.permissionsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ROLE_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Permission deleted successfully')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.permissionsService.remove(id);
    return null;
  }
}
