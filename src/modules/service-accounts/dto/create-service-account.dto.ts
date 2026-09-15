import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Phase 2D.3 — registers a new ServiceAccount (machine principal) under an
 * Application. No `tenantId`/`organizationId`/`userId` field — ServiceAccount
 * registration is platform-level (docs/PHASE_2D_ARCHITECTURE.md §16); tenant
 * authorization is a distinct, later, per-tenant action
 * (ServiceAccountTenantGrant, see ServiceAccountTenantGrantsController).
 */
export class CreateServiceAccountDto {
  @ApiProperty({ maxLength: 200, example: 'TravelOS Nightly Sync' })
  @IsString()
  @MaxLength(200)
  name: string;
}
