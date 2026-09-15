# Phase 2D.6 — Product Resource Authorization Contract & Integration Boundary

## Objective

Establish the reusable, product-neutral contract between Phase 2D.5's `AuthenticatedExternalPrincipal`/`ResourceAuthorizationContext` and a Product Resource Server's own authorization decision — without Identity Platform becoming a central authorization engine for any product. See `docs/RESOURCE_AUTHORIZATION_CONTRACT.md` for the full design.

## What was implemented

New `src/modules/resource-server/authorization/` subtree:

- **`AuthorizationDecision`** (`interfaces/authorization-decision.interface.ts`) — `{allowed, reasonCode?, requiredScope?, requiredPermission?}`, checked with `=== true`, never truthy-coerced.
- **`ResourceAuthorizationRequest`** (`interfaces/resource-authorization-request.interface.ts`) — `{productId, resource, action, requiredScopes?, requiredPermissions?}`, every field opaque to the Identity Platform.
- **`ResourceAuthorizationPolicy`** (`interfaces/resource-authorization-policy.interface.ts`) — the one seam a product implements; Identity Platform ships zero implementations of it for any real product.
- **`ResourceAuthorizationPolicyRegistry`** (`services/`) — a plain `Map<productId, policy>`, no global mutable state, last-registration-wins.
- **`@RequireResourceAuthorization({productId, resource, action, requiredScopes?, requiredPermissions?})`** (`decorators/`) — product-neutral route metadata.
- **`ResourceAuthorizationGuard`** (`guards/`) — the SECOND guard, structurally separate from `ExternalBearerAuthGuard` (Phase 2D.5): confirms a principal exists, enforces Layer 5 (OAuth scope) directly and generically, then delegates Layers 6-7 entirely to the registry-resolved policy. Every ambiguous/missing/erroring path fails closed (403 `forbidden`, or 401 if no principal at all, or 500 for a genuine route-configuration mistake).
- **Extended scope evaluator** (`utils/require-scope.util.ts`) — added `hasScope()`, `requireScopes()` (explicit AND), `requireAnyScope()` (explicit OR, deliberately separate), alongside Phase 2D.5's existing `requireScope()` (unchanged signature/behavior).
- **`ResourceAuthorizationContext`** (Phase 2D.5, extended) — added a top-level `jti` field (mirrors `principal.jti`), matching this phase's own suggested shape; no duplicate/parallel identity representation introduced.
- **Three new demo routes** on `ResourceServerDemoController` (`authorized/product-a`, `authorized/product-b`, `authorized/unregistered`) — test/support only, demonstrating the full pipeline against two independently-registered fake "products," with policy implementations authored entirely inside the e2e test file itself (never shipped in `src/`).
- **Tests**: 27 new unit tests (scope evaluator, `ResourceAuthorizationGuard`) + 18 new e2e tests (`tests/phase2d6-resource-authorization.e2e-spec.ts`).

## A genuine architectural finding, documented transparently

While building the entitlement-independence test matrix, discovered that Phase 2D.4's own `POST /oauth/token` issuance **already** requires `ProductAccessService.canAccess(tenantId, application.productId)` to pass before a token is issued at all — so a token can never be successfully issued for a tenant lacking entitlement to the Application's own tied Product. Testing "issued token + later-discovered-to-lack-entitlement" therefore required a **second**, issuance-independent Product (`productId2`, never referenced by any Application) for the demo policy's own Layer-4 check to exercise meaningfully. This is not a defect — it is the expected consequence of Phase 2D.4's own design (resolving Product from the calling Application) — and is documented in `docs/RESOURCE_AUTHORIZATION_CONTRACT.md` §6 rather than silently worked around.

## Security Results (brief §32 matrix)

All scenarios pass: valid token + audience + scope + entitlement + IAM = 200; missing scope = 403 (before the policy is ever consulted); wrong audience = 401 (unchanged, Layer 2); tenant header mismatch = 403 (never silently switched); product not entitled = 403; IAM permission denied/granted = 403/200; missing policy = 403 `forbidden`; provider error = 403 `forbidden` (message never leaked); unknown resource/unknown action = 403 (product's own policy decision); ServiceAccount-as-User / ServiceAccount-as-Application = both structurally impossible, verified directly; Platform Operator bypass attempt = 401 (rejected at Layer 1, never reaches authorization); provider isolation = verified with a call-order spy; concurrent tenant requests = isolated (16 concurrent requests, zero contamination).

## Tests

```text
Unit:        190/190 PASS (163 pre-existing + 27 new)
E2E:         217/217 PASS (200 pre-existing + 18 new, tests/phase2d6-resource-authorization.e2e-spec.ts)
Security:    embedded in the E2E count above (the "Full pipeline"/"Product Entitlement"/"Fail-closed behavior"/"Architecture invariants" describe blocks, 16 tests)
Concurrency: embedded in the E2E count above (1 dedicated test, 16 concurrent requests)
```

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    N/A — no schema change
Migration: N/A — no schema change
```

## Database

```text
Tables: 0 new   Columns: 0 new   Indexes: 0 new   Constraints: 0 new   RLS: 0 changes   Migrations: none
```

No authorization/policy/product-permission table was added — `ResourceAuthorizationPolicyRegistry` is an in-memory map, populated at runtime by whichever process registers into it (this repo's own e2e suite, for testing; a real product's own bootstrap code, in a real deployment).

## Regression

Phases 2A / 2B / 2B.1 / 2B.2 / 2C / 2C-stabilization / 2D.1 / 2D.2 / 2D.3 / 2D.4 / 2D.5 all still green, unedited.

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0 (no commit made)
```

## Deferred Scope (explicitly confirmed NOT implemented)

Authorization Code, PKCE, OIDC, `/userinfo`, MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization, Token Exchange, Impersonation, token forwarding, introspection as a normal request path, SDKs, any TravelOS integration, and — the central acceptance criterion of this phase — any product-specific IAM/permission/resource/action implementation (no `BOOKING_*`/`PATIENT_*`/`MEMBER_*`-style code exists anywhere in this codebase).

## Known Issues

- **Low**: no product has actually registered a `ResourceAuthorizationPolicy` in a real deployment yet (by design — none should, until a real product exists to do so); the only registrations in this codebase are test-authored.
- **Low**: same pre-existing gaps carried from Phase 2D.5 — no rate limiting on any resource-server route, no metrics backend wired (structured `Logger` lines only), per-request authorization denials are not written to the durable `SecurityEventsService` audit trail (same rationale as Phase 2D.5 §15: consistency with existing precedent, avoiding a log-flooding vector on a hot path).
- **Deferred**: revocation/entitlement-change visibility at the authorization layer remains TTL-bounded only (§8 of `docs/RESOURCE_AUTHORIZATION_CONTRACT.md`) — a product wanting fresher visibility must compose its own live check inside its own policy.

## Final Decision

```text
PHASE 2D.6 — PASS
```
