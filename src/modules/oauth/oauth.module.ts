import { Module } from '@nestjs/common';
import { RateLimitGuard, RateLimitModule } from '../../common';
import { ApplicationsModule } from '../applications/applications.module';
import { JwtModule } from '../jwt/jwt.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProductEntitlementsModule } from '../product-entitlements/product-entitlements.module';
import { ResourceServerModule } from '../resource-server/resource-server.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { ServiceAccountsModule } from '../service-accounts/service-accounts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthorizeController, DiscoveryController, JwksController, TokenController, UserInfoController } from './controllers';
import { AuthorizationCodesRepository } from './repositories';
import { AuthorizationCodeGrantService, AuthorizeService, ClientCredentialsService, ExternalTokenService, IdTokenService, SigningKeyService } from './services';

/**
 * Phase 2D.1 (docs/PHASE_2D_ARCHITECTURE.md §Implementation Roadmap 2D.1–2D.2)
 * — the cryptographic foundation for external OAuth/OIDC tokens: RSA key
 * material (SigningKeyService), RS256 sign/verify (ExternalTokenService),
 * and the public JWKS endpoint.
 *
 * Phase 2D.4 (docs/PHASE_2D4.md) — `POST /oauth/token`
 * (`grant_type=client_credentials`), the first endpoint that actually
 * issues an external token. Imports every module whose existing,
 * already-reviewed service this phase reuses rather than reimplements:
 * `ApplicationsModule` (client authentication + `OAuthApplicationPolicyService`
 * eligibility), `ServiceAccountsModule` (ServiceAccount authentication +
 * `ServiceAccountTenantGrant` validation), `TenantsModule` (tenant
 * existence/status), `ProductEntitlementsModule` (`ProductAccessService` —
 * entitlement + product status, composed, not reimplemented),
 * `SecurityAuditModule` (issuance/denial audit events).
 *
 * Phase 2D.7 (docs/PHASE_2D7.md) — `AuthorizeController`/`AuthorizeService`
 * (`GET /oauth/authorize`) and `AuthorizationCodeGrantService`
 * (`grant_type=authorization_code` at the existing `TokenController`) add
 * two more imports this phase actually needs: `MembershipsModule` +
 * `OrganizationsModule` (organization-context revalidation, brief §21/§22)
 * and `JwtModule` (`TokenService` — the same tenant-prefixed-opaque-value
 * generator already used for refresh/password-reset/invitation tokens,
 * reused here for the authorization code, brief §14).
 * `AuthorizationCodesRepository` is this phase's own new, narrow repository
 * (`oauth_authorization_code` — never exposed via any tenant-facing CRUD
 * endpoint, brief §16).
 *
 * Phase 2D.8 (docs/PHASE_2D8.md) — OIDC Provider. Adds `IdTokenService`
 * (issuance-only, reuses `SigningKeyService`/the same RS256/`kid`
 * infrastructure, never a second key-management system),
 * `DiscoveryController` (`.well-known/openid-configuration`, public, same
 * posture as `JwksController`), and `UserInfoController`
 * (`GET /oauth/userinfo`) — the ONE deliberate point of contact with
 * `ResourceServerModule`: UserInfo authenticates with the SAME
 * `ExternalBearerAuthGuard`/`ExternalAccessTokenValidator` mechanism any
 * other protected resource-server route uses (brief §21), never a new or
 * parallel authentication path, and never an ID Token. `UsersModule` is
 * imported for the one live lookup UserInfo/ID-Token-issuance both need
 * (current name/email/verification state) — no separate identity store.
 *
 * Phase 2D.9 (docs/PHASE_2D9.md, docs/OAUTH_OPERATIONAL_HARDENING.md) —
 * operational hardening, no new OAuth/OIDC flow. `RateLimitModule`/
 * `RateLimitGuard` (`src/common/rate-limit/`) are generic, provider-neutral
 * infrastructure applied via `@RateLimited(policy)` to `/authorize`,
 * `/token`, and `/userinfo` — this module depends on that shared
 * abstraction, never the reverse.
 */
@Module({
  imports: [
    ApplicationsModule,
    ServiceAccountsModule,
    TenantsModule,
    ProductEntitlementsModule,
    SecurityAuditModule,
    MembershipsModule,
    OrganizationsModule,
    JwtModule,
    ResourceServerModule,
    UsersModule,
    RateLimitModule,
  ],
  controllers: [JwksController, TokenController, AuthorizeController, UserInfoController, DiscoveryController],
  providers: [SigningKeyService, ExternalTokenService, ClientCredentialsService, AuthorizationCodesRepository, AuthorizeService, AuthorizationCodeGrantService, IdTokenService, RateLimitGuard],
  exports: [SigningKeyService, ExternalTokenService, IdTokenService],
})
export class OAuthModule {}
