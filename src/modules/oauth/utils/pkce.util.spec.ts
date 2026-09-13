import { computeCodeChallengeS256, isValidCodeChallengeFormat, isValidCodeVerifierFormat, verifyCodeVerifier } from './pkce.util';

describe('PKCE utilities (Phase 2D.7)', () => {
  const VALID_VERIFIER = 'a'.repeat(43);

  describe('isValidCodeVerifierFormat', () => {
    it('accepts the minimum length (43) unreserved-character string', () => {
      expect(isValidCodeVerifierFormat('a'.repeat(43))).toBe(true);
    });

    it('accepts the maximum length (128) unreserved-character string', () => {
      expect(isValidCodeVerifierFormat('a'.repeat(128))).toBe(true);
    });

    it('accepts every RFC 7636 unreserved character', () => {
      expect(isValidCodeVerifierFormat('A-Za-z0-9._~-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef')).toBe(true);
    });

    it('rejects a too-short verifier (42 chars)', () => {
      expect(isValidCodeVerifierFormat('a'.repeat(42))).toBe(false);
    });

    it('rejects a too-long verifier (129 chars)', () => {
      expect(isValidCodeVerifierFormat('a'.repeat(129))).toBe(false);
    });

    it('rejects a verifier containing a reserved character (space)', () => {
      expect(isValidCodeVerifierFormat('a'.repeat(42) + ' ')).toBe(false);
    });

    it('rejects a verifier containing "+", "/" or "=" (standard base64, not base64url/unreserved)', () => {
      expect(isValidCodeVerifierFormat('a'.repeat(41) + '+/')).toBe(false);
      expect(isValidCodeVerifierFormat('a'.repeat(42) + '=')).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(isValidCodeVerifierFormat('')).toBe(false);
    });
  });

  describe('isValidCodeChallengeFormat', () => {
    it('accepts a genuine S256 challenge (43 base64url characters)', () => {
      expect(isValidCodeChallengeFormat(computeCodeChallengeS256(VALID_VERIFIER))).toBe(true);
    });

    it('rejects a too-short value', () => {
      expect(isValidCodeChallengeFormat('a'.repeat(42))).toBe(false);
    });

    it('rejects a too-long value', () => {
      expect(isValidCodeChallengeFormat('a'.repeat(44))).toBe(false);
    });

    it('rejects a value containing standard-base64-only characters ("+"/"=")', () => {
      expect(isValidCodeChallengeFormat('a'.repeat(41) + '+=')).toBe(false);
    });
  });

  describe('computeCodeChallengeS256', () => {
    it('matches the RFC 7636 Appendix B worked example', () => {
      // RFC 7636 Appendix B's own verifier/challenge pair.
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      expect(computeCodeChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('is deterministic for the same input', () => {
      expect(computeCodeChallengeS256(VALID_VERIFIER)).toBe(computeCodeChallengeS256(VALID_VERIFIER));
    });

    it('produces different challenges for different verifiers', () => {
      expect(computeCodeChallengeS256('a'.repeat(43))).not.toBe(computeCodeChallengeS256('b'.repeat(43)));
    });
  });

  describe('verifyCodeVerifier', () => {
    it('accepts the correct verifier for a stored challenge', () => {
      const challenge = computeCodeChallengeS256(VALID_VERIFIER);
      expect(verifyCodeVerifier(VALID_VERIFIER, challenge)).toBe(true);
    });

    it('rejects an incorrect verifier', () => {
      const challenge = computeCodeChallengeS256(VALID_VERIFIER);
      expect(verifyCodeVerifier('b'.repeat(43), challenge)).toBe(false);
    });

    it('rejects a malformed (garbage) stored challenge without throwing', () => {
      expect(() => verifyCodeVerifier(VALID_VERIFIER, 'not-a-real-challenge')).not.toThrow();
      expect(verifyCodeVerifier(VALID_VERIFIER, 'not-a-real-challenge')).toBe(false);
    });

    it('rejects a challenge of a different length without throwing (timingSafeEqual length guard)', () => {
      expect(verifyCodeVerifier(VALID_VERIFIER, 'short')).toBe(false);
    });

    it('rejects an empty verifier', () => {
      const challenge = computeCodeChallengeS256(VALID_VERIFIER);
      expect(verifyCodeVerifier('', challenge)).toBe(false);
    });
  });
});
