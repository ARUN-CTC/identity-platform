import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RateLimited, RateLimitGuard, TOKEN_POLICY_NAME } from '../../../common';
import { TokenRequestDto, TokenResponseDto } from '../dto';
import { OAuthTokenError } from '../errors';
import { OAuthTokenErrorFilter } from '../filters';
import { AuthorizationCodeGrantService, ClientCredentialsService } from '../services';
import { parseBasicAuthHeader } from '../utils';

const FORM_URLENCODED = 'application/x-www-form-urlencoded';

/**
 * Phase 2D.4 (docs/PHASE_2D4.md, docs/EXTERNAL_API_TRUST_BOUNDARY.md §2) —
 * `POST /oauth/token`, `grant_type=client_credentials` only. `@Public()`
 * bypasses the global (legacy, HS256) `JwtAuthGuard` exactly like
 * `JwksController` — this endpoint's own authentication is the OAuth
 * `client_secret_basic` header (or, for a PUBLIC client, PKCE alone — Phase
 * 2D.7), handled entirely inside the grant-specific service, never the
 * platform's own bearer-token mechanism.
 *
 * Phase 2D.7 (docs/PHASE_2D7.md) extends this SAME endpoint with
 * `grant_type=authorization_code`, routed to `AuthorizationCodeGrantService`
 * — a structurally separate service from `ClientCredentialsService`, never
 * a modification of it (brief §28/§55: "extend... without breaking
 * client_credentials... existing behavior must remain unchanged"). The
 * routing below is the ONLY change to this class's `client_credentials`
 * code path: `grant_type=authorization_code` is dispatched BEFORE
 * `ClientCredentialsService.issueToken()` is ever called, so every existing
 * request (grant_type=client_credentials, or anything else)  reaches that
 * service exactly as it always did, unmodified.
 *
 * `@UseFilters(OAuthTokenErrorFilter)` is scoped to this controller only —
 * every other controller's error shape is untouched.
 */
@ApiTags('oauth')
@Controller('oauth')
@Public()
@UseFilters(OAuthTokenErrorFilter)
export class TokenController {
  constructor(
    private readonly clientCredentials: ClientCredentialsService,
    private readonly authorizationCodeGrant: AuthorizationCodeGrantService,
  ) {}

  @Post('token')
  @UseGuards(RateLimitGuard)
  @RateLimited(TOKEN_POLICY_NAME)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'OAuth 2.0/2.1 token endpoint — client_credentials (ServiceAccount) or authorization_code + PKCE (human User)',
    description:
      'application/x-www-form-urlencoded only. client_credentials: client authenticates via HTTP Basic; requires tenant_id/audience/service_account_id/service_account_secret. ' +
      'authorization_code: confidential clients authenticate via HTTP Basic, public clients present client_id in the body; requires code/redirect_uri/code_verifier.',
  })
  async issueToken(
    @Headers('content-type') contentType: string | undefined,
    @Headers('authorization') authorizationHeader: string | undefined,
    @Body() body: TokenRequestDto,
  ): Promise<TokenResponseDto> {
    // Brief §8: validate Content-Type explicitly — never silently interpret
    // an arbitrary body just because body-parser happened to populate one
    // (Express registers both json() and urlencoded() globally; a JSON
    // request would otherwise pass through unnoticed).
    if (!contentType || !contentType.toLowerCase().startsWith(FORM_URLENCODED)) {
      throw new OAuthTokenError('invalid_request', `Content-Type must be ${FORM_URLENCODED}`);
    }

    const basicAuth = parseBasicAuthHeader(authorizationHeader);

    if (body.grant_type === 'authorization_code') {
      const result = await this.authorizationCodeGrant.issueToken(basicAuth, {
        clientId: body.client_id,
        code: body.code,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier,
      });
      return {
        access_token: result.accessToken,
        token_type: result.tokenType,
        expires_in: result.expiresIn,
        scope: result.scope,
        // Phase 2D.8 — present ONLY when the original /authorize request
        // included `openid` (AuthorizationCodeGrantService's own
        // Invariant 4/5 gate) — `undefined` here is simply omitted from the
        // JSON response, never emitted as `id_token: null`.
        id_token: result.idToken,
      };
    }

    // grant_type=client_credentials (or anything else — ClientCredentialsService
    // itself rejects any other value with unsupported_grant_type, unchanged).
    const result = await this.clientCredentials.issueToken(basicAuth, {
      grantType: body.grant_type,
      serviceAccountId: body.service_account_id,
      serviceAccountSecret: body.service_account_secret,
      tenantId: body.tenant_id,
      audience: body.audience,
      scope: body.scope,
    });

    return {
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      scope: result.scope,
    };
  }
}
