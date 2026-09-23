import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CookieOptions, Request, Response } from 'express';
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
import { AuthenticationService, AuthTokens, AuthTokensWithCookie } from '../services/authentication.service';

const BROWSER_SESSION_COOKIE_NAME = 'identity_browser_session';

/**
 * Phase 1 extracted source — copied from TravelOS, classified REFACTOR
 * REQUIRED: the organization-context endpoint was dropped (see
 * AuthenticationService's own header comment); invitation endpoints live on
 * their own InvitationsController (users/invitations) instead of here.
 *
 * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md) — login/
 * refresh/context-switch now also set the new browser-session cookie as a
 * side effect (`setBrowserSessionCookie` below), and logout clears it. The
 * JSON response body every existing caller already expects is completely
 * unchanged — `stripCookie` strips `browserSessionCookie` back off before
 * returning, since `AuthTokensWithCookie` is an internal service-layer
 * return shape, never the public response contract.
 */
@ApiTags('authentication')
@SkipTenantStatusCheck()
@Controller('auth')
export class AuthenticationController {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly context: RequestContextService,
    private readonly config: ConfigService,
  ) {}

  private setBrowserSessionCookie(res: Response, tokens: AuthTokensWithCookie): AuthTokens {
    const { browserSessionCookie, ...rest } = tokens;
    const options: CookieOptions = {
      httpOnly: true,
      secure: this.config.get<string>('APP_ENV') === 'production',
      sameSite: 'lax',
      path: '/api/v1/oauth',
      maxAge: browserSessionCookie.maxAgeSeconds * 1000,
    };
    res.cookie(BROWSER_SESSION_COOKIE_NAME, browserSessionCookie.value, options);
    return rest;
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimited(AUTH_LOGIN_POLICY_NAME)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with tenantCode + email + password' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthTokens> {
    const userAgent = req.headers['user-agent'];
    const tokens = await this.authenticationService.login(dto, {
      ipAddress: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    });
    return this.setBrowserSessionCookie(res, tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new access/refresh token pair' })
  async refresh(@Body() dto: RefreshTokenDto, @Res({ passthrough: true }) res: Response): Promise<AuthTokens> {
    const tokens = await this.authenticationService.refresh(dto.refreshToken);
    return this.setBrowserSessionCookie(res, tokens);
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
  async switchContext(@Body() dto: SwitchOrganizationContextDto, @Res({ passthrough: true }) res: Response): Promise<AuthTokens> {
    const tokens = await this.authenticationService.switchOrganizationContext(
      this.context.requireTenantId(),
      this.context.userId!,
      this.context.sessionId!,
      dto.organizationId,
    );
    return this.setBrowserSessionCookie(res, tokens);
  }

  @Post('context/clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Return to tenant-wide context (no organization selected)',
    description: 'Returns a fresh access/refresh token pair with no organizationId claim.',
  })
  async clearContext(@Res({ passthrough: true }) res: Response): Promise<AuthTokens> {
    const tokens = await this.authenticationService.clearOrganizationContext(
      this.context.requireTenantId(),
      this.context.userId!,
      this.context.sessionId!,
    );
    return this.setBrowserSessionCookie(res, tokens);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the caller's current session" })
  @ResponseMessage('Logged out successfully')
  async logout(@Res({ passthrough: true }) res: Response) {
    await this.authenticationService.logout(this.context.requireTenantId(), this.context.sessionId!);
    res.clearCookie(BROWSER_SESSION_COOKIE_NAME, { path: '/api/v1/oauth' });
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
