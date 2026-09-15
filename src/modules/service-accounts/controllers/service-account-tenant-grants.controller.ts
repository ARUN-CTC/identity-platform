import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { CreateTenantGrantDto } from '../dto/create-tenant-grant.dto';
import { UpdateTenantGrantStatusDto } from '../dto/update-tenant-grant-status.dto';
import { ServiceAccountTenantGrantsService } from '../services';

/**
 * Phase 2D.3 — platform-administration surface for ServiceAccountTenantGrant,
 * deliberately the structural twin of TenantEntitlementsController (Phase
 * 2B.2): nested under /platform/tenants/:tenantId/... so every operation
 * always carries an explicit, already-known, existence-checked tenantId —
 * the reason this table can use ordinary tenant RLS + actingAsTenantId
 * without needing Phase 2C's own narrow cross-tenant self-visibility
 * relaxation (which solves a different problem this design never
 * encounters — see database/ddl/009_service_account.sql's own comment).
 *
 * `@Public()` exempts the *global* (tenant) JwtAuthGuard; PlatformJwtAuthGuard
 * + PlatformPermissionsGuard, applied locally, are the real gate — a
 * tenant-scoped token (however broad) is rejected outright (401), never
 * merely denied a permission (403).
 */
@ApiTags('service-account-tenant-grants')
@ApiParam({ name: 'tenantId', format: 'uuid' })
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('platform/tenants/:tenantId/service-account-grants')
export class ServiceAccountTenantGrantsController {
  constructor(private readonly service: ServiceAccountTenantGrantsService) {}

  @Post()
  @RequirePlatformPermissions('SERVICE_ACCOUNT_TENANT_GRANT_MANAGE')
  @ApiOperation({ summary: 'Authorize a service account to act on this tenant (created ACTIVE)' })
  @ResponseMessage('Grant created successfully')
  create(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateTenantGrantDto) {
    return this.service.create(tenantId, dto.serviceAccountId);
  }

  @Get()
  @RequirePlatformPermissions('SERVICE_ACCOUNT_TENANT_GRANT_VIEW')
  @ApiOperation({ summary: "List every service account currently authorized (or previously authorized) to act on this tenant" })
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.service.list(tenantId);
  }

  @Get(':serviceAccountId')
  @RequirePlatformPermissions('SERVICE_ACCOUNT_TENANT_GRANT_VIEW')
  @ApiOperation({ summary: 'Get one service-account/tenant grant' })
  findOne(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('serviceAccountId', ParseUUIDPipe) serviceAccountId: string) {
    return this.service.findOne(tenantId, serviceAccountId);
  }

  @Patch(':serviceAccountId')
  @RequirePlatformPermissions('SERVICE_ACCOUNT_TENANT_GRANT_MANAGE')
  @ApiOperation({
    summary: 'Change grant status (ACTIVE, SUSPENDED, or REVOKED)',
    description: 'REVOKED -> ACTIVE is not reachable through this endpoint — use POST .../reactivate.',
  })
  @ResponseMessage('Grant updated successfully')
  updateStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('serviceAccountId', ParseUUIDPipe) serviceAccountId: string,
    @Body() dto: UpdateTenantGrantStatusDto,
  ) {
    return this.service.updateStatus(tenantId, serviceAccountId, dto.status);
  }

  @Post(':serviceAccountId/reactivate')
  @RequirePlatformPermissions('SERVICE_ACCOUNT_TENANT_GRANT_MANAGE')
  @ApiOperation({ summary: 'Restore a REVOKED grant to ACTIVE — the only path out of REVOKED' })
  @ResponseMessage('Grant reactivated successfully')
  reactivate(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('serviceAccountId', ParseUUIDPipe) serviceAccountId: string) {
    return this.service.reactivate(tenantId, serviceAccountId);
  }
}
