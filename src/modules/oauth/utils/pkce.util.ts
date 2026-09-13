import { createHash, timingSafeEqual } from 'crypto';

/**
 * Phase 2D.7 (RFC 7636, docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §2/§3) — PKCE
 * verifier/challenge helpers. `S256` only — `plain` is never supported (the
 * brief's own requirement, matching `docs/OAUTH_ARCHITECTURE.md` §3's
 * already-approved design: "plain challenge method is not supported").
 *
 * RFC 7636 §4.1: a `code_verifier` is 43-128 characters from the unreserved
 * character set `[A-Za-z0-9-._~]`. A `code_challenge` for S256 is always
 * exactly 43 characters (`BASE64URL(SHA256(x))` with no padding, over a
 * 32-byte digest) drawn from the base64url alphabet.
 */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeVerifierFormat(codeVerifier: string): boolean {
  return CODE_VERIFIER_PATTERN.test(codeVerifier);
}

export function isValidCodeChallengeFormat(codeChallenge: string): boolean {
  return CODE_CHALLENGE_PATTERN.test(codeChallenge);
}

/** `BASE64URL(SHA256(codeVerifier))` — the S256 transform, RFC 7636 §4.2. */
export function computeCodeChallengeS256(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/**
 * Verifies a presented `code_verifier` against the `code_challenge` stored
 * with the authorization code at issuance (brief §31: "constant-time
 * comparison... reject missing/incorrect/malformed verifier"). Returns
 * `false` — never throws — for anything that doesn't match; the caller
 * (`AuthorizationCodeGrantService`) collapses every failure reason into the
 * same generic `invalid_grant` (brief: "do not expose which exact PKCE
 * validation step failed").
 *
 * `timingSafeEqual` requires equal-length buffers — a length mismatch is
 * itself resolved to `false` directly (S256 challenges are always exactly
 * 43 bytes, so a length mismatch already means "does not match" with no
 * timing-sensitive secret being compared) rather than throwing.
 */
export function verifyCodeVerifier(codeVerifier: string, storedCodeChallenge: string): boolean {
  const computed = computeCodeChallengeS256(codeVerifier);
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(storedCodeChallenge, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
