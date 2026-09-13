import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { OrganizationAccessService } from './services/organization-access.service';

@Module({
  imports: [OrganizationsModule, UsersModule],
  providers: [OrganizationAccessService],
  exports: [OrganizationAccessService],
})
export class OrganizationAccessModule {}
