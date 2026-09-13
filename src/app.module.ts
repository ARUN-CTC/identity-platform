import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { IdentityMetricsModule, RequestContextModule } from './common';
import { validateProductionConfig } from './config/production-config.validation';
import { PrismaModule } from './database';
import { ApplicationsModule } from './modules/applications/applications.module';
import { MailerModule } from './modules/mailer/mailer.module';
import { AuthenticationModule } from './modules/authentication/authentication.module';
import { OrganizationAccessModule } from './modules/authorization/organization-access.module';
import { HealthModule } from './modules/health/health.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OrganizationTypesModule } from './modules/organization-types/organization-types.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { PlatformOperatorsModule } from './modules/platform-operators/platform-operators.module';
import { ProductEntitlementsModule } from './modules/product-entitlements/product-entitlements.module';
import { ProductsModule } from './modules/products/products.module';
import { ResourceServerModule } from './modules/resource-server/resource-server.module';
import { RolesModule } from './modules/roles/roles.module';
import { SecurityAuditModule } from './modules/security-audit/security-audit.module';
import { ServiceAccountsModule } from './modules/service-accounts/service-accounts.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Configuration
    // validation) — `validate` runs synchronously before any module is
    // instantiated; an unsafe production configuration (missing/placeholder
    // OAUTH_ISSUER, missing OAUTH_PRIVATE_KEY, a malformed numeric
    // timing/rate-limit value) aborts boot entirely rather than surfacing
    // as a runtime surprise on the first real request.
    ConfigModule.forRoot({ isGlobal: true, validate: validateProductionConfig }),
    // Global registration only makes ClsService itself injectable —
    // ClsMiddleware is applied manually in main.ts (see that file's own
    // comment), the same proven pattern this was extracted from.
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    MailerModule,
    // Phase 2D.9 — global metrics abstraction (src/common/metrics), no
    // concrete monitoring vendor forced.
    IdentityMetricsModule,
    // AuthenticationModule registers JwtAuthGuard as a global APP_GUARD —
    // imported before RequestContextModule so it's collected first:
    // JwtAuthGuard populates context.tenantId/userId, which
    // RequestContextModule's TenantStatusGuard (and AuthenticationModule's
    // own PermissionsGuard) depend on.
    AuthenticationModule,
    RequestContextModule,
    TenantsModule,
    OrganizationTypesModule,
    OrganizationsModule,
    OrganizationAccessModule,
    MembershipsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    SessionsModule,
    SecurityAuditModule,
    PlatformOperatorsModule,
    ProductsModule,
    ApplicationsModule,
    ProductEntitlementsModule,
    ServiceAccountsModule,
    OAuthModule,
    ResourceServerModule,
    HealthModule,
  ],
})
export class AppModule {}
