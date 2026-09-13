/**
 * Phase 2D.1 (docs/TOKEN_AND_SCOPE_ARCHITECTURE.md) — the claim shape for a
 * NEW, RS256-signed, externally-verifiable token, structurally distinct from
 * the existing proprietary `AccessTokenClaims` (HS256,
 * src/modules/jwt/services/token.service.ts) — the two are never
 * interchangeable and never share a verifier (docs/EXTERNAL_API_TRUST_BOUNDARY.md §0).
 *
 * No `/authorize`/`/token` endpoint issues this yet (Phase 2D.1 builds only
 * the signing/verification foundation) — this interface exists so
 * ExternalTokenService has a typed contract to sign/verify against, ready
 * for the endpoints a later phase adds.
 *
 * `tenant_id`/`organization_id`/`scope` are routing/convenience facts only,
 * per ADR-016/ADR-019 — NEVER authorization by themselves. Any consumer
 * (resource server or this platform's own future code) must independently
 * re-validate membership/entitlement/permission before acting on them — see
 * docs/ORGANIZATION_CONTEXT_SECURITY.md §2.
 */
export interface ExternalTokenClaims {
  /** Always this platform's own configured issuer (OAUTH_ISSUER). Mandatory, validated on every verify. */
  iss: string;
  /** The principal's stable id — a human security_user.id or (once built) a ServiceAccount.id. Never trusted as proof of current standing by itself. */
  sub: string;
  /** The resource API this token is valid for. Mandatory, validated on every verify — one token, one audience (docs/TOKEN_AND_SCOPE_ARCHITECTURE.md §6). */
  aud: string;
  /** Standard expiry (seconds since epoch). */
  exp: number;
  /** Standard issued-at (seconds since epoch). */
  iat: number;
  /** Standard not-before (seconds since epoch) — optional, only present when explicitly requested at signing. */
  nbf?: number;
  /** Unique token id — introspection-by-id / audit correlation, never logged as part of the whole token. */
  jti: string;
  /** Space-delimited OAuth scopes granted to the requesting Application — "what may this application call," never IAM permission (docs/APPLICATION_AUTHORIZATION.md §1). */
  scope?: string;
  /** Convenience/routing fact only — human tokens, nullable-in-spirit (absent = tenant-wide/none). Never authorization by itself. */
  tenant_id?: string;
  /** Convenience/routing fact only — human tokens, may be absent (no organization selected). Never authorization by itself. */
  organization_id?: string | null;
  /** The registered Application (OAuth client) this token was issued to. */
  client_id?: string;
  /**
   * Phase 2D.7 (docs/OAUTH_AUTHORIZATION_CODE_PKCE.md §15,
   * `docs/PHASE_2D_ARCHITECTURE.md` brief §33/§56 — "an explicit,
   * architecture-consistent claim, never guessed from ID format") — an
   * explicit, resource-server-checkable discriminator between a human
   * (Authorization Code) token and a machine (Client Credentials) token.
   *
   * DELIBERATELY OPTIONAL, and DELIBERATELY never set by
   * `ClientCredentialsService` (Phase 2D.4, unchanged by this phase) — its
   * absence means `SERVICE_ACCOUNT`, preserving 100% backward compatibility
   * with every Client Credentials token issued before this claim existed.
   * `AuthorizationCodeGrantService` (Phase 2D.7) always sets it explicitly
   * to `'USER'`.
   */
  principal_type?: 'USER' | 'SERVICE_ACCOUNT';
}

/** Input to ExternalTokenService.sign() — everything the caller supplies; iss/exp/iat/jti/aud are set by the signing service itself, never passed in directly (mirrors why AccessTokenClaims never lets a caller set iat/exp — see jsonwebtoken's own "Bad option" guard). */
export type ExternalTokenSignInput = Omit<ExternalTokenClaims, 'iss' | 'exp' | 'iat' | 'jti' | 'aud'>;
