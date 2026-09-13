/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Rate limiting) — a
 * reusable, provider-neutral rate-limiting abstraction. Nothing in this
 * module, or in any caller of it, depends on a concrete backend (Redis,
 * Memcached, an in-process map) — only on these interfaces. The default
 * implementation shipped in this phase (`InMemoryRateLimitStore`) is
 * explicitly a single-process, dev/small-deployment store; a production,
 * multi-instance deployment swaps in a different `RateLimitStore`
 * implementation (e.g. Redis-backed) behind the SAME interface, with zero
 * change to any policy, guard, or controller.
 */

/** A named rate-limit policy — how many requests, over what window, for one bounded key. */
export interface RateLimitPolicy {
  /** Stable policy name — used only for metrics/log labels, never for authorization decisions. */
  readonly name: string;
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Requests still permitted in the current window if `allowed`; `0` if not. */
  readonly remaining: number;
  /** Seconds until the caller may retry — always present when `!allowed`, for the `Retry-After` header. */
  readonly retryAfterSeconds: number;
}

/**
 * The storage seam a concrete backend implements. `consume` is the ONLY
 * operation — an atomic "record one attempt against this key under this
 * policy, and tell me whether it's still within budget" — deliberately not
 * split into separate read/write steps, which would reintroduce exactly
 * the check-then-act race this platform's other atomic-consume patterns
 * (`AuthorizationCodesRepository.tryConsume`) already take care to avoid.
 */
export interface RateLimitStore {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
}
