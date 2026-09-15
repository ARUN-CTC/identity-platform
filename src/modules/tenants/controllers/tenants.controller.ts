import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContextService, RequirePermissions, SkipTenantStatusCheck } from '../../../common';
import { TenantsService } from '../services/tenants.service';
import { UpdateOwnTenantDto } from '../dto/update-own-tenant.dto';

/**
 * Phase 2D security remediation
 * ([[tenant-manage-unscoped-registry-vulnerability]] — previously found:
 * `TENANT_MANAGE`, a tenant-grantable permission, gated `GET/PATCH/DELETE
 * /tenants/:id` and friends with zero ownership check, letting any
 * tenant's own SUPER_ADMIN read/modify/suspend/delete ANY OTHER tenant by
 * UUID). This controller now exposes ONLY the caller's own tenant —
 * `me` is not a placeholder for an id, it is the entire point: every
 * method resolves the tenant exclusively from
 * `RequestContextService.requireTenantId()` (JWT-derived), and no route
 * on this controller accepts a tenant id from the client at all, so there
 * is nothing here left to substitute another tenant's id into.
 *
 * Every global tenant-registry operation (list all tenants, read/update
 * ANY tenant by id, activate/suspend/delete) has moved to
 * `PlatformTenantsController` (`/platform/tenants`), gated by
 * `PlatformJwtAuthGuard` + `PlatformPermissionsGuard` with
 * `PLATFORM_TENANT_VIEW`/`PLATFORM_TENANT_MANAGE` — permissions that are
 * `platform_only = TRUE` (database trigger
 * `trg_security_role_permission_no_platform_only` forbids ever granting
 * them to a tenant Role), unlike `TENANT_MANAGE`.
 */
@ApiTags('tenants')
@SkipTenantStatusCheck()
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly context: RequestContextService,
  ) {}

  @Get('me')
  @RequirePermissions('TENANT_MANAGE')
  @ApiOperation({ summary: "Get the caller's own tenant profile" })
  findOwn() {
    return this.tenantsService.findById(this.context.requireTenantId());
  }

  @Patch('me')
  @RequirePermissions('TENANT_MANAGE')
  @ApiOperation({ summary: "Update the caller's own tenant profile (name, legal name, email, phone — not status)" })
  updateOwn(@Body() dto: UpdateOwnTenantDto) {
    return this.tenantsService.updateOwn(this.context.requireTenantId(), dto);
  }
}
