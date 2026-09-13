import { Module } from '@nestjs/common';
import { OrganizationTypesController } from './controllers';
import { OrganizationTypesService } from './services';
import { OrganizationTypesRepository } from './repositories';

@Module({
  controllers: [OrganizationTypesController],
  providers: [OrganizationTypesService, OrganizationTypesRepository],
  exports: [OrganizationTypesService],
})
export class OrganizationTypesModule {}
