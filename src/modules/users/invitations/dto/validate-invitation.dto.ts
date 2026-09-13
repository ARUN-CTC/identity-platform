import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ValidateInvitationDto {
  @ApiProperty()
  @IsString()
  token: string;
}

export interface ValidateInvitationResult {
  valid: boolean;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}
