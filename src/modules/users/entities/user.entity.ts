import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// passwordHash is never included — see UsersService.sanitize().
export class UserEntity {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
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
