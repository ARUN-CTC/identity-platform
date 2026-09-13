import { InMemoryRateLimitStore } from './in-memory-rate-limit-store';
import { RateLimitPolicy } from './rate-limit.interfaces';

describe('InMemoryRateLimitStore (Phase 2D.9)', () => {
  const policy: RateLimitPolicy = { name: 'test_policy', windowMs: 1000, maxRequests: 3 };

  it('allows requests up to the configured maximum', async () => {
    const store = new InMemoryRateLimitStore();
    const first = await store.consume('key-1', policy);
    const second = await store.consume('key-1', policy);
    const third = await store.consume('key-1', policy);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('denies the request that exceeds the maximum, within the same window', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 3; i++) {
      await store.consume('key-2', policy);
    }
    const fourth = await store.consume('key-2', policy);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the count after the window elapses', async () => {
    const store = new InMemoryRateLimitStore();
    const shortPolicy: RateLimitPolicy = { name: 'short', windowMs: 50, maxRequests: 1 };
    const first = await store.consume('key-3', shortPolicy);
    expect(first.allowed).toBe(true);
    const second = await store.consume('key-3', shortPolicy);
    expect(second.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const third = await store.consume('key-3', shortPolicy);
    expect(third.allowed).toBe(true);
  });

  it('tracks distinct keys independently — one key being limited never affects another', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 3; i++) {
      await store.consume('key-a', policy);
    }
    const limitedA = await store.consume('key-a', policy);
    const freshB = await store.consume('key-b', policy);
    expect(limitedA.allowed).toBe(false);
    expect(freshB.allowed).toBe(true);
  });

  it('tracks distinct policy names independently for the same key', async () => {
    const store = new InMemoryRateLimitStore();
    const policyA: RateLimitPolicy = { name: 'policy_a', windowMs: 1000, maxRequests: 1 };
    const policyB: RateLimitPolicy = { name: 'policy_b', windowMs: 1000, maxRequests: 1 };
    const firstA = await store.consume('shared-key', policyA);
    const limitedA = await store.consume('shared-key', policyA);
    const firstB = await store.consume('shared-key', policyB);
    expect(firstA.allowed).toBe(true);
    expect(limitedA.allowed).toBe(false);
    expect(firstB.allowed).toBe(true);
  });
});
