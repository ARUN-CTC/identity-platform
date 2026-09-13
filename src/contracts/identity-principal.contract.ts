/**
 * Phase 2D.10 (docs/IDENTITY_EXTERNAL_API_CONTRACT.md §Principal) — the
 * stable, product-facing NAME for the principal shape a validated
 * Identity-Platform-issued access token produces. This is a type ALIAS,
 * not a new type: `IdentityPrincipal` is exactly
 * `AuthenticatedExternalPrincipal` (Phase 2D.5/2D.7), re-exported under a
 * name that does not require a product author to know this platform's own
 * internal module layout (`resource-server/interfaces/...`).
 *
 * Deliberately NOT a rename — `AuthenticatedExternalPrincipal` remains the
 * type every internal call site (`ExternalAccessTokenValidator`,
 * `ResourceAuthorizationContext`, every 2D.5-2D.9 test) already uses and
 * will continue to use; renaming it would be a repository-wide, high-risk
 * change for zero behavioral benefit (the same "additive layer, not a
 * rename" discipline `OAuthReasonCodes` established in Phase 2D.9). This
 * file exists so a product-facing document, or a future extracted SDK
 * package, has ONE stable name to import that will never need to change
 * even if the internal module this aliases is later moved or split.
 */
export type { AuthenticatedExternalPrincipal as IdentityPrincipal, ExternalPrincipalType as IdentityPrincipalType } from '../modules/resource-server/interfaces';
