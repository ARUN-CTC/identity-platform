import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto, Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { BootstrapTenantDto } from '../dto/bootstrap-tenant.dto';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { TenantBootstrapService } from '../services/tenant-bootstrap.service';
import { TenantsService } from '../services/tenants.service';

/**
 * Phase 2D — the platform-administration surface for the tenant registry
 * (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, same pattern as
 * TenantEntitlementsController/ApplicationsController/ServiceAccountsController).
 * Nested under `/platform` for the same reason every other platform-only
 * admin surface is: unambiguous, at the route level, that this requires
 * Platform Operator authentication, never a tenant-scoped token however
 * broad — this is the corrected home for every operation
 * `TenantsController` used to expose (incorrectly) behind the
 * tenant-grantable `TENANT_MANAGE` with no ownership check
 * ([[tenant-manage-unscoped-registry-vulnerability]]).
 *
 * `@Public()` exempts the *global* (tenant) JwtAuthGuard; PlatformJwtAuthGuard
 * + PlatformPermissionsGuard, applied locally, are the real gate — a
 * tenant-scoped token is rejected outright (401), never merely denied a
 * permission (403).
 */
@ApiTags('platform-tenants')
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly bootstrapService: TenantBootstrapService,
  ) {}

  @Get()
  @RequirePlatformPermissions('PLATFORM_TENANT_VIEW')
  @ApiOperation({ summary: 'List every tenant on the platform' })
  list(@Query() query: PaginationQueryDto) {
    return this.tenantsService.list(query);
  }

  @Get(':id')
  @RequirePlatformPermissions('PLATFORM_TENANT_VIEW')
  @ApiOperation({ summary: 'Get any tenant by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findById(id);
  }

  @Post()
  @RequirePlatformPermissions('PLATFORM_TENANT_MANAGE')
  @ApiOperation({ summary: 'Register a new tenant (created PROVISIONING)' })
  @ResponseMessage('Tenant created successfully')
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  /**
   * Phase 2UI.2 (docs/TENANT_BOOTSTRAP.md) — fills the gap Phase 2UI.1
   * found: create() above produces only the `tenant` row; this is the only
   * supported way to give that tenant its first Organization and
   * Administrator afterward. Reuses PLATFORM_TENANT_MANAGE (the same
   * permission `create()`/`update()`/`activate()` already require) rather
   * than inventing a new permission code. Only callable once per tenant —
   * see TenantBootstrapService for the exact idempotency/concurrency
   * guarantee (a real unique-constraint collision, not a soft check alone).
   */
  @Post(':id/bootstrap')
  @RequirePlatformPermissions('PLATFORM_TENANT_MANAGE')
  @ApiOperation({ summary: "Bootstrap a PROVISIONING tenant's first Organization, Administrator, and (optionally) Product Entitlements — atomically" })
  @ResponseMessage('Tenant bootstrapped successfully')
  bootstrap(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BootstrapTenantDto) {
    return this.bootstrapService.bootstrap(id, dto);
  }

  @Patch(':id')
  @RequirePlatformPermissions('PLATFORM_TENANT_MANAGE')
  @ApiOperation({ summary: 'Update any tenant (name, legal name, email, phone, status)' })
  @ResponseMessage('Tenant updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Post(':id/activate')
  @RequirePlatformPermissions('PLATFORM_TENANT_MANAGE')
  @ApiOperation({ summary: 'Activate a tenant' })
  @ResponseMessage('Tenant activated successfully')
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.activate(id);
  }

  @Post(':id/suspend')
  @RequirePlatformPermissions('PLATFORM_TENANT_MANAGE')
  @ApiOperation({ summary: 'Suspend a tenant' })
  @ResponseMessage('Tenant suspended successfully')
  suspend(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.suspend(id);
  }

  @Delete(':id')
  @RequirePlatformPermissions('PLATFORM_TENANT_MANAGE')
  @ApiOperation({ summary: 'Soft-delete a tenant' })
  @ResponseMessage('Tenant deleted successfully')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.tenantsService.remove(id);
    return null;
  }
}
