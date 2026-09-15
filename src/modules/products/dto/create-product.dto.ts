import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Phase 2B — registers a new Product (the abstract SaaS offering: TravelOS,
 * Healthcare, Gym, ...). Platform-level, not tenant-scoped — see
 * docs/PHASE_2B.md. Only an Identity Platform administrator (SUPER_ADMIN)
 * may call this; see PRODUCT_MANAGE.
 */
export class CreateProductDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    maxLength: 50,
    description: 'Lowercase, hyphenated identifier — also the future permission-namespace prefix (docs/AUTHORIZATION_ARCHITECTURE.md §2). Unique case-insensitively.',
    example: 'travelos',
  })
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9-]*$/, { message: 'slug must be lowercase letters, digits, and hyphens, starting with a letter' })
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
