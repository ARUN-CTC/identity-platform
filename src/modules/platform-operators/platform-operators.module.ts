import { Module } from '@nestjs/common';
import { JwtModule } from '../jwt/jwt.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { UsersModule } from '../users/users.module';
import { PlatformAuditController, PlatformAuthController, PlatformOperatorsController } from './controllers';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from './guards';
import { PlatformOperatorSessionsRepository, PlatformOperatorsRepository } from './repositories';
import { PlatformAuditService, PlatformAuthenticationService, PlatformOperatorsService } from './services';

/**
 * Phase 2B.1 — the Platform Operator security boundary
 * (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, ADR-010). Deliberately imports
 * UsersModule only for its global-Identity lookups (UsersService) — never
 * TenantsModule, MembershipsModule, or anything organization-scoped: a
 * Platform Operator's authority must not, and structurally cannot, depend
 * on any of those.
 */
@Module({
  imports: [JwtModule, SecurityAuditModule, UsersModule],
  controllers: [PlatformAuthController, PlatformOperatorsController, PlatformAuditController],
  providers: [
    PlatformOperatorsRepository,
    PlatformOperatorSessionsRepository,
    PlatformOperatorsService,
    PlatformAuthenticationService,
    PlatformAuditService,
    PlatformJwtAuthGuard,
    PlatformPermissionsGuard,
  ],
  // JwtModule is re-exported so PlatformJwtAuthGuard's own dependency on
  // TokenService can be resolved wherever a *consuming* module (e.g.
  // ProductsModule) references the guard via @UseGuards() — Nest resolves
  // a class-referenced guard's constructor within the consuming module's
  // own scope, not the declaring module's, so that scope needs every
  // transitive dependency too.
  exports: [
    JwtModule,
    PlatformOperatorsRepository,
    PlatformOperatorSessionsRepository,
    PlatformOperatorsService,
    PlatformJwtAuthGuard,
    PlatformPermissionsGuard,
  ],
})
export class PlatformOperatorsModule {}
