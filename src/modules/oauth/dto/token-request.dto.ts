import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Phase 2D.4 — `POST /oauth/token` request body
 * (`application/x-www-form-urlencoded`). Every field is `@IsOptional()`
 * here deliberately: this DTO exists for Swagger documentation and typed
 * access only — every field's actual presence/shape is validated by
 * `ClientCredentialsService` itself, producing an RFC 6749-shaped
 * `{error, error_description}` response (`OAuthTokenError`) for anything
 * missing or invalid. Letting `class-validator`/`ValidationPipe` reject a
 * bad request here instead would produce Nest's own default 400 body, not
 * an OAuth-conformant one — see `docs/PHASE_2D4.md` §Content-Type/Errors.
 *
 * `client_id`/`client_secret` are NOT fields here — `client_secret_basic`
 * (the only auth method any application registered for `client_credentials`
 * can have, ADR-018/`TokenEndpointAuthMethodPolicy`) is presented via the
 * `Authorization: Basic` header, never the body, so it never appears in
 * request logs a body-logging middleware might capture.
 */
export class TokenRequestDto {
  @ApiProperty({ example: 'client_credentials', description: 'Only client_credentials is supported by this endpoint.' })
  @IsOptional()
  @IsString()
  grant_type?: string;

  @ApiProperty({ description: 'UUID of the ServiceAccount to authenticate as (must belong to the authenticated Application).' })
  @IsOptional()
  @IsString()
  service_account_id?: string;

  @ApiProperty({ description: "The ServiceAccount's own credential (distinct from the Application's client_secret)." })
  @IsOptional()
  @IsString()
  service_account_secret?: string;

  @ApiProperty({ description: 'UUID of the Tenant the ServiceAccount is requesting to act on — explicit, never assumed.' })
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @ApiProperty({ description: "The resource API this token is for — must be one of the authenticated Application's own allowed audiences." })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiPropertyOptional({ example: 'travel.read travel.write', description: 'Space-delimited scopes (OAuth syntax) — must be a subset of the allowed application scopes.' })
  @IsOptional()
  @IsString()
  scope?: string;

  // --- Phase 2D.7 — grant_type=authorization_code fields -----------------
  // Unused by grant_type=client_credentials; ClientCredentialsService never
  // reads them (brief §55: the client_credentials code path is completely
  // unchanged).

  @ApiPropertyOptional({ description: 'The authorization code returned by GET /oauth/authorize.' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'Must exactly match the redirect_uri presented at /oauth/authorize for this code.' })
  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @ApiPropertyOptional({ description: 'PKCE code_verifier — the plaintext value whose S256 hash must equal the code_challenge presented at /oauth/authorize.' })
  @IsOptional()
  @IsString()
  code_verifier?: string;

  @ApiPropertyOptional({
    description:
      'The OAuth client id — required in the request body only for a PUBLIC client (token_endpoint_auth_method=none, no client secret, PKCE is its only proof of possession). ' +
      'A CONFIDENTIAL client authenticates via the Authorization: Basic header instead, exactly as for client_credentials.',
  })
  @IsOptional()
  @IsString()
  client_id?: string;
}
