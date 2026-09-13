import { RateLimitPolicy } from './rate-limit.interfaces';

/**
 * Phase 2D.9 — the named policies this platform actually applies today
 * (brief §4: "use different policies for authorization attempts, token
 * requests, userinfo requests"). Defaults are deliberately generous —
 * conservative enough to catch a genuine flood, but never disruptive to a
 * legitimate client's normal retry/polling behavior, or to this
 * codebase's own, unrelated e2e suites, which routinely make dozens of
 * requests to `/oauth/token` in a single test run and know nothing about
 * rate limiting. Overridable via environment so an operator can tune them
 * per deployment without a code change.
 *
 * Deliberately evaluated FRESH on every call (never memoized/frozen at
 * import time) — `RateLimitGuard` calls `getRateLimitPolicy()` once per
 * request, so a test that needs to exercise the limit itself can override
 * the relevant env var immediately before its own requests (and restore it
 * immediately after) without that value leaking into any other test file
 * sharing the same Jest worker process.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const AUTHORIZE_POLICY_NAME = 'oauth_authorize';
export const TOKEN_POLICY_NAME = 'oauth_token';
export const USERINFO_POLICY_NAME = 'oidc_userinfo';

function buildPolicy(name: string, windowEnvVar: string, windowDefault: number, maxEnvVar: string, maxDefault: number): RateLimitPolicy {
  return {
    name,
    windowMs: envInt(windowEnvVar, windowDefault),
    maxRequests: envInt(maxEnvVar, maxDefault),
  };
}

/** Resolves a named policy's CURRENT configuration (env-overridable, read fresh) — `undefined` for an unrecognized name (a route-configuration bug, handled by the guard's own fail-open-on-missing-policy posture). */
export function getRateLimitPolicy(name: string): RateLimitPolicy | undefined {
  switch (name) {
    case AUTHORIZE_POLICY_NAME:
      return buildPolicy(AUTHORIZE_POLICY_NAME, 'OAUTH_AUTHORIZE_RATE_LIMIT_WINDOW_MS', 60_000, 'OAUTH_AUTHORIZE_RATE_LIMIT_MAX', 300);
    case TOKEN_POLICY_NAME:
      return buildPolicy(TOKEN_POLICY_NAME, 'OAUTH_TOKEN_RATE_LIMIT_WINDOW_MS', 60_000, 'OAUTH_TOKEN_RATE_LIMIT_MAX', 300);
    case USERINFO_POLICY_NAME:
      return buildPolicy(USERINFO_POLICY_NAME, 'OIDC_USERINFO_RATE_LIMIT_WINDOW_MS', 60_000, 'OIDC_USERINFO_RATE_LIMIT_MAX', 300);
    default:
      return undefined;
  }
}
