import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common';
import { MEMBERSHIP_STATUSES, MembershipStatus } from './membership-status';

export class ListMembershipsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one organization within the caller\'s tenant' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one user\'s memberships within the caller\'s tenant' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ enum: MEMBERSHIP_STATUSES })
  @IsOptional()
  @IsIn(MEMBERSHIP_STATUSES)
  status?: MembershipStatus;
}
