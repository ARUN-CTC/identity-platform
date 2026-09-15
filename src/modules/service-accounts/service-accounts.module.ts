import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { PlatformOperatorsModule } from '../platform-operators/platform-operators.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ApplicationServiceAccountsController, ServiceAccountTenantGrantsController, ServiceAccountsController } from './controllers';
import { ServiceAccountTenantGrantsRepository, ServiceAccountsRepository } from './repositories';
import { ServiceAccountTenantGrantsService, ServiceAccountsService } from './services';

/**
 * Phase 2D.3 (docs/PHASE_2D3.md, docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md)
 * — the machine-identity model (ServiceAccount) and explicit tenant
 * authorization (ServiceAccountTenantGrant). Deliberately reuses
 * ApplicationsModule (ServiceAccount ownership), TenantsModule (grant
 * existence checks), PlatformOperatorsModule (the unchanged administration
 * boundary), and SecurityAuditModule — no new cross-cutting mechanism is
 * introduced anywhere in this module.
 */
@Module({
  imports: [ApplicationsModule, TenantsModule, SecurityAuditModule, PlatformOperatorsModule],
  controllers: [ApplicationServiceAccountsController, ServiceAccountsController, ServiceAccountTenantGrantsController],
  providers: [ServiceAccountsRepository, ServiceAccountTenantGrantsRepository, ServiceAccountsService, ServiceAccountTenantGrantsService],
  exports: [ServiceAccountsService, ServiceAccountTenantGrantsService, ServiceAccountsRepository, ServiceAccountTenantGrantsRepository],
})
export class ServiceAccountsModule {}
