import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * Phase 2D (tenant registry security remediation) — the fields a tenant's
 * own admin (TENANT_MANAGE) may change about their OWN tenant via
 * `PATCH /tenants/me`. Deliberately excludes `status`: tenant lifecycle
 * (PROVISIONING/ACTIVE/SUSPENDED) is a Platform Operator-only concern (see
 * PlatformTenantsController) — this DTO closes that at the validation
 * layer too, not just by removing the path this endpoint used to expose it
 * through. The global ValidationPipe's `forbidNonWhitelisted: true` rejects
 * a `status` field in the request body with a 400 rather than silently
 * ignoring it.
 */
export class UpdateOwnTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;
}
