/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Security observability,
 * brief §7) — the canonical, stable, machine-readable reason-code
 * vocabulary for OAuth/OIDC/resource-server denials. These are the names a
 * dashboard, alert rule, or log query should key on going forward.
 *
 * This is deliberately a NEW, additive vocabulary layer, not a rename of
 * the existing internal `reasonCode` strings already scattered through
 * `AuthorizeService`/`AuthorizationCodeGrantService`/`ExternalAccessTokenValidator`
 * (e.g. `'missing_nonce'`, `'code_already_consumed'`, `'unsupported_algorithm'`)
 * — those are already stable, already tested, already used in ~500 passing
 * assertions across this codebase's own test suites, and a sweeping rename
 * purely for cosmetic vocabulary alignment would be pure risk for zero
 * security benefit. `docs/OAUTH_OPERATIONAL_HARDENING.md` §Reason code
 * crosswalk documents the mapping from each existing internal string to
 * its corresponding constant here, so both vocabularies stay legible
 * side by side without a risky mass refactor.
 */
export const OAuthReasonCodes = {
  RATE_LIMITED: 'OAUTH_RATE_LIMITED',
  INVALID_CLIENT: 'OAUTH_INVALID_CLIENT',
  INVALID_REDIRECT_URI: 'OAUTH_INVALID_REDIRECT_URI',
  INVALID_PKCE: 'OAUTH_INVALID_PKCE',
  NONCE_INVALID: 'OIDC_NONCE_INVALID',
  USERINFO_SCOPE_REQUIRED: 'OIDC_USERINFO_SCOPE_REQUIRED',
  RESOURCE_TOKEN_INVALID: 'RESOURCE_TOKEN_INVALID',
  RESOURCE_TOKEN_WRONG_AUDIENCE: 'RESOURCE_TOKEN_WRONG_AUDIENCE',
} as const;
