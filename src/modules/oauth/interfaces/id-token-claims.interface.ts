/**
 * Phase 2D.8 (docs/OIDC_PROVIDER.md §7-9) — the OIDC ID Token's own claim
 * shape, DELIBERATELY separate from `ExternalTokenClaims` (the Access
 * Token's shape). Never copy Access Token claims (`scope`, `tenant_id`,
 * `client_id`-as-a-separate-field, `jti`) blindly into this interface — an
 * ID Token is for the OIDC Client's own authentication use, never for a
 * Resource Server's authorization decision (docs/OIDC_PROVIDER.md §2).
 *
 * `token_use: 'id_token'` is the explicit, structural discriminator this
 * phase adds so a Resource Server can reject an ID Token presented as a
 * bearer access token without relying on `aud`/claim-shape alone (brief
 * §28) — see `ExternalAccessTokenValidator`'s own updated rejection.
 */
export interface IdTokenClaims {
  /** Always this platform's own configured issuer — identical value, identical config source (`OAUTH_ISSUER`), as every other token/discovery surface (brief §38). */
  iss: string;
  /** The stable OIDC subject — `SecurityUser.id`, verbatim, the SAME value as the corresponding Access Token's own `sub` (docs/OIDC_PROVIDER.md §11 — "subject semantics"). Never email/username/a tenant- or organization-qualified compound. */
  sub: string;
  /** THE REQUESTING OIDC CLIENT'S OWN `Application.clientId` — never a resource-API audience (brief §14, the single most important claim-semantics rule in this phase). */
  aud: string;
  exp: number;
  iat: number;
  /** The client's own, unmodified nonce from the authorization request — mandatory for every ID Token this platform issues (brief §8). */
  nonce: string;
  /** Explicit token-purpose discriminator — always `'id_token'` here, never inferred from claim shape alone. */
  token_use: 'id_token';

  // --- Optional OIDC standard user claims — present only per granted scope
  // (docs/OIDC_PROVIDER.md §3/§19) — never emitted merely because the user exists.
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  email?: string;
  /** Only ever `true`/`false` derived from `SecurityUser.emailVerifiedAt` — NEVER fabricated as `true` merely because an email address exists (brief §20). */
  email_verified?: boolean;
}

/** Input to `IdTokenService.sign()` — `iss`/`exp`/`iat`/`token_use` are set by the signing service itself, never passed in directly (mirrors `ExternalTokenSignInput`'s own convention). */
export type IdTokenSignInput = Omit<IdTokenClaims, 'iss' | 'exp' | 'iat' | 'token_use'>;
