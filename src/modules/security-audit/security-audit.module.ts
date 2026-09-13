import { Module } from '@nestjs/common';
import { AuditController } from './controllers/audit.controller';
import { SecurityEventsService, SecurityAuditQueryService } from './services';
import { SecurityAuditRepository } from './repositories';

@Module({
  controllers: [AuditController],
  providers: [SecurityEventsService, SecurityAuditQueryService, SecurityAuditRepository],
  exports: [SecurityEventsService, SecurityAuditQueryService],
})
export class SecurityAuditModule {}
