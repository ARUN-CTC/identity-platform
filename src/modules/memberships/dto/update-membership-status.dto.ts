import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ADMIN_SETTABLE_MEMBERSHIP_STATUSES, AdminSettableMembershipStatus } from './membership-status';

export class UpdateMembershipStatusDto {
  @ApiProperty({ enum: ADMIN_SETTABLE_MEMBERSHIP_STATUSES })
  @IsIn(ADMIN_SETTABLE_MEMBERSHIP_STATUSES)
  status: AdminSettableMembershipStatus;
}
