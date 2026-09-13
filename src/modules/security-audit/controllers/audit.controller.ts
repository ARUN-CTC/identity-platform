import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common';
import { SecurityAuditQueryService } from '../services/security-audit-query.service';
import { LoginAttemptQueryDto } from '../dto/login-attempt-query.dto';
import { SecurityEventQueryDto } from '../dto/security-event-query.dto';

@ApiTags('security-audit')
@Controller('security-audit')
export class AuditController {
  constructor(private readonly queryService: SecurityAuditQueryService) {}

  @Get('login-attempts')
  @RequirePermissions('SECURITY_AUDIT_VIEW')
  listLoginAttempts(@Query() query: LoginAttemptQueryDto) {
    return this.queryService.listLoginAttempts(query);
  }

  @Get('events')
  @RequirePermissions('SECURITY_AUDIT_VIEW')
  listEvents(@Query() query: SecurityEventQueryDto) {
    return this.queryService.listEvents(query);
  }
}
