import { Controller, Get, Headers, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common';
import { RequireResourceAuthorization, ResourceAuthorizationGuard } from '../authorization';
import { CurrentExternalPrincipal, ExpectedAudience } from '../decorators';
import { ExternalPrincipalContextService } from '../context';
import { ResourceServerErrorFilter } from '../filters';
import { ExternalBearerAuthGuard } from '../guards';
import { AuthenticatedExternalPrincipal, toResourceAuthorizationContext } from '../interfaces';
import { assertRequestedTenantMatches, requireScope } from '../utils';

/** Fixed, generic, made-up "product" ids used only by this test/support controller and its own e2e suite — never a real product. */
export const DEMO_PRODUCT_A = 'resource-server-demo-product-a';
export const DEMO_PRODUCT_B = 'resource-server-demo-product-b';
export const DEMO_PRODUCT_UNREGISTERED = 'resource-server-demo-product-unregistered';
/** Phase 2D.10 (docs/PRODUCT_INTEGRATION_CONTRACT.md §Contract tests) — a THIRD, independent demo product, reserved for `tests/phase2d10-product-integration-contract.e2e-spec.ts` only, so that suite's own policy registration never shares a registry key with (and can never be affected by execution order relative to) Phase 2D.6's own `DEMO_PRODUCT_A`/`DEMO_PRODUCT_B` tests. */
export const DEMO_PRODUCT_CONTRACT = 'resource-server-demo-product-2d10-contract';

/**
 * Phase 2D.5 (brief §35) — GENERIC TEST/SUPPORT INFRASTRUCTURE ONLY, not a
 * product endpoint and not part of the OAuth/OIDC API surface. Exists
 * solely to prove `ExternalBearerAuthGuard`'s real, end-to-end behavior
 * against a live HTTP request (extraction → validation → principal
 * construction → CLS attachment), the way `tests/phase2d5-resource-server.e2e-spec.ts`
 * exercises it. No TravelOS-specific, or any other product-specific, logic
 * lives here — every check below is generic, reusable plumbing any real
 * Resource Server would write for itself.
 */
const DEMO_AUDIENCE = 'resource-server-demo-api';

@ApiTags('resource-server-demo (test support only)')
@Controller('resource-server/demo')
@Public() // bypasses the legacy (HS256) global JwtAuthGuard — this route's own authentication is ExternalBearerAuthGuard below, a structurally separate trust boundary
@UseFilters(ResourceServerErrorFilter)
export class ResourceServerDemoController {
  constructor(private readonly principalContext: ExternalPrincipalContextService) {}

  @Get('whoami')
  @UseGuards(ExternalBearerAuthGuard)
  @ExpectedAudience(DEMO_AUDIENCE)
  @ApiOperation({ summary: '[test support only] Returns the validated external principal — proves the guard/validator pipeline end to end.' })
  whoami(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal) {
    // Demonstrates both retrieval paths yield the identical principal — the
    // request-attached value (param decorator) and the CLS-backed one
    // (ExternalPrincipalContextService), proving neither is a second,
    // independently-populated copy that could drift from the other.
    const fromCls = this.principalContext.principal;
    return {
      context: toResourceAuthorizationContext(principal),
      clsMatchesRequest: fromCls?.jti === principal.jti,
    };
  }

  @Get('scoped')
  @UseGuards(ExternalBearerAuthGuard)
  @ExpectedAudience(DEMO_AUDIENCE)
  @ApiOperation({ summary: '[test support only] Demonstrates a product-owned scope check (requireScope) — never centralized IAM logic.' })
  scoped(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal) {
    // 'openid' — a standard OIDC scope, exempt from the per-Product
    // namespace ApplicationScopePolicy otherwise enforces (Phase 2D.2) —
    // deliberately chosen so this generic demo route needs no product-
    // specific scope namespace of its own.
    requireScope(principal, 'openid');
    return { ok: true, scopes: principal.scopes };
  }

  @Get('tenant-bound')
  @UseGuards(ExternalBearerAuthGuard)
  @ExpectedAudience(DEMO_AUDIENCE)
  @ApiOperation({ summary: '[test support only] Demonstrates the tenant-header-match contract (brief §17) — a caller-supplied X-Tenant-Id must match the token, never override it.' })
  tenantBound(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal, @Headers('x-tenant-id') requestedTenantId: string | undefined) {
    assertRequestedTenantMatches(principal, requestedTenantId);
    return { ok: true, tenantId: principal.tenantId };
  }

  /**
   * Phase 2D.6 — proves the full Layer 1-7 pipeline end to end. No policy
   * is registered here by shipped code — `ResourceAuthorizationGuard`
   * denies with `forbidden` (403) until a test (or a real product's own
   * bootstrap, in a real deployment) calls
   * `ResourceAuthorizationPolicyRegistry.register(DEMO_PRODUCT_A, ...)`.
   * `resource`/`action` are entirely made up for this route — never
   * interpreted by anything in this module.
   */
  @Get('authorized/product-a')
  @UseGuards(ExternalBearerAuthGuard, ResourceAuthorizationGuard)
  @ExpectedAudience(DEMO_AUDIENCE)
  @RequireResourceAuthorization({ productId: DEMO_PRODUCT_A, resource: 'demo-resource', action: 'read', requiredScopes: ['openid'] })
  @ApiOperation({ summary: '[test support only] Full authentication + authorization pipeline against a registered demo policy (Product A).' })
  authorizedProductA(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal) {
    return { ok: true, productId: DEMO_PRODUCT_A, tenantId: principal.tenantId };
  }

  /** A second, independently-registered demo product — proves provider isolation (brief §35): Product A's policy is never consulted here, and vice versa. */
  @Get('authorized/product-b')
  @UseGuards(ExternalBearerAuthGuard, ResourceAuthorizationGuard)
  @ExpectedAudience(DEMO_AUDIENCE)
  @RequireResourceAuthorization({ productId: DEMO_PRODUCT_B, resource: 'demo-resource', action: 'write' })
  @ApiOperation({ summary: '[test support only] Full authentication + authorization pipeline against a registered demo policy (Product B).' })
  authorizedProductB(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal) {
    return { ok: true, productId: DEMO_PRODUCT_B, tenantId: principal.tenantId };
  }

  /** No policy is ever registered for this productId — demonstrates "missing policy → deny" (brief §23/§32) deterministically, independent of any test's own registration order. */
  @Get('authorized/unregistered')
  @UseGuards(ExternalBearerAuthGuard, ResourceAuthorizationGuard)
  @ExpectedAudience(DEMO_AUDIENCE)
  @RequireResourceAuthorization({ productId: DEMO_PRODUCT_UNREGISTERED, resource: 'demo-resource', action: 'read' })
  @ApiOperation({ summary: '[test support only] No policy is ever registered for this product — always denies.' })
  authorizedUnregistered() {
    return { ok: true };
  }

  /**
   * Phase 2D.10 (docs/PRODUCT_INTEGRATION_CONTRACT.md §Contract tests) —
   * dedicated to `tests/phase2d10-product-integration-contract.e2e-spec.ts`.
   * The policy registered for `DEMO_PRODUCT_CONTRACT` is authored in that
   * test file using ONLY the `src/contracts` facade types
   * (`IdentityAuthorizationPolicy`/`IdentityAuthorizationContext`/
   * `IdentityAuthorizationRequest`/`IdentityAuthorizationResult`) — proving
   * the facade alone (never a deep `resource-server/authorization` import)
   * is sufficient to implement the same Layer 4 (entitlement) + Layer 6
   * (product IAM) + Layer 7 (resource policy) decision Phase 2D.6's own
   * test already proved against the internal type names directly.
   */
  @Get('authorized/contract-demo')
  @UseGuards(ExternalBearerAuthGuard, ResourceAuthorizationGuard)
  @ExpectedAudience(DEMO_AUDIENCE)
  @RequireResourceAuthorization({ productId: DEMO_PRODUCT_CONTRACT, resource: 'contract-resource', action: 'read', requiredScopes: ['openid'] })
  @ApiOperation({ summary: '[test support only] Full contract-facade-only authentication + authorization + entitlement pipeline (Phase 2D.10).' })
  authorizedContractDemo(@CurrentExternalPrincipal() principal: AuthenticatedExternalPrincipal) {
    return { ok: true, productId: DEMO_PRODUCT_CONTRACT, principal: toResourceAuthorizationContext(principal) };
  }
}
