import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public, RequirePlatformPermissions, ResponseMessage } from '../../../common';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../../platform-operators/guards';
import { CreateEntitlementDto } from '../dto/create-entitlement.dto';
import { UpdateEntitlementStatusDto } from '../dto/update-entitlement-status.dto';
import { TenantProductEntitlementsService } from '../services';

/**
 * Phase 2B.2 — platform-administration surface for Tenant Product
 * Entitlement (docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md). Nested under
 * /platform (not bare /v1/tenants/...) for the same reason every other
 * platform-operator-only admin surface is: unambiguous, at the route
 * level, that this requires Platform Operator authentication, never a
 * tenant-scoped token however broad (Security Invariant #13 — a Tenant
 * Admin cannot self-grant product entitlement).
 *
 * `@Public()` exempts the *global* (tenant) JwtAuthGuard; PlatformJwtAuthGuard
 * + PlatformPermissionsGuard, applied locally, are the real gate.
 */
@ApiTags('product-entitlements')
@ApiParam({ name: 'tenantId', format: 'uuid' })
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('platform/tenants/:tenantId/product-entitlements')
export class TenantEntitlementsController {
  constructor(private readonly service: TenantProductEntitlementsService) {}

  @Post()
  @RequirePlatformPermissions('PRODUCT_ENTITLEMENT_MANAGE')
  @ApiOperation({ summary: 'Entitle a tenant to use a product (created ACTIVE)' })
  @ResponseMessage('Entitlement created successfully')
  create(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateEntitlementDto) {
    return this.service.create(tenantId, dto.productId);
  }

  @Get()
  @RequirePlatformPermissions('PRODUCT_ENTITLEMENT_VIEW')
  @ApiOperation({ summary: "List a tenant's product entitlements" })
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.service.list(tenantId);
  }

  @Get(':productId')
  @RequirePlatformPermissions('PRODUCT_ENTITLEMENT_VIEW')
  @ApiOperation({ summary: 'Get one tenant/product entitlement' })
  findOne(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.service.findOne(tenantId, productId);
  }

  @Patch(':productId')
  @RequirePlatformPermissions('PRODUCT_ENTITLEMENT_MANAGE')
  @ApiOperation({
    summary: 'Change entitlement status (ACTIVE, SUSPENDED, or REVOKED)',
    description: 'REVOKED -> ACTIVE is not reachable through this endpoint — use POST .../reactivate.',
  })
  @ResponseMessage('Entitlement updated successfully')
  updateStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateEntitlementStatusDto,
  ) {
    return this.service.updateStatus(tenantId, productId, dto.status);
  }

  @Post(':productId/reactivate')
  @RequirePlatformPermissions('PRODUCT_ENTITLEMENT_MANAGE')
  @ApiOperation({ summary: 'Restore a REVOKED entitlement to ACTIVE — the only path out of REVOKED' })
  @ResponseMessage('Entitlement reactivated successfully')
  reactivate(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.service.reactivate(tenantId, productId);
  }
}
