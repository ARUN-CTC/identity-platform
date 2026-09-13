import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Phase 2D.7 — `GET /oauth/authorize` query parameters. Every field is
 * `@IsOptional()`/`@IsString()` deliberately, matching `TokenRequestDto`'s
 * own convention (docs/PHASE_2D4.md): this DTO exists for typed access and
 * Swagger documentation only — actual presence/shape validation happens in
 * `AuthorizeService`, producing an RFC 6749-shaped `{error,
 * error_description}` response (direct, or via redirect once redirect_uri
 * is itself validated) rather than Nest's own default 400 body.
 *
 * `@IsString()` alone is also what rejects a duplicated query parameter
 * (`?client_id=a&client_id=b`, brief §47 "parameter pollution") — Express's
 * query parser turns a repeated key into an array, which fails `IsString`
 * and is rejected by the global `ValidationPipe` before this class is ever
 * constructed, i.e. before `redirect_uri` has been validated — safe to
 * reject directly (never redirected), exactly the posture brief §26
 * requires for anything that happens before redirect_uri is trusted.
 */
export class AuthorizeQueryDto {
  @ApiPropertyOptional({ example: 'code', description: 'Only "code" is supported.' })
  @IsOptional()
  @IsString()
  response_type?: string;

  @ApiPropertyOptional({ description: 'The requesting Application (OAuth client) id.' })
  @IsOptional()
  @IsString()
  client_id?: string;

  @ApiPropertyOptional({ description: 'Must exactly match one of the Application\'s registered redirect URIs.' })
  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @ApiPropertyOptional({ example: 'travel.read', description: 'Space-delimited scopes — must be a subset of the Application\'s allowed scopes.' })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({ description: 'Opaque client state — preserved exactly, returned on both success and (where possible) error.' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: 'PKCE code_challenge — BASE64URL(SHA256(code_verifier)).' })
  @IsOptional()
  @IsString()
  code_challenge?: string;

  @ApiPropertyOptional({ example: 'S256', description: 'Only "S256" is supported — "plain" is rejected.' })
  @IsOptional()
  @IsString()
  code_challenge_method?: string;

  @ApiPropertyOptional({ description: "The resource API this code (and the token it produces) is for — must be one of the Application's own allowed audiences." })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiPropertyOptional({
    description:
      'A REQUESTED organization context (never trusted on its own) — independently revalidated against the authenticated user\'s own ACTIVE membership. ' +
      'Omit to use the authenticated session\'s own current organization context.',
  })
  @IsOptional()
  @IsString()
  organization_id?: string;

  @ApiPropertyOptional({ description: 'Phase 2D.8 (OIDC) — mandatory when scope includes openid. Opaque, client-generated, echoed unmodified into the ID Token.' })
  @IsOptional()
  @IsString()
  nonce?: string;
}
