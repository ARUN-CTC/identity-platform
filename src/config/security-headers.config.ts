import type { HelmetOptions } from 'helmet';

/**
 * Phase 3.1 (production hardening) — extracted from `main.ts`'s own
 * `bootstrap()` for the same reason `parseCorsAllowedOrigins` already was
 * (see that file's own header comment): no existing e2e test fixture
 * replicates `main.ts`'s own middleware setup (every spec builds its Nest
 * app directly via `TestingModule`, never `bootstrap()`), so anything
 * configured only inline there is otherwise permanently untested. This
 * function is the single source of truth `main.ts` and a dedicated e2e
 * spec both call — no drift possible between what ships and what's tested.
 *
 * `contentSecurityPolicy: false` — deliberate, not an oversight: this API
 * serves exactly one HTML surface itself, Swagger UI at `/api/docs`, which
 * loads its own inline scripts/styles that helmet's default CSP would
 * break outright. CSP is an app-wide helmet setting, not per-route, so
 * authoring one permissive enough for Swagger UI would then also apply
 * (weakened) to every JSON endpoint — which has no CSP-exploitable surface
 * to protect in the first place (it returns no other HTML/inline script
 * anywhere). The real browser-facing origin (the separate frontend app) is
 * responsible for its own CSP. Every other helmet default (nosniff,
 * frame-ancestors, no-referrer, HSTS, etc.) is left unmodified.
 */
export function securityHeadersOptions(): HelmetOptions {
  return { contentSecurityPolicy: false };
}
