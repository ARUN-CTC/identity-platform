import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * No `password` field: user creation is invitation-only (the user sets
 * their own password by accepting the emailed invite) — see
 * UsersService.create()/UserInvitationsService. The one exception
 * (tenant-bootstrap admin creation) uses a distinct, internal-only method.
 */
export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  lastName: string;
}
