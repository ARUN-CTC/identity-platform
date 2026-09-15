import { Module } from '@nestjs/common';
import { PlatformOperatorsModule } from '../platform-operators/platform-operators.module';
import { ProductsModule } from '../products/products.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { TenantsModule } from '../tenants/tenants.module';
import { MyEntitlementsController, TenantEntitlementsController } from './controllers';
import { TenantProductEntitlementsRepository } from './repositories';
import { ProductAccessService, TenantProductEntitlementsService } from './services';

/**
 * Phase 2B.2 — Product Entitlement (docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md).
 * Imports PlatformOperatorsModule (for its re-exported guards + JwtModule —
 * same requirement ProductsModule/ApplicationsModule already established
 * in Phase 2B.1), ProductsModule (Product existence checks + status,
 * ProductAccessService's dependency on ProductsRepository), TenantsModule
 * (Tenant existence checks), SecurityAuditModule.
 */
@Module({
  imports: [PlatformOperatorsModule, ProductsModule, TenantsModule, SecurityAuditModule],
  controllers: [TenantEntitlementsController, MyEntitlementsController],
  providers: [TenantProductEntitlementsRepository, ProductAccessService, TenantProductEntitlementsService],
  exports: [ProductAccessService, TenantProductEntitlementsService],
})
export class ProductEntitlementsModule {}
