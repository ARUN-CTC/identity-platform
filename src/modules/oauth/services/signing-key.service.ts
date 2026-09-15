import { createHash, createPublicKey, generateKeyPairSync, type JsonWebKey } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Jwk, JwksResponse } from '../interfaces';

interface LoadedSigningKey {
  kid: string;
  /** null for a RETIRED key — retained for verification only, never used to sign (docs/KEY_MANAGEMENT_ARCHITECTURE.md §4). */
  privateKeyPem: string | null;
  publicKeyPem: string;
  status: 'ACTIVE' | 'RETIRED';
}

/**
 * Phase 2D.1 (docs/adr/ADR-017-jwt-signing-key-management.md,
 * docs/KEY_MANAGEMENT_ARCHITECTURE.md) — the RSA key-material abstraction
 * backing the NEW external (OAuth/OIDC) RS256 token type. Structurally
 * separate from, and never touches, the legacy HS256 `JWT_ACCESS_SECRET`
 * (src/modules/jwt/jwt.module.ts) — that token's own signing/verification is
 * unaffected by anything in this file (docs/EXTERNAL_API_TRUST_BOUNDARY.md §0).
 *
 * Deliberately holds key material in-memory/config-driven, not in a database
 * table — Phase 2D.1's own brief explicitly prefers zero schema/migration
 * footprint unless persistent storage is unavoidable, and it is not: an
 * operator-supplied PEM (via `OAUTH_PRIVATE_KEY`) plus an optional list of
 * still-valid-for-verification retired public keys (`OAUTH_RETIRED_PUBLIC_KEYS`)
 * is exactly the "current signing key + previous verification keys" model
 * `docs/KEY_MANAGEMENT_ARCHITECTURE.md` §4 describes, without a table.
 *
 * The private key NEVER appears in any JWKS response, any log line, any
 * exception message, or any HTTP response of any kind — see getJwks(),
 * which builds every entry from a KeyObject constructed from the PUBLIC key
 * PEM alone, which structurally cannot carry private fields (verified
 * empirically: Node's own `createPublicKey(pem).export({format:'jwk'})`
 * yields only `{kty, n, e}` for an RSA public key — see this service's own
 * test suite).
 */
@Injectable()
export class SigningKeyService implements OnModuleInit {
  private readonly logger = new Logger(SigningKeyService.name);
  private keys: LoadedSigningKey[] = [];
  private activeKid: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.loadOrGenerateActiveKey();
    this.loadRetiredPublicKeys();
  }

  private loadOrGenerateActiveKey(): void {
    const configuredPrivateKey = this.config.get<string>('OAUTH_PRIVATE_KEY')?.trim();
    const appEnv = this.config.get<string>('APP_ENV');

    if (configuredPrivateKey) {
      // Multiline PEM values are conventionally stored in a single-line env
      // var with literal "\n" sequences (the same convention as, e.g.,
      // service-account JSON keys) — unescape before parsing.
      const privateKeyPem = configuredPrivateKey.includes('\\n') ? configuredPrivateKey.replace(/\\n/g, '\n') : configuredPrivateKey;
      const publicKeyPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }) as string;
      const kid = this.config.get<string>('OAUTH_KEY_ID')?.trim() || this.fingerprint(publicKeyPem);
      this.keys.push({ kid, privateKeyPem, publicKeyPem, status: 'ACTIVE' });
      this.activeKid = kid;
      this.logger.log(`External (OAuth/OIDC) RS256 signing key loaded from configuration (kid=${kid}).`);
      return;
    }

    if (appEnv === 'production') {
      // FAIL CLOSED — never silently generate signing key material in
      // production. A restart-triggered new ephemeral key would silently
      // invalidate every JWKS-cached public key held by every resource
      // server, and worse, would mean production signing key material was
      // never actually operator-controlled at all.
      throw new Error(
        'OAUTH_PRIVATE_KEY is not configured. Refusing to start with an auto-generated external ' +
          'signing key while APP_ENV=production — see docs/KEY_MANAGEMENT_ARCHITECTURE.md §5/§7.',
      );
    }

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const kid = `dev-${this.fingerprint(publicKey)}`;
    this.keys.push({ kid, privateKeyPem: privateKey, publicKeyPem: publicKey, status: 'ACTIVE' });
    this.activeKid = kid;
    this.logger.warn(
      `OAUTH_PRIVATE_KEY not configured — generated an EPHEMERAL, in-memory-only RSA signing key for local ` +
        `development (kid=${kid}). Every external token signed with it becomes unverifiable on the next ` +
        `restart; never rely on this outside local development — see docs/KEY_MANAGEMENT_ARCHITECTURE.md §7.`,
    );
  }

  private loadRetiredPublicKeys(): void {
    const raw = this.config.get<string>('OAUTH_RETIRED_PUBLIC_KEYS')?.trim();
    if (!raw) {
      return;
    }
    let parsed: { kid: string; publicKey: string }[];
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error('OAUTH_RETIRED_PUBLIC_KEYS is not valid JSON — ignoring, no retired verification keys loaded.');
      return;
    }
    for (const entry of parsed) {
      if (!entry.kid || !entry.publicKey) {
        continue;
      }
      const publicKeyPem = entry.publicKey.includes('\\n') ? entry.publicKey.replace(/\\n/g, '\n') : entry.publicKey;
      this.keys.push({ kid: entry.kid, privateKeyPem: null, publicKeyPem, status: 'RETIRED' });
      this.logger.log(`Retired external verification key registered (kid=${entry.kid}) — valid for verification only, never for signing.`);
    }
  }

  /** SHA-256 fingerprint of the public key, base64url, truncated — a stable, collision-resistant default `kid` when none is explicitly configured. */
  private fingerprint(publicKeyPem: string): string {
    return createHash('sha256').update(publicKeyPem).digest('base64url').slice(0, 16);
  }

  /** The key currently used to SIGN new external tokens — never a retired one. */
  getSigningKey(): { kid: string; privateKeyPem: string } {
    const active = this.activeKid ? this.keys.find((k) => k.kid === this.activeKid) : undefined;
    if (!active || !active.privateKeyPem) {
      throw new Error('No active external signing key is available.');
    }
    return { kid: active.kid, privateKeyPem: active.privateKeyPem };
  }

  /** Looks up a public key (for verification) by `kid` — active or retired-but-still-valid. Returns null for an unrecognized `kid`, never throws. */
  getPublicKeyForKid(kid: string): string | null {
    return this.keys.find((k) => k.kid === kid)?.publicKeyPem ?? null;
  }

  /**
   * Every currently-verification-valid public key (active + retired-not-yet-
   * expired), in RFC 7517 JWKS form. Never includes private key material —
   * see this class's own doc comment for why that's structural, not just
   * policy.
   */
  getJwks(): JwksResponse {
    const keys: Jwk[] = this.keys.map((k) => {
      const jwk = createPublicKey(k.publicKeyPem).export({ format: 'jwk' }) as JsonWebKey;
      return {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid: k.kid,
        n: jwk.n as string,
        e: jwk.e as string,
      };
    });
    return { keys };
  }
}
