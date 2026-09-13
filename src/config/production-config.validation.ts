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

/** The exact `.env.example` placeholder — never a real secret, never valid in production. */
const PLACEHOLDER_JWT_ACCESS_SECRET = 'replace-with-a-real-secret-min-32-chars';

/** The exact `.env.example` placeholder password — a strong signal this is still the untouched local-dev template, never a real production database. */
const PLACEHOLDER_DATABASE_PASSWORD = 'changeme';

const MIN_JWT_ACCESS_SECRET_LENGTH = 32;

/** Every numeric OAuth/OIDC/rate-limit/session/token-lifetime env var this platform reads — validated (if present) regardless of environment: a malformed number is never valid, in any environment. */
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
  // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Configuration) — the legacy
  // (HS256) session/token lifetimes were never validated by this function
  // before this phase, despite being just as capable of a malformed-value
  // boot-time surprise as the OAuth ones above.
  'JWT_ACCESS_TOKEN_TTL',
  'JWT_REFRESH_TOKEN_TTL',
  'JWT_REFRESH_TOKEN_TTL_SHORT',
  'PLATFORM_ACCESS_TOKEN_TTL',
  'PLATFORM_REFRESH_TOKEN_TTL',
  'USER_INVITATION_TOKEN_TTL_HOURS',
  'PASSWORD_RESET_TOKEN_TTL_HOURS',
] as const;

/**
 * Phase 2D.11 — a small set of SECURITY-SENSITIVE numeric values additionally
 * get an upper bound, not merely "positive" (brief §5: "Unsafe TTL: FAIL
 * CLOSED", "Unsafe clock skew: FAIL CLOSED"). Deliberately NOT applied to
 * every value in `NUMERIC_ENV_VARS` above — a long "remember me" refresh
 * token lifetime (`JWT_REFRESH_TOKEN_TTL`, default 30 days) is a legitimate
 * product/UX decision, not a security defect, and this function must not
 * silently encode an opinion about it. Only values whose EXCESSIVE size
 * itself directly widens an attack window get a ceiling here.
 */
const MAX_BOUNDED_ENV_VARS: Record<string, number> = {
  // A clock-skew tolerance this large would materially weaken expiry/nbf
  // enforcement — 5 minutes is already generous for real clock drift.
  OAUTH_CLOCK_SKEW_SECONDS: 300,
  // This platform's own design target is "≤60 seconds" (docs/OAUTH_ARCHITECTURE.md
  // §5); 600 seconds (10 minutes) is a generous upper bound that still
  // catches a genuinely misconfigured, replay-window-widening value (e.g.
  // a code that lives for a day).
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS: 600,
};

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
    const max = MAX_BOUNDED_ENV_VARS[key];
    if (max !== undefined && value > max) {
      throw new InvalidProductionConfigurationError(`${key} must not exceed ${max} (got: ${String(raw)}) — an excessively large value here widens a security-relevant time window`);
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

    // Phase 2D.11 — the legacy HS256 secret had NO production check at all
    // before this phase: an unset/placeholder value previously surfaced
    // only as a cryptic jsonwebtoken runtime error on the first login
    // attempt, not a clear boot-time failure. Never logs the actual value.
    const jwtSecret = typeof config['JWT_ACCESS_SECRET'] === 'string' ? config['JWT_ACCESS_SECRET'] : undefined;
    if (!jwtSecret || jwtSecret === PLACEHOLDER_JWT_ACCESS_SECRET) {
      throw new InvalidProductionConfigurationError('JWT_ACCESS_SECRET must be set to a real secret in production — refusing to start unset or left as the example placeholder.');
    }
    if (jwtSecret.length < MIN_JWT_ACCESS_SECRET_LENGTH) {
      throw new InvalidProductionConfigurationError(`JWT_ACCESS_SECRET must be at least ${MIN_JWT_ACCESS_SECRET_LENGTH} characters in production (got a ${jwtSecret.length}-character value).`);
    }

    // Phase 2D.11 — DATABASE_URL was never checked for the untouched local-
    // dev template password. Never logs the connection string itself (which
    // may embed the real password) — only whether the ONE known example
    // password substring is present.
    const databaseUrl = typeof config['DATABASE_URL'] === 'string' ? config['DATABASE_URL'] : undefined;
    if (!databaseUrl) {
      throw new InvalidProductionConfigurationError('DATABASE_URL must be set in production.');
    }
    if (databaseUrl.includes(`:${PLACEHOLDER_DATABASE_PASSWORD}@`)) {
      throw new InvalidProductionConfigurationError("DATABASE_URL still contains the local-development example password ('changeme') — refusing to start against what looks like an untouched template.");
    }

    // Phase 2D.11 (docs/PRODUCTION_READINESS.md §Configuration) — `main.ts`
    // reflects any origin when this is unset, appropriate only for local
    // development. A production deployment must name its actual product
    // origins explicitly.
    const corsOrigins = typeof config['CORS_ALLOWED_ORIGINS'] === 'string' ? config['CORS_ALLOWED_ORIGINS'].trim() : '';
    if (!corsOrigins) {
      throw new InvalidProductionConfigurationError('CORS_ALLOWED_ORIGINS must be set to an explicit, comma-separated origin list in production — refusing to start with the "allow any origin" development default.');
    }
    if (corsOrigins.includes('*')) {
      throw new InvalidProductionConfigurationError("CORS_ALLOWED_ORIGINS must not contain a wildcard ('*') in production.");
    }
  }

  return config;
}
