import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from './pagination-query.dto';

export class PaginationMeta {
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
  @ApiProperty() totalPages: number;
}

/** Phase 1 extracted source — copied from TravelOS, classified REUSABLE. */
export class PaginatedResult<T> {
  items: T[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;

  constructor(items: T[], total: number, query: PaginationQueryDto) {
    this.items = items;
    this.meta = {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
}
