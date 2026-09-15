import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export type PlatformOperatorStatusValue = 'ACTIVE' | 'DISABLED';
export const PLATFORM_OPERATOR_STATUSES: PlatformOperatorStatusValue[] = ['ACTIVE', 'DISABLED'];

export class UpdatePlatformOperatorStatusDto {
  @ApiProperty({ enum: PLATFORM_OPERATOR_STATUSES })
  @IsIn(PLATFORM_OPERATOR_STATUSES)
  status: PlatformOperatorStatusValue;
}
