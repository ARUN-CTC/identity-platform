/**
 * Phase 2D.8 (docs/OIDC_PROVIDER.md) — OIDC constants shared across the
 * authorize/token/userinfo/discovery surface. Kept in one file so none of
 * these values can silently drift between the places that must agree on
 * them (brief §5/§19/§22).
 */

/** The scope that triggers OIDC behavior at all (brief §5) — never treated as an IAM or API permission. */
export const OPENID_SCOPE = 'openid';
/** Standard OIDC scopes unlocking additional user claims (brief §19) — subject to the SAME `ApplicationScopePolicy` allow-list as any other scope; no parallel registry. */
export const PROFILE_SCOPE = 'profile';
export const EMAIL_SCOPE = 'email';

/**
 * The dedicated resource audience `/userinfo` requires (brief §22 — "if the
 * existing architecture uses a dedicated audience 'userinfo', configure and
 * validate it explicitly... do not blindly accept every Identity Platform
 * access token"). An OIDC client must request this exact audience at
 * `/authorize` (alongside any other resource audience it also wants) for
 * the resulting Access Token to be usable at `/userinfo` — matching how
 * every other protected route in this codebase requires its own registered
 * `@ExpectedAudience`, never a wildcard.
 */
export const OIDC_USERINFO_AUDIENCE = 'identity-platform-userinfo';
