import { Inject, Injectable } from '@nestjs/common';
import { RateLimitPolicy, RateLimitResult, RateLimitStore } from './rate-limit.interfaces';

/** DI token for the bound `RateLimitStore` implementation (an interface has no runtime identity of its own). */
export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/**
 * Phase 2D.9 — the single injectable surface application code depends on.
 * Wraps whichever `RateLimitStore` is bound to `RATE_LIMIT_STORE`
 * (`InMemoryRateLimitStore` by default — see `RateLimitModule`) so a
 * caller never imports a concrete backend directly.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    return this.store.consume(key, policy);
  }
}
