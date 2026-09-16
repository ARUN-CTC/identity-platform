import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  AUTH_LOGIN_POLICY_NAME,
  PASSWORD_RESET_POLICY_NAME,
  Public,
  RateLimited,
  RateLimitGuard,
  RequestContextService,
  ResponseMessage,
  SkipTenantStatusCheck,
} from '../../../common';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { SwitchOrganizationContextDto } from '../dto/switch-organization-context.dto';
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
  @UseGuards(RateLimitGuard)
  @RateLimited(AUTH_LOGIN_POLICY_NAME)
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
    return this.authenticationService.getMe(
      this.context.requireTenantId(),
      this.context.userId!,
      this.context.sessionId!,
      this.context.organizationId,
    );
  }

  @Post('context/switch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Switch the caller's active organization context",
    description:
      'The only client-supplied input is organizationId — which tenant it belongs to, and whether the caller ' +
      'actually has an ACTIVE membership there, are resolved and re-validated entirely server-side. Returns a ' +
      'fresh access/refresh token pair (same shape as login/refresh) reflecting the new context; the old refresh ' +
      'token is invalidated.',
  })
  switchContext(@Body() dto: SwitchOrganizationContextDto) {
    return this.authenticationService.switchOrganizationContext(
      this.context.requireTenantId(),
      this.context.userId!,
      this.context.sessionId!,
      dto.organizationId,
    );
  }

  @Post('context/clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Return to tenant-wide context (no organization selected)',
    description: 'Returns a fresh access/refresh token pair with no organizationId claim.',
  })
  clearContext() {
    return this.authenticationService.clearOrganizationContext(
      this.context.requireTenantId(),
      this.context.userId!,
      this.context.sessionId!,
    );
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
  @UseGuards(RateLimitGuard)
  @RateLimited(PASSWORD_RESET_POLICY_NAME)
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
  @UseGuards(RateLimitGuard)
  @RateLimited(PASSWORD_RESET_POLICY_NAME)
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a password reset using the token from the reset email' })
  @ResponseMessage('Password reset successfully — please sign in with your new password.')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authenticationService.resetPassword(dto);
    return null;
  }
}
