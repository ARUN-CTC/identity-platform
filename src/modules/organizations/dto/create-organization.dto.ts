import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationTypeId: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  organizationCode: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  organizationName: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;
}
