import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { OrganizationsService } from '../services/organizations.service';

@ApiTags('organizations')
@SkipTenantStatusCheck()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @RequirePermissions('ORGANIZATION_MANAGE')
  list(@Query() query: PaginationQueryDto) {
    return this.organizationsService.list(query);
  }

  @Get(':id')
  @RequirePermissions('ORGANIZATION_MANAGE')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.findOne(id);
  }

  @Post()
  @RequirePermissions('ORGANIZATION_MANAGE')
  @ResponseMessage('Organization created successfully')
  create(@Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('ORGANIZATION_MANAGE')
  @ResponseMessage('Organization updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ORGANIZATION_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Organization deleted successfully')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.organizationsService.remove(id);
    return null;
  }
}
