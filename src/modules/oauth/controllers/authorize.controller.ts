import { Controller, Get, HttpStatus, Query, Res, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthorizeQueryDto } from '../dto';
import { OAuthTokenErrorFilter } from '../filters';
import { AuthorizeService } from '../services';

/**
 * Phase 2D.7 (docs/PHASE_2D7.md, docs/OAUTH_AUTHORIZATION_CODE_PKCE.md) —
 * `GET /oauth/authorize`. Deliberately NOT `@Public()` — unlike
 * `TokenController`/`JwksController`, this route runs BEHIND the platform's
 * existing global `JwtAuthGuard`: an authorization request represents a
 * human user, and the ONLY authentication mechanism this phase builds is
 * "already hold a valid platform session" (brief §19 — "do NOT implement a
 * new login page"). An unauthenticated request never reaches
 * `AuthorizeService` at all — `JwtAuthGuard` rejects it first with the
 * platform's own standard 401.
 *
 * `@UseFilters(OAuthTokenErrorFilter)` (scoped to this controller only,
 * exactly like `TokenController`) formats every PRE-redirect_uri-validated
 * failure as the same RFC 6749-shaped `{error, error_description}` JSON
 * `AuthorizeService` throws `OAuthTokenError` for. Every POST-redirect_uri
 * -validated outcome (success or denial) is instead a real HTTP redirect,
 * built here from `AuthorizeService`'s returned result — never through the
 * filter, and never carrying an access token or any secret in the URL
 * (brief §27).
 */
@ApiTags('oauth')
@Controller('oauth')
@UseFilters(OAuthTokenErrorFilter)
export class AuthorizeController {
  constructor(private readonly authorizeService: AuthorizeService) {}

  @Get('authorize')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'OAuth 2.1 Authorization Code + PKCE — authorization request',
    description:
      'Requires the caller to already hold a valid platform session (Authorization: Bearer <access_token>) — this endpoint never presents or implements a login form. ' +
      'On success, redirects to the exact registered redirect_uri with ?code=&state=. On a validated-client/redirect_uri request that is otherwise denied, redirects with ' +
      '?error=&error_description=&state=. On a request whose client_id/redirect_uri could not itself be validated, responds directly with a 400/401 JSON body — never a redirect.',
  })
  async authorize(@Query() query: AuthorizeQueryDto, @Res() res: Response): Promise<void> {
    const result = await this.authorizeService.handle({
      responseType: query.response_type,
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope,
      state: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      audience: query.audience,
      organizationId: query.organization_id,
    });

    const url = new URL(result.redirectUri);
    if (result.kind === 'issued') {
      url.searchParams.set('code', result.code);
    } else {
      url.searchParams.set('error', result.error);
      url.searchParams.set('error_description', result.errorDescription);
    }
    if (result.state !== undefined) {
      url.searchParams.set('state', result.state);
    }
    res.redirect(HttpStatus.FOUND, url.toString());
  }
}
