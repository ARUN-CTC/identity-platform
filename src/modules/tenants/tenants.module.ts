import { Module } from '@nestjs/common';
import { PlatformOperatorsModule } from '../platform-operators/platform-operators.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { PlatformTenantsController } from './controllers/platform-tenants.controller';
import { TenantsController } from './controllers/tenants.controller';
import { TenantsService } from './services/tenants.service';
import { TenantsRepository } from './repositories/tenants.repository';

@Module({
  imports: [PlatformOperatorsModule, SecurityAuditModule],
  controllers: [TenantsController, PlatformTenantsController],
  providers: [TenantsService, TenantsRepository],
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
