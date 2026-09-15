# Phase 2B.2 — Product Entitlement

## Objective

Establish who is entitled to use a registered product — distinct from Membership (Phase 2A) and Authorization (Phase 1/2A) — as a durable, tenant-level, product-agnostic model. Not a billing implementation. See `docs/adr/ADR-011-product-entitlement-model.md`, `docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md`, `docs/PRODUCT_ENTITLEMENT_AUTHORIZATION.md`, `docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md` for the full design.

## What was implemented

- **Database**: `tenant_product_entitlement` (`database/ddl/007_tenant_product_entitlement.sql`) — tenant-scoped, ordinary `apply_tenant_rls`, `UNIQUE(tenant_id, product_id)`. Forward migration: `database/migrations/20260913180000_tenant_product_entitlement.sql`, verified both as a first run and an idempotent re-run against a simulated pre-2B.2 database.
- **Permissions**: `PRODUCT_ENTITLEMENT_VIEW`, `PRODUCT_ENTITLEMENT_MANAGE` — `platform_only`, same enforcement mechanism Phase 2B.1 built.
- **Services**: `ProductAccessService` (the single, central `canAccess(tenantId, productId)` deny-by-default decision point — Product-status precedence, no product-specific business logic); `TenantProductEntitlementsService` (lifecycle: create, generic status transition, dedicated reactivate).
- **APIs**:
  - `POST/GET/GET/PATCH /v1/platform/tenants/:tenantId/product-entitlements[/:productId]`, `POST .../reactivate` — Platform Operator only (`PlatformJwtAuthGuard`/`PlatformPermissionsGuard`, same pattern as Product/Application administration).
  - `GET /v1/product-entitlements` — tenant self-service read, ordinary tenant auth, RLS-scoped to the caller's own tenant, includes a computed `eligible` field.
- **Audit**: `PRODUCT_ENTITLEMENT_CREATED`/`_ACTIVATED`/`_SUSPENDED`/`_REVOKED`/`_REACTIVATED`, all `scope='PLATFORM'`, correctly attributed (no fake tenant attribution — the exact gap Phase 2B.1 fixed for Product/Application is not reintroduced here).
- **Tests**: `tests/phase2b2-product-entitlement.e2e-spec.ts` — 16 tests against the real database.

## A. Architecture

Tenant-level entitlement (`docs/adr/ADR-011-product-entitlement-model.md`), reusing every existing mechanism rather than inventing new ones: ordinary tenant RLS for the table, the Phase 2B.1 Platform Operator boundary for who administers it, and the `PrismaContextService.runInContext(fn, actingAsTenantId)` pattern (already used throughout this codebase since Phase 1) for how a Platform Operator — who has no ambient tenant context — safely operates on a specific tenant's RLS-protected rows without any RLS bypass.

## B. Entitlement Model

```text
tenant_product_entitlement: id, tenant_id, product_id, status (ACTIVE|SUSPENDED|REVOKED), audit fields, version
UNIQUE(tenant_id, product_id)
```
No row = no access, ever, by construction (deny-by-default). See `docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md` §4 for exact per-state semantics.

## C. Organization-Level Decision

**Deferred, not built** — every required multi-organization test scenario (`docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md` §8) resolves correctly through tenant-level entitlement plus the pre-existing Membership/authorization layers; no scenario in this phase's matrix demonstrates a need for two Organizations under one Tenant to see different product eligibility. A documented extension point exists (an optional `organization_id` column or override table) but was not designed further, per the brief's own instruction not to implement without a demonstrated requirement.

## D. Lifecycle

`ACTIVE ⇄ SUSPENDED`, `ACTIVE|SUSPENDED → REVOKED`, `REVOKED → ACTIVE` only via a dedicated `reactivate` action — never the generic status PATCH. No `PENDING` (nothing produces or consumes it). Full transition table and rationale: `docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md` §1–3.

## E. Access Evaluation

`ProductAccessService.canAccess(tenantId, productId)`: Product not found → deny; Product not `ACTIVE` → deny (regardless of entitlement); no entitlement row → deny; entitlement `SUSPENDED`/`REVOKED` → deny; entitlement `ACTIVE` (and Product `ACTIVE`) → allow. No caching in this phase — every check is live.

## F. Product Status Interaction

Product.status is checked **first** and **independently** — disabling a Product denies every tenant regardless of their own entitlement status, without mutating any entitlement row. Re-enabling restores eligibility only for tenants whose own entitlement was already valid. Verified directly (`docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md` §5).

## G. Authorization

`PRODUCT_ENTITLEMENT_VIEW`/`_MANAGE`, Platform Operator only. Full actor matrix: `docs/PRODUCT_ENTITLEMENT_AUTHORIZATION.md` §2 — every cell tested, none ambiguous.

## H. RLS

`tenant_product_entitlement` uses the same `apply_tenant_rls` mechanism as `Organization`/`Membership` — unmodified. A Platform Operator's cross-tenant administration works through an explicit, existence-checked, server-validated `actingAsTenantId` context per call, never `BYPASSRLS`. `identity_app` remains `NOBYPASSRLS` throughout.

## I. APIs

See "What was implemented" above; full contract in `docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md`/`docs/API_BOUNDARY.md` §7.

## J. Audit

Five event types, all `scope='PLATFORM'`, all `tenantId` genuinely `NULL` at the column level (the affected tenant is recorded in `metadata` instead) — actor is always the acting Platform Operator's own global Identity, never faked.

## K. Concurrency

Tested directly: (1) two concurrent entitlement creations for the same `(tenant, product)` — exactly one `201`, one `409`, one row in the database, no unhandled error; (2) concurrent SUSPEND vs. REVOKE — both commit orders converge on `REVOKED`, the stronger terminal state, achieved through the transition table's own shape (not a special case); (3) concurrent ACTIVE/SUSPENDED toggling — the row always ends in exactly one valid, non-corrupted state. No cross-row advisory locking was needed (unlike Phase 2B.1's last-operator invariant) — every invariant here reduces to a single-row guarded UPDATE or a plain `UNIQUE` constraint.

## L. Security

Positive: creation, audit, multi-product independence, multi-tenant independence, full lifecycle including reactivate, least-privilege (`_VIEW`-only can read but not write). Negative: anonymous denial, tenant-token rejection (401, not just 403 — same class of proof as Phase 2B.1), cross-tenant IDOR (wrong-tenant URL 404s rather than leaking another tenant's row), nonexistent tenant/product 404s, duplicate creation (both sequential and concurrent).

## M. Real-World Failure Scenarios

| # | Scenario | Result |
|---|---|---|
| 1 | Suspend while user "active" | Entitlement flips to SUSPENDED; next `canAccess()`/self-service read reflects it immediately (no cache to invalidate) |
| 2 | Revoke while a JWT is outstanding | Entitlement flips to REVOKED; same immediate effect — this phase has no product-boundary token check yet, so "the user's own product session" isn't directly gated here; the tenant-facing signal (`GET /v1/product-entitlements`) reflects REVOKED instantly |
| 3 | Product globally disabled | All tenants denied, verified directly |
| 4 | Product re-enabled | Only tenants with a still-valid entitlement regain eligibility, verified directly |
| 5 | Tenant loses entitlement | All organizations under it lose eligibility (no per-organization override exists) |
| 6 | User changes organization (Phase 2C) | `ProductAccessService` takes only `tenantId`/`productId` — ready for Phase 2C to call once it resolves the active tenant, no change needed here |
| 7 | Duplicate entitlement requests | No duplicate row, sequential and concurrent, tested |
| 8 | Concurrent activation/suspension | Deterministic final state, tested |
| 9 | DB failure mid-transition | Every write is a single guarded UPDATE or a single-row transaction-wrapped create; Postgres's own atomicity prevents half-written state |
| 10 | Audit failure | Audit write happens inside the same request path as the state mutation (not a fire-and-forget queue) — a failure there surfaces as a request failure, not a silent unaudited mutation |
| 11 | Product disabled while entitlement remains ACTIVE | No entitlement rows mutated — verified directly |
| 12 | Product deleted/deactivated with historical entitlements | No delete endpoint exists for Product (Phase 2B) or Entitlement (this phase) — historical rows are never at risk of being orphaned by a delete that doesn't exist |
| 13 | Platform Operator has no organization membership | Unchanged from Phase 2B.1 — administers entitlements without gaining tenant access |
| 14 | Tenant Admin owns all organizations | Still denied platform-scoped entitlement management — tested explicitly |
| 15 | Same global user belongs to two tenants | Entitlement outcome is per-tenant by construction (`tenant_id` is part of the row's own identity) |

## N. Migration

`database/migrations/20260913180000_tenant_product_entitlement.sql` — purely additive, verified as both a first run (against a simulated pre-2B.2 database) and an idempotent re-run. **Rollback**: `DROP TABLE tenant_product_entitlement;` (cascades to no other table — nothing references it) plus `DELETE FROM security_permission WHERE permission_code IN ('PRODUCT_ENTITLEMENT_VIEW', 'PRODUCT_ENTITLEMENT_MANAGE');`. No data-loss risk beyond the entitlement records themselves (dev-only data at this stage, per the standing project convention); no other table's data is touched by rollback.

## O. Tests

```text
Unit:        0 dedicated (policy/lifecycle logic is fully exercised through the e2e suite against the real database — consistent with every prior phase's approach in this codebase)
Integration: covered within e2e (RLS, transactions, uniqueness, audit, concurrency all exercised against the real database)
E2E:         16/16 PASS (tests/phase2b2-product-entitlement.e2e-spec.ts)
Security:    covered within the e2e suite above
Concurrency: 2 dedicated tests (duplicate-create race, SUSPEND-vs-REVOKE race) + 1 (ACTIVE/SUSPENDED toggle race) — all PASS
Migration:   PASS (first run + idempotent re-run, against a simulated pre-2B.2 state)
Build:       PASS
Typecheck:   PASS
Prisma:      PASS
Full regression: 58/58 e2e (all five suites) + 3/3 unit, from a clean bootstrap
```

## P. Files Changed

New: `database/ddl/007_tenant_product_entitlement.sql`, `database/migrations/20260913180000_tenant_product_entitlement.sql`, `database/prisma/schema/tenant-product-entitlement.prisma`, `src/modules/product-entitlements/**` (repository, 2 services, 2 controllers, DTOs, module), `tests/phase2b2-product-entitlement.e2e-spec.ts`, 5 new docs incl. ADR-011. Modified: `database/seeds/001_permissions.sql`, `database/prisma/schema/{tenant,product}.prisma` (back-relations), `src/modules/products/products.module.ts` (export `ProductsRepository`), `src/app.module.ts`.

## Q. TravelOS

```text
TravelOS files changed: 0
TravelOS dependencies added: 0
TravelOS DB changed: 0
TravelOS migrations changed: 0
```

## R. Known Issues

- **Blocking**: none.
- **Medium**: `AllExceptionsFilter`'s existing `P2002 → 409` mapping is still not globally wired anywhere in this codebase (a pre-existing gap, first noted in Phase 2A) — this phase's own duplicate-creation race is handled by a local, explicit catch in `TenantProductEntitlementsService.create()`, not by that filter. Any *future* endpoint with the same race-on-unique-constraint shape will need the same local treatment until the filter is actually wired up.
- **Medium**: `TenantsController` (`/v1/tenants`) still gates on the old tenant-scoped `TENANT_MANAGE` permission (never migrated to Platform Operator auth in Phase 2B.1) — and `TENANT_MANAGE` is granted to no seeded role at all, so that controller is currently unreachable by any caller in a fresh bootstrap. Not touched in this phase (out of scope — entitlement doesn't depend on how Tenant CRUD is gated, only on Tenants existing) but flagged prominently since it sits directly adjacent to what this phase builds.
- **Low**: No caching layer exists or is needed yet — every entitlement check is a live database read.
- **Low**: No per-product API-boundary callback exists yet for `ProductAccessService` to be called from outside this platform (e.g., by TravelOS's own backend) — it's ready to be wired into one once `aud`-checked tokens or a service-to-service credential exist (Phase 2E+).

## S. Deferred Work (explicitly confirmed)

Organization Context Switching, OAuth2, OIDC, SAML, MFA, Passkeys, Service Authentication, Billing, Subscriptions, Usage Metering, SDKs — all untouched.
