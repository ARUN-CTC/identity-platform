import { generateClientSecret, hashClientSecret, verifyClientSecret } from './client-credential.util';

describe('verifyClientSecret (Phase 2D.4)', () => {
  it('returns true for the correct secret against its own hash', () => {
    const secret = generateClientSecret();
    const hash = hashClientSecret(secret);
    expect(verifyClientSecret(secret, hash)).toBe(true);
  });

  it('returns false for an incorrect secret', () => {
    const hash = hashClientSecret(generateClientSecret());
    expect(verifyClientSecret('wrong-secret', hash)).toBe(false);
  });

  it('returns false for a null or undefined stored hash (a PUBLIC application, or a not-yet-provisioned credential) — never throws', () => {
    expect(verifyClientSecret('anything', null)).toBe(false);
    expect(verifyClientSecret('anything', undefined)).toBe(false);
  });

  it('returns false, and never throws, for a candidate whose hash differs in length from the stored hash', () => {
    // timingSafeEqual throws on unequal-length buffers if not guarded —
    // this must never surface as an unhandled exception from a malformed
    // or truncated stored value.
    expect(() => verifyClientSecret('x', 'deadbeef')).not.toThrow();
    expect(verifyClientSecret('x', 'deadbeef')).toBe(false);
  });

  it('is not fooled by a candidate that is merely a case-different or partial match of the real secret', () => {
    const secret = generateClientSecret();
    const hash = hashClientSecret(secret);
    expect(verifyClientSecret(secret.toUpperCase(), hash)).toBe(false);
    expect(verifyClientSecret(secret.slice(0, -1), hash)).toBe(false);
    expect(verifyClientSecret(`${secret}x`, hash)).toBe(false);
  });
});
