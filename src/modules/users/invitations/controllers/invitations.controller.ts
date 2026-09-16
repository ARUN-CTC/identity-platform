import { Body, Controller, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { INVITATION_POLICY_NAME, Public, RateLimited, RateLimitGuard, ResponseMessage } from '../../../../common';
import { UserInvitationsService } from '../services/user-invitations.service';
import { AcceptInvitationDto } from '../dto/accept-invitation.dto';
import { ValidateInvitationDto } from '../dto/validate-invitation.dto';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: UserInvitationsService) {}

  @Post('validate')
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimited(INVITATION_POLICY_NAME)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check an invitation link before rendering the accept-invitation form' })
  validate(@Query() query: ValidateInvitationDto) {
    return this.invitations.validateInvitation(query.token);
  }

  @Post('accept')
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimited(INVITATION_POLICY_NAME)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation: set a password and activate the account' })
  @ResponseMessage('Account activated successfully')
  async accept(@Body() dto: AcceptInvitationDto) {
    await this.invitations.acceptInvitation(dto.token, dto.password);
    return null;
  }
}
