import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Phase 2UI.2 (docs/TENANT_BOOTSTRAP.md) — fills the exact gap Phase 2UI.1
 * found: `POST /platform/tenants` creates only the `tenant` row itself,
 * with no supported way to create that tenant's first Organization or
 * Administrator afterward (both require a tenant JWT, which cannot exist
 * until the tenant has a member — a genuine chicken-and-egg gap, not a UI
 * oversight). This DTO is deliberately FLAT, not the nested
 * `{organization:{...}, administrator:{...}}` shape the brief illustrated —
 * no other DTO in this codebase uses class-transformer's
 * `@Type()`/`@ValidateNested()` (confirmed by search), and introducing that
 * pattern for exactly one endpoint would be an unjustified inconsistency.
 * Every field here maps directly onto an existing DTO's own field
 * (organizationName/organizationTypeId/organizationCode mirror
 * CreateOrganizationDto; administratorEmail/FirstName/LastName mirror
 * CreateUserDto's email/firstName/lastName; productIds mirrors
 * CreateEntitlementDto's productId, pluralized).
 */
export class BootstrapTenantDto {
  @ApiProperty({ maxLength: 255, example: 'Fleet Ops HQ' })
  @IsString()
  @MaxLength(255)
  organizationName: string;

  @ApiPropertyOptional({
    description:
      "Existing OrganizationType id to use for the tenant's first Organization. Omit to use (or, on a clean install, create) the platform's shared 'DEFAULT' type — OrganizationType has no tenant_id column at all (confirmed by schema inspection), so this is genuinely global reference data, never tenant-owned.",
  })
  @IsOptional()
  @IsUUID()
  organizationTypeId?: string;

  @ApiPropertyOptional({
    maxLength: 30,
    description: "Defaults to '<tenantCode>-ORG' if omitted. Must be unique within the tenant (uk_org_code) — this is also the mechanism that makes a duplicate bootstrap request fail safely (see docs/TENANT_BOOTSTRAP.md §Concurrency).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  organizationCode?: string;

  @ApiProperty({ example: 'admin@fleetops.example' })
  @IsEmail()
  administratorEmail: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  administratorFirstName: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  administratorLastName: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Product ids to grant this tenant an ACTIVE entitlement for, as part of bootstrap. Optional — entitlements can always be granted afterward via the existing POST .../product-entitlements endpoint instead.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  productIds?: string[];
}
