import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public, RequestContextService, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { MeEntity } from '../entities/me.entity';
import { AuthenticationService } from '../services/authentication.service';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REFACTOR
 * REQUIRED: the organization-context endpoint was dropped (see
 * AuthenticationService's own header comment); invitation endpoints live on
 * their own InvitationsController (users/invitations) instead of here.
 */
@ApiTags('authentication')
@SkipTenantStatusCheck()
@Controller('auth')
export class AuthenticationController {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly context: RequestContextService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with tenantCode + email + password' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.authenticationService.login(dto, {
      ipAddress: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new access/refresh token pair' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authenticationService.refresh(dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({
    summary: "Get the authenticated caller's own session/security context",
    description:
      "Identity comes exclusively from the authenticated JWT (RequestContextService) — there is no way to request another user's context.",
  })
  getMe(): Promise<MeEntity> {
    return this.authenticationService.getMe(this.context.requireTenantId(), this.context.userId!, this.context.sessionId!);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the caller's current session" })
  @ResponseMessage('Logged out successfully')
  async logout() {
    await this.authenticationService.logout(this.context.requireTenantId(), this.context.sessionId!);
    return null;
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Change the caller's own password" })
  @ResponseMessage('Password changed successfully')
  async changePassword(@Body() dto: ChangePasswordDto) {
    await this.authenticationService.changePassword(this.context.requireTenantId(), this.context.userId!, dto);
    return null;
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password-reset email',
    description: 'Always responds the same way regardless of whether tenantCode/email matched a real account.',
  })
  @ResponseMessage("If that account exists, we've sent a password reset link.")
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authenticationService.forgotPassword(dto);
    return null;
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a password reset using the token from the reset email' })
  @ResponseMessage('Password reset successfully — please sign in with your new password.')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authenticationService.resetPassword(dto);
    return null;
  }
}
