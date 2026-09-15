import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// passwordHash is never included — see UsersService.sanitize().
// PHASE 2A: no tenantId — SecurityUser is a global Identity now
// (docs/PHASE_2A.md); its relationship to a tenant is via Membership.
export class UserEntity {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional() username?: string | null;
  @ApiPropertyOptional() firstName?: string | null;
  @ApiPropertyOptional() lastName?: string | null;
  @ApiProperty() status: string;
  @ApiPropertyOptional() emailVerifiedAt?: Date | null;
  @ApiPropertyOptional() lastLoginAt?: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional() updatedAt?: Date | null;
  @ApiProperty({ type: String, description: 'Serialized as a string — see bigint-json.polyfill.ts' })
  version: bigint;
}
