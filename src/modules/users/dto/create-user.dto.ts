import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * No `password` field: user creation is invitation-only (the user sets
 * their own password by accepting the emailed invite) — see
 * UsersService.create()/UserInvitationsService. The one exception
 * (tenant-bootstrap admin creation) uses a distinct, internal-only method.
 *
 * PHASE 2A (docs/PHASE_2A.md): `organizationId` is now required — creating
 * a user always means "onboard this Identity into this Organization"
 * (creating a Membership), never "create an account in the abstract."
 * If `email` already resolves to an existing global Identity (this person
 * already has an account via another tenant/organization), no new
 * security_user row is created — this call only adds a Membership for
 * them, and username/firstName/lastName are ignored in that case (the
 * existing Identity's own profile is authoritative). This is a deliberate,
 * documented breaking change from Phase 1 — see docs/PHASE_2A.md,
 * "Backward compatibility".
 */
export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'The organization this user is being onboarded into.' })
  @IsUUID()
  organizationId: string;

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
