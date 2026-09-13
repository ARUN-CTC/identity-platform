import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MeUserEntity {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional() username?: string | null;
  @ApiPropertyOptional() firstName?: string | null;
  @ApiPropertyOptional() lastName?: string | null;
  @ApiProperty() status: string;
}

export class MeTenantEntity {
  @ApiProperty() id: string;
  @ApiProperty() tenantCode: string;
  @ApiProperty() tenantName: string;
}

export class MeRoleEntity {
  @ApiProperty() id: string;
  @ApiProperty() roleCode: string;
  @ApiProperty() roleName: string;
}

export class MeSessionEntity {
  @ApiProperty() id: string;
  @ApiProperty() expiresAt: Date;
}

/**
 * Response for GET /auth/me — the authenticated caller's own session/
 * security context in one call. Phase 1 extracted source — copied from
 * TravelOS's MeEntity, classified REFACTOR REQUIRED: organizationContext/
 * availableOrganizations were dropped along with organization-context
 * switching generally (see docs/PHASE_1.md, Phase 2 recommendations) —
 * `roles`/`permissions` here are simply the caller's tenant-wide grants.
 */
export class MeEntity {
  @ApiProperty({ type: MeUserEntity }) user: MeUserEntity;
  @ApiProperty({ type: MeTenantEntity }) tenant: MeTenantEntity;
  @ApiProperty({ type: [MeRoleEntity] }) roles: MeRoleEntity[];
  @ApiProperty({ type: [String] }) permissions: string[];
  @ApiProperty({ type: MeSessionEntity }) session: MeSessionEntity;
}
