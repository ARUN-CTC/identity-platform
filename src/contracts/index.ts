/**
 * Phase 2D.10 — `src/contracts/` — the Identity Platform's STABLE,
 * PRODUCT-FACING integration contract (`docs/PRODUCT_INTEGRATION_CONTRACT.md`,
 * `docs/IDENTITY_EXTERNAL_API_CONTRACT.md`, `docs/SDK_BOUNDARY.md`).
 *
 * WHAT THIS IS: a single, small, explicitly-versioned barrel of TYPE
 * ALIASES and re-exports over interfaces this codebase already ships and
 * already tests (Phase 2D.5-2D.9) — `AuthenticatedExternalPrincipal`,
 * `ResourceAuthorizationContext`, `ResourceAuthorizationPolicy`,
 * `AuthorizationDecision`, `ProductAccessDecision`, and the
 * `ResourceServerErrorCode`/`OAuthTokenErrorCode` unions. It introduces NO
 * new business logic, NO new validation, and NO new authorization
 * decision — every behavior a product observes through this contract is
 * the SAME behavior `resource-server`/`oauth`/`product-entitlements`
 * already implement and this repository's own e2e suites already verify.
 *
 * WHAT THIS IS NOT:
 *   - NOT an importable package. `E:\wrkspc\identity-platform` and any
 *     product (TravelOS or otherwise) are, and remain, separate
 *     repositories with no filesystem or package dependency between them
 *     (the absolute isolation rule every phase in this project has
 *     followed). This module is the DESIGN SOURCE for what a future,
 *     genuinely separate `@identity-platform/contracts` package would
 *     publish — not that package itself.
 *   - NOT a language-specific SDK. A real product resource server may be
 *     written in any stack; the actual, portable contract it must
 *     implement is the wire-level one documented in
 *     `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` (JWT claim shapes, JWKS
 *     discovery, HTTP error codes) — this TypeScript module is a
 *     convenience for this repository's OWN in-process contract tests
 *     (`tests/phase2d10-product-integration-contract.e2e-spec.ts`) to
 *     prove those documented shapes against the real implementation, not
 *     a substitute for the documentation itself.
 *   - NOT a live, callable entitlement/authorization service. Every type
 *     here describes DATA SHAPES; the one export that is itself
 *     executable code (`toIdentityAuthorizationContext`) is a pure,
 *     already-existing conversion function with no I/O.
 *
 * Versioning: this contract is CONTRACT VERSION 1, coupled to Phase 2D.10.
 * See `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §Versioning for the
 * compatibility rules (additive vs. breaking changes) that govern how this
 * barrel — and the documented wire contract it mirrors — may change later.
 */
export * from './identity-principal.contract';
export * from './identity-authorization.contract';
export * from './identity-entitlement.contract';
export * from './identity-error.contract';
