import { createHash } from 'crypto';

/**
 * Phase 2D.9 (brief §4 — "rate-limit keys must not permit trivial bypass by
 * changing irrelevant request parameters... choose the least
 * privacy-invasive key that still provides useful abuse resistance...
 * do not log raw IP addresses unless the existing security/privacy
 * architecture explicitly permits it") — builds one bounded rate-limit key
 * from the two facts that actually identify "who is making this attempt":
 * the OAuth client (`client_id`, when the request names one) and a
 * SHA-256-hashed, truncated source-network identifier. Neither component
 * is ever the raw request body/query as a whole, so changing `state`,
 * `nonce`, `scope`, `redirect_uri`, or any other request field never
 * changes the key — only changing WHO is asking (a different client) or
 * WHERE from (a different source) does.
 *
 * The source identifier is hashed, never stored or logged in raw form —
 * this is deliberately a ONE-WAY, bounded (16 hex chars) fingerprint, not
 * an IP address a log line or audit record could later replay; it exists
 * only to be compared for equality against itself on a later request, the
 * same "opaque, bounded correlation fact" discipline this codebase already
 * applies to a trace ID.
 */
export function buildRateLimitKey(source: string, clientId?: string): string {
  const sourceHash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  return clientId ? `client:${clientId}|src:${sourceHash}` : `src:${sourceHash}`;
}

/** The best-effort source-network identifier available on an Express request — never logged, only ever hashed via `buildRateLimitKey`. */
export function sourceIdentifierFor(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
