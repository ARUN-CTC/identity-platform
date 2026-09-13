import { Module } from '@nestjs/common';
import { PermissionsController } from './controllers';
import { PermissionsService } from './services';
import { PermissionsRepository } from './repositories';

@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService, PermissionsRepository],
  exports: [PermissionsService],
})
export class PermissionsModule {}
