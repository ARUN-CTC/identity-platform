import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common';

export type UserStatus = 'PROVISIONED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
const USER_STATUSES: UserStatus[] = ['PROVISIONED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'];

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
