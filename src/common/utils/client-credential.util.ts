import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Phase 2B — Application (OAuth "client") credentials. A client_id is a
 * public, non-secret identifier (safe to log, safe to put in a URL) — a
 * client_secret is a high-entropy random value, hashed with a fast
 * cryptographic hash (not Argon2id) before storage: unlike a user password,
 * a client_secret is never attacker-guessable low-entropy input, so a
 * memory-hard KDF buys nothing here — same reasoning already applied to
 * this codebase's refresh/invitation/reset tokens (see
 * TokenService.hashRefreshToken()).
 */
export function generateClientId(): string {
  return `cli_${randomBytes(18).toString('base64url')}`;
}

/** Returned to the caller exactly once, at creation — never persisted or logged in plaintext. */
export function generateClientSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Phase 2D.4 — the first call site that actually VERIFIES a client secret
 * against its stored hash (every prior phase only ever generated/hashed
 * one; nothing yet compared a candidate against it). `hashClientSecret` is
 * a deterministic, unsalted SHA-256 digest, so verification is otherwise
 * "hash the candidate, compare to the stored hash" — done here with
 * `timingSafeEqual` rather than `===` as defense in depth against a timing
 * side-channel on the comparison itself (the hash step already destroys any
 * useful timing signal about the *secret*, but comparing the resulting
 * digests byte-by-byte with early-exit `===` is still avoidable at
 * essentially zero cost). Returns `false` (never throws) for a `null`
 * stored hash (a PUBLIC application with no secret) or a length mismatch —
 * `timingSafeEqual` itself throws on unequal-length buffers, which would
 * otherwise leak a length signal via which code path is taken.
 */
export function verifyClientSecret(candidate: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) {
    return false;
  }
  const candidateHash = Buffer.from(hashClientSecret(candidate), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidateHash.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(candidateHash, stored);
}
