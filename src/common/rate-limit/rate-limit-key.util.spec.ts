import { buildRateLimitKey, sourceIdentifierFor } from './rate-limit-key.util';

describe('rate-limit key building (Phase 2D.9)', () => {
  it('produces the same key for the same source + client_id', () => {
    expect(buildRateLimitKey('1.2.3.4', 'client-a')).toBe(buildRateLimitKey('1.2.3.4', 'client-a'));
  });

  it('produces a different key for a different client_id, same source', () => {
    expect(buildRateLimitKey('1.2.3.4', 'client-a')).not.toBe(buildRateLimitKey('1.2.3.4', 'client-b'));
  });

  it('produces a different key for a different source, same client_id', () => {
    expect(buildRateLimitKey('1.2.3.4', 'client-a')).not.toBe(buildRateLimitKey('5.6.7.8', 'client-a'));
  });

  it('falls back to a source-only key when no client_id is available', () => {
    const key = buildRateLimitKey('1.2.3.4', undefined);
    expect(key).not.toContain('client:');
    expect(key).toContain('src:');
  });

  it('never embeds the raw source value in the key (always hashed)', () => {
    const key = buildRateLimitKey('192.168.1.100', 'client-a');
    expect(key).not.toContain('192.168.1.100');
  });

  it('is stable regardless of irrelevant request fields — callers never pass those in at all, so this is structurally guaranteed', () => {
    // The key builder's own signature only accepts (source, clientId) — a
    // caller has no way to make `state`/`nonce`/`scope`/`redirect_uri`
    // influence the key even by accident.
    expect(buildRateLimitKey.length).toBe(2);
  });

  it('sourceIdentifierFor prefers req.ip, falling back to the socket remote address, then "unknown"', () => {
    expect(sourceIdentifierFor({ ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(sourceIdentifierFor({ socket: { remoteAddress: '10.0.0.2' } })).toBe('10.0.0.2');
    expect(sourceIdentifierFor({})).toBe('unknown');
  });
});
