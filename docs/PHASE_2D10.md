# Phase 2D.10 — External Product Integration Contract & SDK Boundary

## Objective

Define and implement the stable, product-facing integration contract between the Identity Platform and future products (TravelOS, Healthcare, Gym), without redesigning any completed OAuth/OIDC/resource-server architecture. See `docs/PRODUCT_INTEGRATION_CONTRACT.md`, `docs/IDENTITY_EXTERNAL_API_CONTRACT.md`, and `docs/SDK_BOUNDARY.md` for the full design.

## What was implemented

- **`src/contracts/`** (new) — a stable, product-facing facade of TYPE ALIASES and re-exports over already-shipped, already-tested interfaces: `IdentityPrincipal`/`IdentityPrincipalType` (= `AuthenticatedExternalPrincipal`/`ExternalPrincipalType`, Phase 2D.5/2D.7), `IdentityAuthorizationContext`/`IdentityAuthorizationPolicy`/`IdentityAuthorizationRequest`/`IdentityAuthorizationResult` (= `ResourceAuthorizationContext`/`ResourceAuthorizationPolicy`/`ResourceAuthorizationRequest`/`AuthorizationDecision`, Phase 2D.6), `ProductEntitlementDecision`/`ProductEntitlementDenialReason` (= `ProductAccessDecision`/`ProductAccessDenialReason`, Phase 2B.2), and `IdentityBearerErrorCode`/`IdentityTokenEndpointErrorCode` (= `ResourceServerErrorCode`/`OAuthTokenErrorCode`). Zero renames of the underlying internal types, zero new business logic, zero new authorization decision.
- **`IDENTITY_BEARER_ERROR_HTTP_STATUS`** (new, `src/contracts/identity-error.contract.ts`) — the documented 401-vs-403 classification, guarded against drift from the internal (non-exported) status map by a new spec test (`identity-error.contract.spec.ts`).
- **Contract test** (new, `tests/phase2d10-product-integration-contract.e2e-spec.ts`) — a policy authored using ONLY the `src/contracts` facade (never a deep `resource-server/authorization` import), proving the facade alone is sufficient to plug into `ResourceAuthorizationGuard`'s real pipeline. Exercises the full chain (authentication → audience → scope → entitlement → product policy) plus two entitlement-state gaps Phase 2D.6's own suite did not cover: entitlement `REVOKED` and product `DISABLED`.
- **New demo route** (`resource-server-demo.controller.ts`) — `GET /resource-server/demo/authorized/contract-demo`, a THIRD demo product id (`DEMO_PRODUCT_CONTRACT`) dedicated to the new contract test, isolated from Phase 2D.6's own `DEMO_PRODUCT_A`/`DEMO_PRODUCT_B` registry entries.
- **Documentation**: `docs/PRODUCT_INTEGRATION_CONTRACT.md` (ownership split, the seven-layer pipeline restated as the brief's own step list, principal/tenant/entitlement/service-to-service/human-application/UserInfo contracts), `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` (the wire-level, language-agnostic contract — versioning rules, discovery, JWT claim shapes, audience contract, error contract), `docs/SDK_BOUNDARY.md` (what a FUTURE SDK must/must-never do — explicitly not built this phase).

## Architectural decision: no route renaming, no new HTTP namespace

Every route in this platform (`GET /oauth/authorize`, `POST /oauth/token`, `GET /oauth/userinfo`, etc.) is already served under the versioned `/api/v1/*` prefix (`app.setGlobalPrefix('api/v1', {...})`, `src/main.ts`, pre-existing since Phase 2). `.well-known/*` paths are, correctly, excluded from that prefix — moving them would break every conformant OIDC/JWKS client, not just this platform's own. The brief's suggested `/api/v1/identity/*` namespace was considered and deliberately NOT introduced: no new product-facing HTTP capability was found to be genuinely required by this phase's own scope (a contract/boundary phase, explicitly not a product-integration rollout) — inventing a new, empty namespace would have been speculative surface area, not a contract. This decision, and its reasoning, is documented in `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §1.

## Architectural decision: `src/contracts/` is a facade, not a package

TravelOS (and any future product) is, and remains, a separate repository — the absolute isolation rule forbids any filesystem/package dependency in either direction. `src/contracts/` therefore cannot be "imported by a product" today; it is the design source for a possible FUTURE, separately-published SDK package, and — today — a facade this repository's own contract test uses to prove the documented names are sufficient. This reasoning, and what a real SDK would additionally need (JWKS caching, cross-language error mapping, etc.), is fully documented in `docs/SDK_BOUNDARY.md`.

## Security Results

`AuthenticatedExternalPrincipal`'s existing field set was reviewed against the brief's minimum-conceptual-field list (§5) and found already complete — no new field needed. Direct source review confirmed `aud` is a single string at every token-signing call site (`ExternalTokenService.sign()`, `IdTokenService.sign()`) — no multi-value/wildcard audience token can originate from this platform's own issuance path; wildcard audience values are already rejected at request time (`client-credentials.service.ts`, Phase 2D.4, unchanged). The 401-vs-403 contract (`invalid_token` vs. `insufficient_scope`/`forbidden`) was re-verified against the real, running `ResourceServerAuthError` implementation via a dedicated drift-guard test, not merely asserted in documentation. The new contract test confirms entitlement `REVOKED` and product `DISABLED` both deny (403, generic `forbidden`, no enumeration) — two states Phase 2D.6's own suite had not exercised. Every existing OAuth/OIDC/Resource-Server/Client-Credentials/Resource-Authorization flow (Phase 2D.1-2D.9) continues to pass unmodified.

## Tests

```text
Unit:        256/256 PASS (251 pre-existing + 5 new: identity-error.contract.spec.ts) — clean full run, exit code 0
E2E:         318/318 PASS (311 pre-existing + 7 new: tests/phase2d10-product-integration-contract.e2e-spec.ts) — 17 suites, exit code 0
Contract:    tests/phase2d10-product-integration-contract.e2e-spec.ts (7 tests) + tests/phase2d6-resource-authorization.e2e-spec.ts (18 tests, unmodified, still passing) together prove the full pipeline against both the internal and the facade type names
Security:    embedded in the above (entitlement-state matrix, 401-vs-403 contract, no-enumeration assertions)
Concurrency: unchanged — Phase 2D.6's own 16-way concurrent test still passes unmodified
```

## Build

```text
Typecheck: PASS (tsc --noEmit, exit 0)
Build:     PASS (nest build, exit 0)
Prisma:    VALID (npx prisma validate); zero diff in database/prisma/schema/
Migration: N/A — no schema change
```

## Database

```text
DB changes: 0
Migration: none
```

No schema change — every contract type is a re-export over data this platform already persists (Phase 2B.2/2D.2/2D.3/2D.5/2D.6/2D.7/2D.8's own tables).

## Regression

Phases 2A / 2B / 2B.1 / 2B.2 / 2C / 2C-stabilization / 2D.1 / 2D.2 / 2D.3 / 2D.4 / 2D.5 / 2D.6 / 2D.7 / 2D.8 / 2D.9 all still green, unmodified except one additive constant + one additive route in `resource-server-demo.controller.ts` (Phase 2D.6's own three existing routes are byte-for-byte unchanged, confirmed by its own 18/18 unmodified suite still passing).

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0
```

## Known Issues

- **Low**: no live, product-callable, cross-process entitlement-check HTTP endpoint exists yet — a product must currently re-request a token to get a fresh eligibility check (documented as a FUTURE ARCHITECTURAL SEAM, `docs/PRODUCT_INTEGRATION_CONTRACT.md` §5/§9; not built, out of this phase's scope).
- **Low**: no SDK package is published — `src/contracts/` remains in-process only, per `docs/SDK_BOUNDARY.md`.
- **Deferred**: everything in the Deferred Scope list below.

## Deferred Scope

```text
MFA, Passkeys, SAML: deferred
Dynamic Client Registration, Device Authorization Grant: deferred
Token Exchange, Impersonation, token forwarding: deferred
Advanced consent management: deferred (unchanged inert seam, Phase 2D.9)
Pairwise subjects, ACR/AMR framework: deferred
Refresh-token redesign: deferred (unchanged from Phase 2D.7)
Billing, metering, organization-level product subscriptions: deferred
Product-specific IAM: deferred (0 product-specific code)
Full SDK implementations: deferred (docs/SDK_BOUNDARY.md)
TravelOS runtime integration: deferred (0 changes)
```

## Git

```text
Previous HEAD: c636f17 (chore(identity): harden OAuth and OIDC operations)
```

Commit created at the end of this phase containing only Phase 2D.10 files — see the final report for the exact SHA.

## Final Decision

```text
PHASE 2D.10 — PASS
```
