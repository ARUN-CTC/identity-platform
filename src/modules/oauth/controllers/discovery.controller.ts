import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common';

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  scopes_supported: string[];
  claims_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
}

/**
 * Phase 2D.8 (docs/OIDC_PROVIDER.md §15, brief §35-39) —
 * `GET /.well-known/openid-configuration`. Public, unauthenticated, static
 * configuration — same posture as `JwksController`
 * (`.well-known/jwks.json`), excluded from the versioned `api/v1` prefix
 * (`main.ts`) so it resolves at the standard, spec-required path.
 *
 * Advertises ONLY what this platform actually implements (brief §36 — "the
 * discovery document is part of the protocol contract"): no `implicit`,
 * no `hybrid`, no `plain` PKCE, no `refresh_token` grant, no
 * `registration_endpoint` (Dynamic Client Registration is explicitly not
 * built, brief §40), no `revocation_endpoint`/`introspection_endpoint`
 * (not built). Every URL is derived from ONE canonical, configured value
 * (`OAUTH_ISSUER`) — never hardcoded, never independently re-derived
 * (brief §38/§39) — the exact same value `ExternalTokenService`/
 * `IdTokenService`/`ExternalAccessTokenValidator` already use as `iss`.
 */
@ApiTags('oauth')
@Controller('.well-known')
export class DiscoveryController {
  constructor(private readonly config: ConfigService) {}

  @Get('openid-configuration')
  @Public()
  @ApiOperation({ summary: 'OIDC discovery document — advertises only implemented capabilities' })
  getConfiguration(): OidcDiscoveryDocument {
    const issuer = this.config.get<string>('OAUTH_ISSUER') ?? 'identity-platform';

    return {
      issuer,
      authorization_endpoint: `${issuer}/api/v1/oauth/authorize`,
      token_endpoint: `${issuer}/api/v1/oauth/token`,
      userinfo_endpoint: `${issuer}/api/v1/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      claims_supported: ['sub', 'name', 'given_name', 'family_name', 'preferred_username', 'email', 'email_verified'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
    };
  }
}
