import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'BILLING_MANAGER', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, { message: 'roleCode must be UPPER_SNAKE_CASE' })
  roleCode: string;

  @ApiProperty({ example: 'Billing Manager', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  roleName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
