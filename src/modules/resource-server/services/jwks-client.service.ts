import { createPublicKey, type JsonWebKey } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RawJwk {
  kty?: string;
  kid?: string;
  n?: string;
  e?: string;
}

const DEFAULT_MIN_REFRESH_INTERVAL_MS = 60_000; // brief §9.6 — anti-amplification cooldown
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Phase 2D.5 (docs/RESOURCE_SERVER_ARCHITECTURE.md §JWKS resolution) — the
 * resource-server-SIDE JWKS provider: fetches public keys over plain HTTP
 * from a configured JWKS URI, exactly as any real, separate resource-server
 * process (TravelOS, or any future product) would — never by reaching into
 * `SigningKeyService`'s in-process object, which also holds this
 * platform's own PRIVATE signing key material. This is a structural
 * decision, not a style preference: a class that never imports
 * `SigningKeyService` cannot possibly leak private key material into the
 * resource-server trust boundary, the same "structural, not conventional"
 * discipline `docs/adr/ADR-017-jwt-signing-key-management.md` already
 * applies to the legacy-vs-external split.
 *
 * The JWKS URI itself is a fixed, operator-configured value
 * (`OAUTH_JWKS_URI`) — NEVER derived from a token's own `iss`/`jku` claim.
 * Deriving a key-fetch target from attacker-controlled token content is
 * itself a known JWKS/SSRF and key-confusion vector; this class only ever
 * fetches the one URI it was configured with.
 *
 * Caching + cooldown: keys are cached in memory and never re-fetched on
 * every request. An unknown `kid` triggers at most one refresh attempt per
 * `minRefreshIntervalMs` (default 60s) — repeatedly presenting tokens with
 * fabricated/unknown `kid` values cannot force unbounded outbound JWKS
 * fetches (brief §9.6/§9.8, threat #8 "JWKS refresh amplification").
 * Concurrent callers during an in-flight refresh share the same promise
 * rather than triggering parallel duplicate fetches.
 */
@Injectable()
export class JwksClientService {
  private readonly logger = new Logger(JwksClientService.name);
  private cache = new Map<string, string>();
  private lastAttemptAt = 0;
  private refreshing: Promise<void> | null = null;
  private jwksUri: string;
  private readonly minRefreshIntervalMs: number;

  constructor(private readonly config: ConfigService) {
    // Local-development default only — points at this same process's own
    // JWKS endpoint. Any real, separate resource-server deployment MUST set
    // OAUTH_JWKS_URI explicitly to the Identity Platform's actual reachable
    // URL (see .env.example).
    const port = this.config.get<string>('PORT') ?? '4000';
    this.jwksUri = this.config.get<string>('OAUTH_JWKS_URI') ?? `http://localhost:${port}/.well-known/jwks.json`;
    this.minRefreshIntervalMs = Number(this.config.get<string>('OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS') ?? String(DEFAULT_MIN_REFRESH_INTERVAL_MS));
  }

  /**
   * Test/bootstrap override — production deployments configure
   * `OAUTH_JWKS_URI` instead. Not attacker-reachable from any HTTP route.
   *
   * Deliberately does NOT clear the existing key cache: a `kid` is an
   * immutable binding to one specific public key (a JWKS publisher reusing
   * the same `kid` for different key material would itself be a publisher
   * bug, not something this cache needs to defend against), so a key
   * already resolved under the previous URI remains just as valid to keep
   * serving — this is exactly what lets an already-cached token continue
   * verifying through a JWKS endpoint's own temporary outage, brief §31's
   * "JWKS unavailable with cached key → valid cached token still verifies."
   * Only the cooldown timer resets, so a lookup right after reconfiguring
   * is not itself suppressed by the previous URI's own recent attempt.
   */
  configureJwksUri(uri: string): void {
    this.jwksUri = uri;
    this.lastAttemptAt = 0;
  }

  /** Returns the cached PEM for `kid`, refreshing (subject to cooldown) exactly once if not already cached. Never throws — an unresolvable kid is `null`, the caller's own fail-closed signal. */
  async getPublicKeyForKid(kid: string): Promise<string | null> {
    const cached = this.cache.get(kid);
    if (cached) {
      return cached;
    }
    await this.refreshIfAllowed();
    return this.cache.get(kid) ?? null;
  }

  private async refreshIfAllowed(): Promise<void> {
    if (this.refreshing) {
      await this.refreshing;
      return;
    }
    const now = Date.now();
    if (now - this.lastAttemptAt < this.minRefreshIntervalMs) {
      this.logger.warn('JWKS refresh skipped — within cooldown window (repeated unknown-kid lookups do not trigger unbounded fetches).');
      return;
    }
    this.lastAttemptAt = now;
    this.refreshing = this.doFetch().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  private async doFetch(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(this.jwksUri, { signal: controller.signal });
      if (!response.ok) {
        this.logger.warn(`JWKS refresh failed: HTTP ${response.status} from ${this.jwksUri} — keeping existing cache.`);
        return;
      }
      const body = (await response.json()) as { keys?: RawJwk[] } | null;
      if (!body || !Array.isArray(body.keys)) {
        this.logger.warn('JWKS refresh failed: response body was not a valid JWK Set — keeping existing cache.');
        return;
      }

      const next = new Map<string, string>();
      for (const jwk of body.keys) {
        if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
          continue; // skip a malformed/unrecognized entry rather than failing the whole refresh
        }
        try {
          const pem = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }).export({ type: 'spki', format: 'pem' }) as string;
          next.set(jwk.kid, pem);
        } catch {
          continue; // a single malicious/malformed key entry never poisons the rest of the set
        }
      }
      this.cache = next; // atomic swap — never a partially-merged, inconsistent view
      this.logger.log(`JWKS refreshed from ${this.jwksUri} (${next.size} key(s)).`);
    } catch (err) {
      this.logger.warn(`JWKS refresh failed: ${err instanceof Error ? err.message : 'unknown error'} — keeping existing cache.`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
