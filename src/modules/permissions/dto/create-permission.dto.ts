import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreatePermissionDto {
  @ApiProperty({ example: 'USER_VIEW', description: 'RESOURCE_ACTION format' })
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Z0-9_]+$/, { message: 'permissionCode must be UPPER_SNAKE_CASE' })
  permissionCode: string;

  @ApiProperty({ example: 'USER', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  resource: string;

  @ApiProperty({ example: 'VIEW', maxLength: 30 })
  @IsString()
  @MaxLength(30)
  action: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean = true;
}
