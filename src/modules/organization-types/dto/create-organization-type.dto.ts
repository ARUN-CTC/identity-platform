import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateOrganizationTypeDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  typeCode: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  typeName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
