import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { CreateOrganizationTypeDto } from '../dto/create-organization-type.dto';
import { UpdateOrganizationTypeDto } from '../dto/update-organization-type.dto';
import { OrganizationTypesService } from '../services/organization-types.service';

@ApiTags('organization-types')
@SkipTenantStatusCheck()
@Controller('organization-types')
export class OrganizationTypesController {
  constructor(private readonly service: OrganizationTypesService) {}

  @Get()
  @RequirePermissions('ORGANIZATION_MANAGE')
  list(@Query() query: PaginationQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermissions('ORGANIZATION_MANAGE')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('ORGANIZATION_MANAGE')
  @ResponseMessage('Organization type created successfully')
  create(@Body() dto: CreateOrganizationTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('ORGANIZATION_MANAGE')
  @ResponseMessage('Organization type updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ORGANIZATION_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization type deleted successfully')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
    return null;
  }
}
