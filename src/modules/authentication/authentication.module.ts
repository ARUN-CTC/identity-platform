import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '../jwt/jwt.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthenticationController } from './controllers';
import { JwtAuthGuard, PermissionsGuard } from './guards';
import { AuthenticationService } from './services';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
 * Registers JwtAuthGuard/PermissionsGuard as global APP_GUARD providers
 * here (not in RequestContextModule) to avoid a circular require between
 * common/context and this domain module. AppModule imports this module
 * before RequestContextModule so JwtAuthGuard (identity) runs before
 * TenantStatusGuard/PermissionsGuard (both need context.tenantId/userId
 * already set).
 */
@Module({
  imports: [TenantsModule, UsersModule, SessionsModule, JwtModule, SecurityAuditModule],
  controllers: [AuthenticationController],
  providers: [
    AuthenticationService,
    JwtAuthGuard,
    PermissionsGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthenticationService, JwtAuthGuard, PermissionsGuard],
})
export class AuthenticationModule {}
