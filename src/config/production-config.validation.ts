/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Configuration validation,
 * brief §13) — a production-fail-closed configuration boundary for the
 * OAuth/OIDC surface, wired into `ConfigModule.forRoot({ validate })` (see
 * `app.module.ts`) so a bad value stops the process at boot, before any
 * request is ever served — never a runtime surprise on the first real
 * request. Deliberately a plain function, not a class coupling business
 * logic to `process.env` directly (brief §13) — every OTHER piece of code
 * in this codebase still reads configuration exclusively through
 * `ConfigService`, unchanged; this function's only job is to reject an
 * unsafe environment before that `ConfigService` is ever handed to
 * anything.
 *
 * Defense in depth, not a replacement for `SigningKeyService`'s own
 * existing production check (`OAUTH_PRIVATE_KEY` missing ⇒ throw in
 * production, docs/KEY_MANAGEMENT_ARCHITECTURE.md §5/§7, unchanged) — this
 * runs strictly earlier (at `ConfigModule` load, before ANY module is
 * instantiated), catching a bad production config even sooner, and also
 * covers values `SigningKeyService` itself has no reason to know about
 * (issuer placeholder, numeric timing/rate-limit configuration).
 */

const PLACEHOLDER_ISSUER = 'https://identity.example.com';

/** Every numeric OAuth/OIDC/rate-limit env var this platform reads — validated (if present) regardless of environment: a malformed number is never valid, in any environment. */
const NUMERIC_ENV_VARS = [
  'OAUTH_CLOCK_SKEW_SECONDS',
  'OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS',
  'OAUTH_AUTHORIZATION_CODE_TTL_SECONDS',
  'OAUTH_AUTHORIZE_RATE_LIMIT_MAX',
  'OAUTH_AUTHORIZE_RATE_LIMIT_WINDOW_MS',
  'OAUTH_TOKEN_RATE_LIMIT_MAX',
  'OAUTH_TOKEN_RATE_LIMIT_WINDOW_MS',
  'OIDC_USERINFO_RATE_LIMIT_MAX',
  'OIDC_USERINFO_RATE_LIMIT_WINDOW_MS',
] as const;

export class InvalidProductionConfigurationError extends Error {}

/**
 * `ConfigModule.forRoot({ validate })`'s own required signature: receives
 * the raw parsed environment, must return it (optionally transformed) or
 * throw. Throwing here aborts Nest's bootstrap entirely (`NestFactory.create`
 * never resolves) — the intended fail-closed behavior for a genuinely
 * unsafe environment.
 */
export function validateProductionConfig(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of NUMERIC_ENV_VARS) {
    const raw = config[key];
    if (raw === undefined || raw === '') {
      continue; // unset — the reading code's own documented default applies, unchanged
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new InvalidProductionConfigurationError(`${key} must be a positive number if set (got: ${String(raw)})`);
    }
  }

  if (config['APP_ENV'] === 'production') {
    const issuer = typeof config['OAUTH_ISSUER'] === 'string' ? config['OAUTH_ISSUER'] : undefined;
    if (!issuer || issuer === PLACEHOLDER_ISSUER) {
      throw new InvalidProductionConfigurationError(
        `OAUTH_ISSUER must be set to this deployment's own real issuer value in production — refusing to start with it unset or left as the '${PLACEHOLDER_ISSUER}' example placeholder.`,
      );
    }
    if (!config['OAUTH_PRIVATE_KEY']) {
      // SigningKeyService throws on this too (defense in depth, unchanged)
      // — this earlier check exists so an operator sees the failure at the
      // very first moment of boot, from the same validation pass as every
      // other production-config check, not a second, separately-timed one.
      throw new InvalidProductionConfigurationError('OAUTH_PRIVATE_KEY must be set in production — refusing to start with an auto-generated ephemeral signing key.');
    }
  }

  return config;
}
