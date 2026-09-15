import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * No tenantCode — deliberately (docs/PLATFORM_OPERATOR_ARCHITECTURE.md,
 * "Authentication"). A Platform Operator may hold zero Organization
 * Memberships; this login path never resolves a tenant at all.
 */
export class PlatformLoginDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
