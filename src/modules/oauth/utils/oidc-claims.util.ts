import { OidcUserClaims } from '../interfaces';
import { EMAIL_SCOPE, PROFILE_SCOPE } from '../constants/oidc.constants';

/** The minimal shape this mapper needs from a `SecurityUser` row — never the whole Prisma entity (brief §47: no accidental leakage when the entity gains new fields later). */
export interface OidcClaimsUserInput {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string;
  emailVerifiedAt: Date | null;
}

/**
 * Phase 2D.8 (docs/OIDC_PROVIDER.md §12/§13, brief §46/§47) — the ONE place
 * `SecurityUser` fields are mapped into OIDC claims, shared by ID Token
 * issuance and `/userinfo` so both can never independently drift. Pure
 * function — no database access, no signing, no HTTP — deliberately
 * separate from `IdTokenService` (brief §46: "keep claim generation
 * separate from token signing... do not put user-database logic inside
 * cryptographic signing services").
 *
 * Claim release is strictly scope-gated (brief §19/§45): `sub` is always
 * returned (it IS the `openid` claim); `name`/`given_name`/`family_name`/
 * `preferred_username` are returned ONLY if `profile` is among `scopes`;
 * `email`/`email_verified` ONLY if `email` is among `scopes`. Never
 * granted merely because the user happens to have the underlying data
 * (brief: "do not issue profile/email claims merely because the user
 * exists").
 *
 * `email_verified` is derived exclusively from `emailVerifiedAt !== null` —
 * never hardcoded `true`, never inferred from "an email address exists"
 * (brief §20/Invariant 13).
 */
export function mapOidcUserClaims(user: OidcClaimsUserInput, scopes: string[]): OidcUserClaims {
  const claims: OidcUserClaims = { sub: user.id };

  if (scopes.includes(PROFILE_SCOPE)) {
    const name = [user.firstName, user.lastName].filter((part): part is string => Boolean(part)).join(' ');
    if (name) {
      claims.name = name;
    }
    if (user.firstName) {
      claims.given_name = user.firstName;
    }
    if (user.lastName) {
      claims.family_name = user.lastName;
    }
    if (user.username) {
      claims.preferred_username = user.username;
    }
  }

  if (scopes.includes(EMAIL_SCOPE)) {
    claims.email = user.email;
    claims.email_verified = user.emailVerifiedAt !== null;
  }

  return claims;
}
