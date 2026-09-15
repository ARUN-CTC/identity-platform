import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContextService } from '../../../common';
import { TenantProductEntitlementsService } from '../services';

/**
 * Phase 2B.2 — tenant self-service read: "which products can my own
 * tenant use." Ordinary tenant-authenticated route (the global JwtAuthGuard/
 * PermissionsGuard, unchanged) — no special permission required, the same
 * openness as GET /v1/organizations (a caller sees only their own tenant's
 * data, RLS-scoped, never another tenant's). Includes the computed
 * `eligible` flag (ProductAccessService — Product.status precedence
 * already applied), not just the raw entitlement row, so no caller needs
 * to re-derive that logic itself.
 *
 * Deliberately does NOT skip the tenant-status check (unlike most
 * controllers in this codebase) — mirrors SessionsController/AuditController's
 * own precedent: a suspended tenant should not get normal read access here
 * either.
 */
@ApiTags('product-entitlements')
@Controller('product-entitlements')
export class MyEntitlementsController {
  constructor(
    private readonly service: TenantProductEntitlementsService,
    private readonly context: RequestContextService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the caller's own tenant's product entitlements, with computed eligibility" })
  list() {
    return this.service.listForCallersOwnTenant(this.context.requireTenantId());
  }
}
