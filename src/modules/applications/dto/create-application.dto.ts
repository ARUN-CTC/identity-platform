import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { GRANT_TYPES, GrantType } from '../policies';

export type ClientType = 'CONFIDENTIAL' | 'PUBLIC';
export const CLIENT_TYPES: ClientType[] = ['CONFIDENTIAL', 'PUBLIC'];

/**
 * Phase 2B — registers a new Application (== "client" in OAuth/OIDC
 * terminology — docs/PHASE_2B_DOMAIN_MODEL.md) under a Product.
 *
 * PHASE 2D.2 (docs/adr/ADR-018-application-trust-client-types.md,
 * docs/APPLICATION_AUTHORIZATION.md) — `redirectUris`/`allowedOrigins` are
 * now actually validated and enforced (`RedirectUriPolicy`/`OriginPolicy`,
 * called from `ApplicationsService`, not this DTO — cross-field/DB-
 * dependent rules, e.g. scope-namespace ownership against the owning
 * Product's slug, can't be expressed as a class-validator decorator
 * alone). `grantTypes`/`allowedScopes`/`audiences` are new, deny-by-default
 * allow-lists. No `tokenEndpointAuthMethod` field here at all — it is
 * derived strictly from `clientType` server-side (ADR-018), never
 * independently client-settable.
 *
 * No `clientType: 'SERVICE'` option — a service-to-service caller is a
 * ServiceAccount (docs/adr/ADR-006, docs/adr/ADR-015 as amended), a distinct
 * future entity that *references* an Application, not a variant of
 * Application/client type itself. Not built in Phase 2D.2 (explicitly out
 * of scope).
 */
export class CreateApplicationDto {
  @ApiProperty({ maxLength: 200, example: 'TravelOS Web' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: CLIENT_TYPES, default: 'CONFIDENTIAL' })
  @IsOptional()
  @IsIn(CLIENT_TYPES)
  clientType?: ClientType;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Exact-match redirect URI allow-list for the authorization_code grant. HTTPS required except localhost/127.0.0.1 (development); custom mobile/native schemes permitted. No wildcards, no fragments. ' +
      'Format validated server-side (RedirectUriPolicy) rather than by a generic URL decorator, which would incorrectly reject valid custom schemes.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  redirectUris?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Exact-match browser-origin allow-list (CORS) — distinct from redirectUris.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional({
    type: [String],
    enum: GRANT_TYPES,
    default: [],
    description: 'Deny-by-default allow-list of OAuth grant types this Application may use. Empty by default — nothing is authorized until explicitly configured.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(GRANT_TYPES, { each: true })
  grantTypes?: GrantType[];

  @ApiPropertyOptional({
    type: [String],
    default: [],
    description: "Deny-by-default allow-list of OAuth scopes this Application may request — must be a standard OIDC scope (openid/profile/email) or namespaced under this Application's own Product slug.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedScopes?: string[];

  @ApiPropertyOptional({
    type: [String],
    default: [],
    description: 'Deny-by-default allow-list of resource-API audiences this Application may request a token for. No wildcards.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audiences?: string[];
}
