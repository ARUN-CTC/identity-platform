import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RequirePlatformPermissions } from '../../../common';
import { PlatformAuditQueryDto } from '../dto/platform-audit-query.dto';
import { PlatformJwtAuthGuard, PlatformPermissionsGuard } from '../guards';
import { PlatformAuditService } from '../services';

@ApiTags('platform-audit')
@Public()
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionsGuard)
@Controller('platform/audit-events')
export class PlatformAuditController {
  constructor(private readonly service: PlatformAuditService) {}

  @Get()
  @RequirePlatformPermissions('PLATFORM_SECURITY_VIEW')
  @ApiOperation({ summary: 'List platform-scoped security events (never tenant-attributed — docs/PLATFORM_OPERATOR_ARCHITECTURE.md)' })
  list(@Query() query: PlatformAuditQueryDto) {
    return this.service.listEvents(query);
  }
}
