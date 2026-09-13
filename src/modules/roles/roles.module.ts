import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { UsersModule } from '../users/users.module';
import { RolePermissionsController, RolesController } from './controllers';
import { RolePermissionsService, RolesService } from './services';
import { RolePermissionsRepository, RolesRepository } from './repositories';

@Module({
  imports: [PermissionsModule, SecurityAuditModule, UsersModule],
  controllers: [RolesController, RolePermissionsController],
  providers: [RolesService, RolesRepository, RolePermissionsService, RolePermissionsRepository],
  exports: [RolesService],
})
export class RolesModule {}
