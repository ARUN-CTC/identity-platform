import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { GRANT_TYPES, GrantType } from '../policies';

export type ApplicationStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export const APPLICATION_STATUSES: ApplicationStatus[] = ['ACTIVE', 'SUSPENDED', 'DISABLED'];

// No `clientType` here — immutable after creation in Phase 2B. Changing
// CONFIDENTIAL <-> PUBLIC implies issuing/discarding a secret, which is
// credential-rotation territory (docs/PHASE_2B.md §13) and deliberately not
// built this phase. No `productId` here either (Phase 2D.2) — an
// Application's Product is immutable; reassigning it would be exactly the
// "Application registered for Product A obtains access to Product B"
// invariant this phase's architecture forbids (docs/PHASE_2D_ARCHITECTURE.md
// §16) — the global ValidationPipe's `forbidNonWhitelisted: true` rejects
// any attempt to send `productId` here with a 400, not merely ignoring it.
export class UpdateApplicationDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ type: [String], description: 'Replaces the entire redirect URI allow-list. Format validated server-side (RedirectUriPolicy).' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  redirectUris?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Replaces the entire allowed-origin (CORS) allow-list. Format validated server-side (OriginPolicy).' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional({ type: [String], enum: GRANT_TYPES, description: 'Replaces the entire grant-type allow-list.' })
  @IsOptional()
  @IsArray()
  @IsIn(GRANT_TYPES, { each: true })
  grantTypes?: GrantType[];

  @ApiPropertyOptional({ type: [String], description: 'Replaces the entire OAuth-scope allow-list.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedScopes?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Replaces the entire resource-audience allow-list.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audiences?: string[];
}
