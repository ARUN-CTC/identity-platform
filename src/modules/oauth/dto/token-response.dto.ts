import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Phase 2D.4 — `POST /oauth/token` success response (RFC 6749 §5.1). No refresh_token — Client Credentials never issues one (brief §51). */
export class TokenResponseDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: 'Bearer';

  @ApiProperty({ example: 900, description: 'Seconds until expiry.' })
  expires_in: number;

  @ApiPropertyOptional({ example: 'travel.read', description: 'Space-delimited scopes actually granted — echoes the request exactly, never silently reduced or expanded.' })
  scope?: string;

  @ApiPropertyOptional({ description: 'Phase 2D.8 (OIDC) — present ONLY for an authorization_code exchange whose original /authorize request included the openid scope. Never present for client_credentials.' })
  id_token?: string;
}
