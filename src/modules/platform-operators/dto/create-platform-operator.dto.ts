import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEmail, IsString } from 'class-validator';

/**
 * Phase 2B.1 — grants Platform Operator authority to an EXISTING, already-
 * activated global Identity. Deliberately does not create a brand-new
 * Identity (unlike UsersService.create()'s tenant-invite flow) — see
 * docs/PLATFORM_OPERATOR_ARCHITECTURE.md, "Creating an operator" for why:
 * the existing organization-scoped invitation mechanism has no home for a
 * principal with no organization at all, and a person this sensitive
 * should already be a known, credentialed account before being granted
 * platform authority, not provisioned by this call.
 */
export class CreatePlatformOperatorDto {
  @ApiProperty({ description: 'Must already resolve to an existing global Identity with a password set.' })
  @IsEmail()
  email: string;

  @ApiProperty({
    type: [String],
    description: 'Platform-only permission codes to grant immediately. The caller must already hold every code listed (grant-ceiling — same rule already enforced for tenant role grants).',
    example: ['PRODUCT_VIEW', 'APPLICATION_VIEW'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissionCodes: string[];
}
