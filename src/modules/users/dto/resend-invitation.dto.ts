import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** PHASE 2A: an invitation is now organization-scoped — resending needs to know which organization's pending invite to resend. */
export class ResendInvitationDto {
  @ApiProperty()
  @IsUUID()
  organizationId: string;
}
