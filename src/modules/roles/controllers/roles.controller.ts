import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { CreateRoleDto } from '../dto/create-role.dto';
import { RoleQueryDto } from '../dto/role-query.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { RolesService } from '../services/roles.service';

@ApiTags('roles')
@SkipTenantStatusCheck()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('ROLE_VIEW')
  list(@Query() query: RoleQueryDto) {
    return this.rolesService.list(query);
  }

  @Get(':id')
  @RequirePermissions('ROLE_VIEW')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findOne(id);
  }

  @Post()
  @RequirePermissions('ROLE_MANAGE')
  @ResponseMessage('Role created successfully')
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('ROLE_MANAGE')
  @ResponseMessage('Role updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ROLE_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Role deleted successfully')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.rolesService.remove(id);
    return null;
  }
}
