import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequestContextService } from '../../../common';
import { SessionsService } from '../services/sessions.service';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly context: RequestContextService,
  ) {}

  @Get('me')
  listOwn() {
    return this.sessionsService.listOwn(this.context.requireTenantId(), this.context.userId!);
  }

  @Delete(':id')
  revoke(@Param('id') id: string) {
    return this.sessionsService.revokeOwn(this.context.requireTenantId(), id);
  }

  @Post('revoke-others')
  revokeOthers() {
    return this.sessionsService.revokeAllOtherSessions(
      this.context.requireTenantId(),
      this.context.userId!,
      this.context.sessionId!,
    );
  }
}
