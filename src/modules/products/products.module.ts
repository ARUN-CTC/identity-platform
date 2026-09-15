import { Module } from '@nestjs/common';
import { PlatformOperatorsModule } from '../platform-operators/platform-operators.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { ProductsController } from './controllers';
import { ProductsRepository } from './repositories';
import { ProductsService } from './services';

@Module({
  imports: [SecurityAuditModule, PlatformOperatorsModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
