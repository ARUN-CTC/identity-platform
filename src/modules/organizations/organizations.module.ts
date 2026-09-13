import { Module } from '@nestjs/common';
import { OrganizationsController } from './controllers';
import { OrganizationsService } from './services';
import { OrganizationsRepository } from './repositories';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationsRepository],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
