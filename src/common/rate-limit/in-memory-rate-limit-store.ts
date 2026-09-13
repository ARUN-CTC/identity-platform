import { Injectable } from '@nestjs/common';
import { RateLimitPolicy, RateLimitResult, RateLimitStore } from './rate-limit.interfaces';

interface Bucket {
  count: number;
  windowStartedAt: number;
}

/**
 * Phase 2D.9 — the default `RateLimitStore`: a fixed-window counter kept in
 * an in-process `Map`. Correct and sufficient for a single-instance
 * deployment (the default this codebase runs as today, matching
 * `SigningKeyService`'s own dev-default posture); a multi-instance
 * production deployment should provide a shared-backend implementation of
 * the SAME `RateLimitStore` interface instead (Redis, or any other
 * central counter store) — no change to `RateLimitService` or any caller
 * is required to do so.
 *
 * Bounded memory: stale buckets (whose window has already elapsed) are
 * lazily evicted the next time their own key is consumed, and a periodic
 * sweep (`sweepExpired`, called opportunistically on every `consume`, at
 * most once per `sweepIntervalMs`) removes buckets nobody has consumed
 * again — an attacker cycling through unbounded distinct keys (e.g. an
 * unbounded set of fabricated `client_id`s) cannot grow this map without
 * bound forever; entries age out.
 */
@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;
  private readonly sweepIntervalMs = 60_000;

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweepExpired(now);

    const bucketKey = `${policy.name}:${key}`;
    const existing = this.buckets.get(bucketKey);

    if (!existing || now - existing.windowStartedAt >= policy.windowMs) {
      this.buckets.set(bucketKey, { count: 1, windowStartedAt: now });
      return { allowed: true, remaining: policy.maxRequests - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= policy.maxRequests) {
      const retryAfterSeconds = Math.ceil((existing.windowStartedAt + policy.windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
    }

    existing.count += 1;
    return { allowed: true, remaining: policy.maxRequests - existing.count, retryAfterSeconds: 0 };
  }

  private sweepExpired(now: number): void {
    if (now - this.lastSweepAt < this.sweepIntervalMs) {
      return;
    }
    this.lastSweepAt = now;
    // A bucket can only ever have been created with SOME policy's window;
    // since policies are process-wide constants, a generous fixed
    // multiplier (10x the sweep interval) safely covers every policy this
    // phase defines without needing to look up each bucket's own policy.
    const staleBefore = now - this.sweepIntervalMs * 10;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStartedAt < staleBefore) {
        this.buckets.delete(key);
      }
    }
  }
}
