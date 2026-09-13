import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common';

export class RoleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches against roleCode or roleName' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Include platform-wide system roles alongside tenant roles' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeSystem?: boolean = true;
}
