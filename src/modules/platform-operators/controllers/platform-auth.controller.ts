import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public, RequestContextService, ResponseMessage } from '../../../common';
import { PlatformLoginDto } from '../dto/platform-login.dto';
import { PlatformRefreshTokenDto } from '../dto/platform-refresh-token.dto';
import { PlatformJwtAuthGuard } from '../guards';
import { PlatformAuthenticationService } from '../services';

/**
 * Phase 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md) — no tenantCode
 * anywhere on this controller, deliberately: a Platform Operator may hold
 * zero Organization Memberships (Security Invariant #4). `@Public()` here
 * exempts every route from the *global* JwtAuthGuard (which only
 * understands tenant-scoped access tokens); `login`/`refresh` need no
 * authentication at all, while `me`/`logout` are authenticated instead by
 * PlatformJwtAuthGuard, applied locally.
 */
@ApiTags('platform-auth')
@Public()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly platformAuth: PlatformAuthenticationService,
    private readonly context: RequestContextService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate a Platform Operator with email + password (no tenantCode)' })
  login(@Body() dto: PlatformLoginDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.platformAuth.login(dto.email, dto.password, dto.deviceInfo, {
      ipAddress: req.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a Platform Operator refresh token' })
  refresh(@Body() dto: PlatformRefreshTokenDto) {
    return this.platformAuth.refresh(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(PlatformJwtAuthGuard)
  @ApiOperation({ summary: "Get the authenticated Platform Operator's own identity/permissions" })
  getMe() {
    return this.platformAuth.getMe(this.context.requireOperatorId(), this.context.userId!);
  }

  @Post('logout')
  @UseGuards(PlatformJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the caller's current Platform Operator session" })
  @ResponseMessage('Logged out successfully')
  async logout() {
    await this.platformAuth.logout(this.context.sessionId!);
    return null;
  }
}
