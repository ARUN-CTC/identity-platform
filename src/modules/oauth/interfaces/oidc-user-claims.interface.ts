/**
 * Phase 2D.8 (docs/OIDC_PROVIDER.md §12/§13, brief §46/§47) — the clean,
 * explicit mapping target between `SecurityUser` and OIDC claims, shared by
 * both ID Token issuance (`AuthorizationCodeGrantService`) and `/userinfo`
 * (`UserInfoController`) so the two never independently reinvent (and
 * potentially drift from) the same scope-to-claim rule. Deliberately NOT
 * `Partial<SecurityUser>` or any structural alias of the Prisma entity —
 * this interface is the one, explicit place a new `SecurityUser` column
 * would have to be deliberately added to before it could ever leak into an
 * OIDC response (brief §47: "never expose internal entity serialization
 * directly").
 */
export interface OidcUserClaims {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
}
