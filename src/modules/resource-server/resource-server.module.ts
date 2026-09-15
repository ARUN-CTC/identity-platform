import { Module } from '@nestjs/common';
import { ResourceAuthorizationGuard, ResourceAuthorizationPolicyRegistry } from './authorization';
import { ResourceServerDemoController } from './controllers';
import { ExternalPrincipalContextService } from './context';
import { ExternalBearerAuthGuard } from './guards';
import { ExternalAccessTokenValidator, JwksClientService } from './services';

/**
 * Phase 2D.5 (docs/RESOURCE_SERVER_ARCHITECTURE.md) — the reusable Resource
 * Server trust-boundary primitives: bearer extraction, external (RS256)
 * token validation via an HTTP-fetched JWKS (never the in-process signing
 * service), principal construction, and a guard any future protected
 * route (in this codebase, or copied as a pattern into an actual separate
 * product's own resource server) can apply. Deliberately its own module,
 * imported by nothing from `OAuthModule`/`ApplicationsModule`/etc. and
 * importing nothing from them either — this boundary is structurally
 * independent of the issuance side (`docs/PHASE_2D4.md`), exactly mirroring
 * how a real, separate resource-server process would have zero code-level
 * coupling to the Identity Platform's own issuance internals.
 *
 * `ResourceServerDemoController` is test/support infrastructure only (see
 * its own doc comment) — no OAuth flow endpoint (`/authorize`, `/token`,
 * `/userinfo`, `/revoke`, `/introspect`) is added by this module.
 *
 * Phase 2D.6 (docs/RESOURCE_AUTHORIZATION_CONTRACT.md) adds the
 * authorization-layer primitives (`ResourceAuthorizationPolicyRegistry`,
 * `ResourceAuthorizationGuard`) — this module ships the generic contract
 * and registry only; it registers NO policy implementation for any real
 * product. `ResourceAuthorizationPolicyRegistry` is exported specifically
 * so a test (or, in a real deployment, a product's own bootstrap code) can
 * call `.register(productId, policy)` at runtime.
 */
@Module({
  controllers: [ResourceServerDemoController],
  providers: [JwksClientService, ExternalAccessTokenValidator, ExternalBearerAuthGuard, ExternalPrincipalContextService, ResourceAuthorizationPolicyRegistry, ResourceAuthorizationGuard],
  exports: [JwksClientService, ExternalAccessTokenValidator, ExternalBearerAuthGuard, ExternalPrincipalContextService, ResourceAuthorizationPolicyRegistry, ResourceAuthorizationGuard],
})
export class ResourceServerModule {}
