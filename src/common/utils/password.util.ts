import * as argon2 from 'argon2';

/**
 * Argon2id — never store or compare plaintext passwords. Phase 1
 * extracted source — copied from TravelOS, classified REUSABLE.
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
