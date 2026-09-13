import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { RequestContextModule } from './common';
import { PrismaModule } from './database';
import { MailerModule } from './modules/mailer/mailer.module';
import { AuthenticationModule } from './modules/authentication/authentication.module';
import { OrganizationAccessModule } from './modules/authorization/organization-access.module';
import { HealthModule } from './modules/health/health.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OrganizationTypesModule } from './modules/organization-types/organization-types.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RolesModule } from './modules/roles/roles.module';
import { SecurityAuditModule } from './modules/security-audit/security-audit.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global registration only makes ClsService itself injectable —
    // ClsMiddleware is applied manually in main.ts (see that file's own
    // comment), the same proven pattern this was extracted from.
    ClsModule.forRoot({ global: true }),
    PrismaModule,
    MailerModule,
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
    UsersModule,
    RolesModule,
    PermissionsModule,
    SessionsModule,
    SecurityAuditModule,
    HealthModule,
  ],
})
export class AppModule {}
