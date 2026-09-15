import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type ProductStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export const PRODUCT_STATUSES: ProductStatus[] = ['ACTIVE', 'SUSPENDED', 'DISABLED'];

// No `slug` here — deliberately immutable after creation. Every Application
// under a Product, and (in a later phase) every token audience/permission
// namespace, is addressed by slug; changing it out from under those is a
// bigger operation than a plain field update and isn't needed by Phase 2B.
export class UpdateProductDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: PRODUCT_STATUSES,
    description: 'A DISABLED (or SUSPENDED) product must not be treated as an active trusted caller by anything checking it — enforcement of that is a later phase\'s job once anything actually checks Product status at request time (docs/PHASE_2B.md).',
  })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}
