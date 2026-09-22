import { Module } from '@nestjs/common';
import { PlatformOperatorsModule } from '../platform-operators/platform-operators.module';
import { ProductsModule } from '../products/products.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { UsersModule } from '../users/users.module';
import { PlatformTenantsController } from './controllers/platform-tenants.controller';
import { TenantsController } from './controllers/tenants.controller';
import { TenantsService } from './services/tenants.service';
import { TenantBootstrapService } from './services/tenant-bootstrap.service';
import { TenantsRepository } from './repositories/tenants.repository';

@Module({
  // ProductsModule: TenantBootstrapService.findOne()-validates any
  // productIds passed to bootstrap. UsersModule: for UserInvitationsService
  // (Phase 2UI.2 — the post-commit best-effort invitation email; see that
  // service's own header comment for why it's never inside the bootstrap
  // transaction itself).
  imports: [PlatformOperatorsModule, SecurityAuditModule, ProductsModule, UsersModule],
  controllers: [TenantsController, PlatformTenantsController],
  providers: [TenantsService, TenantsRepository, TenantBootstrapService],
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
