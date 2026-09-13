/**
 * Phase 2D.5 (docs/RESOURCE_SERVER_ARCHITECTURE.md) — `SERVICE_ACCOUNT` was
 * the only principal type an externally-issued (RS256/JWKS) access token
 * could produce. Phase 2D.7 (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §15)
 * adds `USER` — a human, Authorization-Code-issued token whose `sub` is a
 * `security_user.id`, never a `ServiceAccount.id`/`Application.id`. The
 * discriminator is the token's own explicit `principal_type` claim (never
 * inferred from the shape of `sub` — brief §33: "do not infer UUID = user
 * / UUID = service account").
 */
export type ExternalPrincipalType = 'SERVICE_ACCOUNT' | 'USER';

/**
 * The verified result of `ExternalAccessTokenValidator.validate()` — every
 * field here has already passed cryptographic signature verification,
 * issuer/audience/temporal validation, and required-claim shape checks
 * (`docs/RESOURCE_SERVER_ARCHITECTURE.md` §Principal construction). Nothing
 * in this codebase performs a further database lookup to "resolve" this
 * principal — the validated token claims ARE the principal; no
 * `ServiceAccount`/`Application`/`Tenant`/`SecurityUser` row is re-fetched
 * (brief §40: "no database lookups on every JWT validation").
 *
 * Every field is a plain, inert fact about who is calling — NONE of them
 * is itself an authorization decision (`tenantId` in particular: see
 * `docs/RESOURCE_SERVER_ARCHITECTURE.md` §Tenant context — it is trusted
 * only because it came from a token this platform itself signed, never
 * because a caller merely claims it).
 *
 * Deliberately ONE flat interface, not a discriminated union split across
 * two types — `serviceAccountId`/`userId`/`organizationId` are each
 * optional and populated only for the principal type they name (checked
 * via `principal.type`, never guessed), so every OTHER field
 * (`subject`/`tenantId`/`clientId`/`scopes`/`jti`/…) stays uniformly
 * required and usable by generic downstream code (scope evaluation, tenant
 * matching, `ResourceAuthorizationContext`) with no per-type branching.
 */
export interface AuthenticatedExternalPrincipal {
  readonly type: ExternalPrincipalType;

  /** The token's own `sub` claim, verbatim — `ServiceAccount.id` for a SERVICE_ACCOUNT principal, `security_user.id` for a USER principal. Never `Application.id`. */
  readonly subject: string;

  /** Populated (equal to `subject`) only when `type === 'SERVICE_ACCOUNT'`. Always `undefined` for a USER principal — a human identity is never given a ServiceAccount id. */
  readonly serviceAccountId?: string;

  /** Populated (equal to `subject`) only when `type === 'USER'`. Always `undefined` for a SERVICE_ACCOUNT principal. */
  readonly userId?: string;

  /** The registered Application (OAuth client) this token was issued to — `Application.clientId`, never the Application's internal id. */
  readonly clientId: string;

  /** The Tenant this token is scoped to — server-validated at issuance (Phase 2D.4's `ServiceAccountTenantGrant` check for SERVICE_ACCOUNT, the authenticated session's own tenant for USER), carried here as a routing/context fact only. */
  readonly tenantId: string;

  /**
   * Populated only when `type === 'USER'` — the human session's validated
   * organization-context selection at authorization-code issuance time (see
   * `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md` §11). `null` means tenant-wide;
   * `undefined` for a SERVICE_ACCOUNT principal (a service identity never
   * has an organization context — Phase 2D.4/2D.5, unchanged).
   */
  readonly organizationId?: string | null;

  /** The single resource-API audience this token is valid for (already matched against the caller's own `expectedAudience` by `validate()` — this field is the verified value, not merely echoed input). */
  readonly audience: string;

  /** Parsed from the token's `scope` claim (space-delimited) — `[]` if the claim was absent (Phase 2D.4 omits it when no scope was requested; absence means "no scopes," never "all scopes"). Never itself an IAM permission — see `docs/RESOURCE_SERVER_ARCHITECTURE.md` §Scope vs IAM boundary. */
  readonly scopes: string[];

  /** Unique token id — for correlation/logging only, never itself a trust decision. */
  readonly jti: string;

  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly notBefore?: Date;

  /** The token's own verified `iss` claim (always this platform's configured issuer — verified, not merely copied). */
  readonly issuer: string;
}
