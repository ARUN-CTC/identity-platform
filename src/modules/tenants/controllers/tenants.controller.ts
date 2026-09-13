import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, RequirePermissions, SkipTenantStatusCheck } from '../../../common';
import { TenantsService } from '../services/tenants.service';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';

@ApiTags('tenants')
@SkipTenantStatusCheck()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @RequirePermissions('TENANT_MANAGE')
  list(@Query() query: PaginationQueryDto) {
    return this.tenantsService.list(query);
  }

  @Get(':id')
  @RequirePermissions('TENANT_MANAGE')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findById(id);
  }

  @Post()
  @RequirePermissions('TENANT_MANAGE')
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('TENANT_MANAGE')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions('TENANT_MANAGE')
  activate(@Param('id') id: string) {
    return this.tenantsService.activate(id);
  }

  @Post(':id/suspend')
  @RequirePermissions('TENANT_MANAGE')
  suspend(@Param('id') id: string) {
    return this.tenantsService.suspend(id);
  }

  @Delete(':id')
  @RequirePermissions('TENANT_MANAGE')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }
}
