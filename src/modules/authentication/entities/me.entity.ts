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

export class MeOrganizationContextEntity {
  @ApiPropertyOptional({ nullable: true }) organizationId: string | null;
  @ApiPropertyOptional({ nullable: true }) organizationName: string | null;
}

/**
 * Response for GET /auth/me — the authenticated caller's own session/
 * security context in one call. Phase 1 extracted source — copied from
 * TravelOS's MeEntity, classified REFACTOR REQUIRED: organizationContext/
 * availableOrganizations were dropped along with organization-context
 * switching generally (see docs/PHASE_1.md, Phase 2 recommendations).
 *
 * PHASE 2C (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md) reinstates
 * organization context, deliberately re-designed rather than restored as-is
 * — `organizationContext` reflects the SELECTED organization this session's
 * `roles`/`permissions` were actually resolved against (null = tenant-wide);
 * it is read straight off the server-validated request context, never off
 * client input. `availableOrganizations` is intentionally NOT included here
 * — see `GET /v1/me/organizations`, a separate call, since listing every
 * organization a user could switch into is a materially different
 * (cross-tenant) query from "who am I right now".
 */
export class MeEntity {
  @ApiProperty({ type: MeUserEntity }) user: MeUserEntity;
  @ApiProperty({ type: MeTenantEntity }) tenant: MeTenantEntity;
  @ApiProperty({ type: MeOrganizationContextEntity }) organizationContext: MeOrganizationContextEntity;
  @ApiProperty({ type: [MeRoleEntity] }) roles: MeRoleEntity[];
  @ApiProperty({ type: [String] }) permissions: string[];
  @ApiProperty({ type: MeSessionEntity }) session: MeSessionEntity;
}
