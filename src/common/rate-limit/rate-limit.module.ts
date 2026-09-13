import { Module } from '@nestjs/common';
import { InMemoryRateLimitStore } from './in-memory-rate-limit-store';
import { RATE_LIMIT_STORE, RateLimitService } from './rate-limit.service';

/**
 * Phase 2D.9 — binds the `RateLimitStore` seam (`RATE_LIMIT_STORE` token)
 * to its default, in-process implementation. A production deployment
 * needing a shared, multi-instance store provides a different
 * `RateLimitStore` implementation under the SAME token — no other file in
 * this codebase needs to change.
 */
@Module({
  providers: [{ provide: RATE_LIMIT_STORE, useClass: InMemoryRateLimitStore }, RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
