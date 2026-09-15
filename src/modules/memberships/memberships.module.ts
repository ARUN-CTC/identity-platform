import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { MembershipsController } from './controllers';
import { MembershipsRepository } from './repositories';
import { MembershipsService } from './services';

/**
 * Phase 2A — the Identity <-> Organization link (docs/PHASE_2A.md). Imported
 * by UsersModule (invitation/user-creation flow) and AuthenticationModule
 * (login-time "does this global Identity belong to this tenant" check), in
 * addition to registering its own read/status-transition controller.
 */
@Module({
  imports: [OrganizationsModule, SecurityAuditModule],
  controllers: [MembershipsController],
  providers: [MembershipsRepository, MembershipsService],
  exports: [MembershipsRepository, MembershipsService],
})
export class MembershipsModule {}
