import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description:
      "The tenant to sign into. PHASE 2A: email is now globally unique on its own (docs/PHASE_2A.md) — tenantCode's job is selecting which of this Identity's tenant memberships becomes the active session, not disambiguating the account itself. A global Identity with no membership in the named tenant fails the same way as an unrecognized email (see AuthenticationService.login()). Picking *which* tenant/organization to sign into via a picker UI, without knowing the code in advance, is Phase 2C's organization-context scope (docs/ORGANIZATION_CONTEXT.md), not built here.",
  })
  @IsString()
  tenantCode: string;

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

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
