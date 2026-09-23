import { Controller, Get, HttpStatus, Query, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AUTHORIZE_POLICY_NAME, Public, RateLimited, RateLimitGuard, RequestContextService } from '../../../common';
import { AuthorizeQueryDto } from '../dto';
import { OAuthTokenErrorFilter } from '../filters';
import { OAuthBrowserSessionGuard } from '../guards';
import { AuthorizeRequest, AuthorizeResult, AuthorizeService, PendingAuthorizationsService } from '../services';

/**
 * Phase 2D.7 (docs/PHASE_2D7.md, docs/OAUTH_AUTHORIZATION_CODE_PKCE.md) —
 * `GET /oauth/authorize`.
 *
 * Phase 2UI.5A (docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md) — this
 * controller is no longer implicitly guarded by the global `JwtAuthGuard`
 * (which a real top-level browser navigation structurally cannot satisfy —
 * it cannot carry an Authorization header). It is now `@Public()` at the
 * framework level, with `OAuthBrowserSessionGuard` (scoped to exactly this
 * controller) attempting Bearer-or-cookie authentication without ever
 * rejecting on its own — this class decides what happens when neither
 * resolves. `AuthorizeService.handle()` itself, and everything about how a
 * request is validated once authenticated, is completely unchanged.
 *
 * `@UseFilters(OAuthTokenErrorFilter)` formats every PRE-redirect_uri
 * -validated failure as the same RFC 6749-shaped `{error,
 * error_description}` JSON `AuthorizeService`/`validateClientAndRedirect`
 * throw `OAuthTokenError` for. Every POST-redirect_uri-validated outcome
 * (success or denial) is instead a real HTTP redirect, built from
 * `AuthorizeService`'s returned result — never through the filter, and
 * never carrying an access token or any secret in the URL.
 */
@ApiTags('oauth')
@Controller('oauth')
@UseFilters(OAuthTokenErrorFilter)
export class AuthorizeController {
  constructor(
    private readonly authorizeService: AuthorizeService,
    private readonly pendingAuthorizations: PendingAuthorizationsService,
    private readonly context: RequestContextService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('authorize')
  @UseGuards(RateLimitGuard, OAuthBrowserSessionGuard)
  @RateLimited(AUTHORIZE_POLICY_NAME)
  @ApiOperation({
    summary: 'OAuth 2.1 Authorization Code + PKCE — authorization request',
    description:
      'Works for both an already-authenticated caller (Authorization: Bearer, or an existing identity_browser_session cookie) and a genuinely unauthenticated browser: the latter is redirected to sign in and automatically resumed afterward — see docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md. ' +
      'On success, redirects to the exact registered redirect_uri with ?code=&state=. On a validated-client/redirect_uri request that is otherwise denied, redirects with ?error=&error_description=&state=. On a request whose client_id/redirect_uri could not itself be validated, responds directly with a 400/403 JSON body — never a redirect.',
  })
  async authorize(@Query() query: AuthorizeQueryDto, @Res() res: Response): Promise<void> {
    const application = await this.authorizeService.validateClientAndRedirect(query.client_id, query.redirect_uri);

    const request: AuthorizeRequest = {
      responseType: query.response_type,
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope,
      state: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      audience: query.audience,
      organizationId: query.organization_id,
      nonce: query.nonce,
    };

    if (!this.context.userId) {
      const ref = await this.pendingAuthorizations.create(request, application);
      res.redirect(HttpStatus.FOUND, this.loginRedirectUrl(ref));
      return;
    }

    const result = await this.authorizeService.handle(request);
    res.redirect(HttpStatus.FOUND, this.buildResultUrl(result));
  }

  @Public()
  @Get('authorize/resume')
  @UseGuards(RateLimitGuard, OAuthBrowserSessionGuard)
  @RateLimited(AUTHORIZE_POLICY_NAME)
  @ApiOperation({
    summary: 'Resume a pending authorization request after the browser has signed in',
    description:
      'Takes only an opaque, single-use reference — never raw OAuth request parameters — issued by GET /oauth/authorize when it first redirected an unauthenticated browser to sign in. Still unauthenticated at resume time (e.g. an expired browser-session cookie mid-flow) redirects back to sign in again with the SAME reference, never erroring. An invalid/expired/already-consumed reference redirects to a generic, safe error page — there is no trusted redirect_uri left to send an OAuth-shaped error to at that point.',
  })
  async resume(@Query('ref') ref: string | undefined, @Res() res: Response): Promise<void> {
    if (!ref) {
      res.redirect(HttpStatus.FOUND, this.expiredRedirectUrl());
      return;
    }

    if (!this.context.userId) {
      res.redirect(HttpStatus.FOUND, this.loginRedirectUrl(ref));
      return;
    }

    const request = await this.pendingAuthorizations.consume(ref);
    if (!request) {
      res.redirect(HttpStatus.FOUND, this.expiredRedirectUrl());
      return;
    }

    const result = await this.authorizeService.handle(request);
    res.redirect(HttpStatus.FOUND, this.buildResultUrl(result));
  }

  private buildResultUrl(result: AuthorizeResult): string {
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
    return url.toString();
  }

  private loginRedirectUrl(ref: string): string {
    const base = this.config.get<string>('WEB_APP_BASE_URL');
    const url = new URL('/login', base);
    url.searchParams.set('authorize_request', ref);
    return url.toString();
  }

  private expiredRedirectUrl(): string {
    const base = this.config.get<string>('WEB_APP_BASE_URL');
    return new URL('/oauth/authorize/expired', base).toString();
  }
}
