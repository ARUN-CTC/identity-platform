/**
 * Phase 2D.9 (brief §8) — the fixed, enumerable set of counter names this
 * codebase actually records. Kept as a single constants file (not scattered
 * string literals) so it is also the authoritative list for anyone
 * reviewing what is measured — and so a typo can never silently create a
 * new, uncoordinated counter name.
 */
export const IdentityMetricNames = {
  OAUTH_AUTHORIZE_REQUESTS: 'oauth_authorize_requests',
  OAUTH_AUTHORIZE_DENIED: 'oauth_authorize_denied',
  OAUTH_AUTHORIZATION_CODE_ISSUED: 'oauth_authorization_code_issued',
  OAUTH_AUTHORIZATION_CODE_REDEEMED: 'oauth_authorization_code_redeemed',
  OAUTH_AUTHORIZATION_CODE_REPLAYED: 'oauth_authorization_code_replayed',
  OAUTH_TOKEN_ISSUED: 'oauth_token_issued',
  OAUTH_TOKEN_DENIED: 'oauth_token_denied',
  OIDC_ID_TOKEN_ISSUED: 'oidc_id_token_issued',
  OIDC_USERINFO_REQUESTS: 'oidc_userinfo_requests',
  OIDC_USERINFO_DENIED: 'oidc_userinfo_denied',
  OAUTH_RATE_LIMITED: 'oauth_rate_limited',
  RESOURCE_TOKEN_VALIDATION_FAILED: 'resource_token_validation_failed',
} as const;

export const IdentityMetricDurations = {
  AUTHORIZE_LATENCY_MS: 'authorize_latency_ms',
  TOKEN_LATENCY_MS: 'token_latency_ms',
  USERINFO_LATENCY_MS: 'userinfo_latency_ms',
  JWKS_RESOLUTION_LATENCY_MS: 'jwks_resolution_latency_ms',
} as const;
