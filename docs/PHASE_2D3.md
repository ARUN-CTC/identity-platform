# Phase 2D.3 — ServiceAccount & Tenant Grant Foundation

## Objective

Establish the machine-identity model (`ServiceAccount`) and the explicit, per-tenant authorization record (`ServiceAccountTenantGrant`) that a future OAuth Client Credentials flow will depend on — without implementing any token issuance. See `docs/PHASE_2D_ARCHITECTURE.md`, `docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md`, `docs/adr/ADR-018-application-trust-client-types.md` (as amended, Gate 1's reaffirmation of ServiceAccount as a separate entity).

The chain this phase builds:

```text
Application 1───N ServiceAccount
ServiceAccount → ServiceAccountTenantGrant → Tenant
Tenant → TenantProductEntitlement → Product (reused, unchanged)
```

Non-negotiable invariant carried through every design decision below: **a valid Application/client credential MUST NEVER, by itself, establish tenant authorization.**

## What was implemented

- **Schema (additive)**: two new tables — `database/ddl/009_service_account.sql` (fresh-bootstrap shape) + `database/migrations/20260913240000_service_account_tenant_grant.sql` (upgrade path). Verified against a simulated pre-2D.3 state (scratch database, `009_service_account.sql` and the four new permission rows both temporarily removed, migration re-applied, re-applied again to confirm idempotency) and against the live dev database via a fresh reset.
  - `service_account` — platform-level, **no RLS**, no `tenant_id` column at all: `id` (UUID PK, the future external-token `sub`), `application_id` (FK, `ON DELETE CASCADE`, immutable after creation), `name`, `status` (`ACTIVE`/`SUSPENDED`/`DISABLED`), `credential_hash` (never the plaintext), `credential_created_at`/`credential_revoked_at`, standard audit columns. `UNIQUE(application_id, name)`.
  - `service_account_tenant_grant` — tenant-scoped, **ordinary `apply_tenant_rls`** (same mechanism as `Membership`/`Organization`/`TenantProductEntitlement`): `tenant_id`, `service_account_id` (FK, `ON DELETE CASCADE`), `status` (`ACTIVE`/`SUSPENDED`/`REVOKED`), standard audit columns. **No `organization_id` column** — a service identity never inherits organization/human context. `UNIQUE(service_account_id, tenant_id)` — the actual concurrency guarantee, not merely an application-level pre-check.
- **Module** (`src/modules/service-accounts/`): DTOs, two repositories, two services, three controllers, wired into `ServiceAccountsModule` and registered in `AppModule`.
  - `ServiceAccountsRepository` — no RLS context; `update()` names every written field explicitly (`name`, `status` only — no `applicationId`), the same repository-layer discipline Phase 2D.2's own security fix established for `ApplicationsRepository`, applied here proactively from the first line of code rather than discovered as a defect later.
  - `ServiceAccountTenantGrantsRepository` — every method takes `tenantId` explicitly from the request path and passes it to `PrismaContextService.runInContext()` as the RLS acting-tenant context (never inferred from an ambient tenant a Platform Operator does not have). `transition()` is the same state-machine-guarded conditional `UPDATE ... WHERE status IN (fromStatuses)` pattern as `TenantProductEntitlementsRepository.transition()` (Phase 2B.2).
  - `ServiceAccountsService.create()` always generates a credential via the existing `generateClientSecret()`/`hashClientSecret()` utilities (`src/common/utils/client-credential.util.ts`) — the same SHA-256-over-256-bit-random scheme Application's own `client_secret` uses, but a structurally distinct secret value, never derived from or shared with any Application's own client secret. The plaintext is returned exactly once, at creation (`CreatedServiceAccount`), and never again — `findOne`/`update`/`list` all strip `credentialHash` via a private `sanitize()`.
  - `ServiceAccountTenantGrantsService` is the direct structural twin of `TenantProductEntitlementsService`: an `ALLOWED_FROM_STATUSES` table drives the generic status `PATCH` (REVOKED → ACTIVE is deliberately excluded from it), and a dedicated `reactivate()` method is the only path out of REVOKED. `isGrantActive(tenantId, serviceAccountId)` is the narrow future Client-Credentials-pipeline integration point — a live read of exactly one question ("is there an ACTIVE grant for this exact pair, right now"), never a composed eligibility facade (that composition, which would also need Application/Product status, belongs to whichever future phase actually builds `/token`).
  - Controllers: `ApplicationServiceAccountsController` (`/applications/:applicationId/service-accounts`, list+create), `ServiceAccountsController` (`/service-accounts/:id`, get+update), `ServiceAccountTenantGrantsController` (`/platform/tenants/:tenantId/service-account-grants`, the tenant-first nested shape — create/list/get/patch/reactivate, structurally identical to `TenantEntitlementsController`). All three gated by `PlatformJwtAuthGuard` + `PlatformPermissionsGuard`; a tenant-scoped token is rejected outright (401), never merely denied a permission.
- **Permissions** (new, `platform_only = TRUE`, same class as every other platform-administration permission): `SERVICE_ACCOUNT_VIEW`, `SERVICE_ACCOUNT_MANAGE`, `SERVICE_ACCOUNT_TENANT_GRANT_VIEW`, `SERVICE_ACCOUNT_TENANT_GRANT_MANAGE` — added to both the migration and `database/seeds/001_permissions.sql` (fresh bootstraps).
- **Security fix** (found during this phase's own concurrency testing, applied proactively rather than left as a gap): `ServiceAccountsService.create()` initially had no local `P2002` catch, so a duplicate `(applicationId, name)` race surfaced as an unhandled 500 instead of a clean 409 — inconsistent with the discipline already established for `TenantProductEntitlementsService.create()` and this phase's own `ServiceAccountTenantGrantsService.create()`. Fixed by adding the same local `P2002` → `ResourceConflictException` catch; verified a concurrent duplicate-name race now resolves to exactly one `201` and one `409`, with exactly one row persisted.
- **Tests**: 106/106 unit tests unchanged (no new unit spec file — `ServiceAccount*Service` follow the CRUD/state-machine pattern already established in this codebase as e2e-covered only, the same convention `TenantProductEntitlementsService` itself follows with zero unit spec of its own) + 20 new e2e tests (`tests/phase2d3-service-account-tenant-grant.e2e-spec.ts`), additive to the existing suites.

## Deliberate scope decision: no cross-tenant "list all grants for a ServiceAccount" endpoint

The brief's own proposed API surface suggested a convenience endpoint such as `GET /v1/service-accounts/:id/tenant-grants` (all tenants a given ServiceAccount is authorized for, in one call). This was deliberately **not built**.

Reasoning: the brief's own steer (RLS/data-ownership guidance — "RLS is isolation, not authorization... do not rely on RLS as the authorization decision for cross-tenant listing; use explicit authorization + validated target tenant + `runInContext`") argues against inventing a new cross-tenant RLS mechanism for this table. Phase 2C's own `Membership` cross-tenant self-visibility relaxation (`OR user_id = current_user_id()`) solves a fundamentally different problem — human self-discovery from a not-yet-tenant-scoped starting point — not Platform Operator administration, where the caller already always knows which tenant it's asking about.

Instead, `ServiceAccountTenantGrant` administration is **entirely tenant-first nested** (`/platform/tenants/:tenantId/service-account-grants`), exactly mirroring `TenantProductEntitlement`'s own proven shape. Every operation always carries an explicit, already-known, existence-checked `tenantId`, which is precisely why this table can use ordinary tenant RLS at all (the same deciding factor established in Phase 2B.2/2C for every other RLS-vs-no-RLS decision in this codebase: RLS is used when every caller — including a Platform Operator — always operates with an explicit tenantId from the URL path, never because of self-service tenant reads). A genuinely cross-tenant "all grants for this ServiceAccount" view is left to a future phase, if and when an actual administrative need for it is stated — not built speculatively now.

## ServiceAccount Identity & Credentials

- `id` (a `generate_uuid()` primary key) is the ServiceAccount's own globally-unique, non-secret, high-entropy, never-reused public identifier — explicitly the value the brief itself names as the future external-token `sub`. No separate opaque identifier field (analogous to Application's `clientId`) was added; one already satisfies every stated requirement, and adding a second would be a duplicate-identifier column with no purpose (the brief's own Simplification Rule).
- The credential is generated and hashed with the exact same utilities Application's own `client_secret` uses (`generateClientSecret`/`hashClientSecret`) — deliberately the same hashing function, but a completely distinct secret value from any Application's own secret; the two are never combined, derived from one another, or interchangeable.
- The plaintext credential is shown exactly once, at creation. Every subsequent read (`GET`, `LIST`) and every audit event strips it — verified directly against both the HTTP response body and the raw database row.
- `applicationId` is immutable: `UpdateServiceAccountDto` has no such field, and `ServiceAccountsRepository.update()` never spreads the raw DTO — verified by sending `applicationId` in a PATCH body and confirming the stored value never changes.

## ServiceAccount Lifecycle

`ACTIVE ⇄ SUSPENDED`, `→ DISABLED` (all via the generic status `PATCH`, same shape as Application's own lifecycle). Disabling/suspending a ServiceAccount never deletes the row, its `id`, its `credentialHash`, or mutates any of its tenant grants — verified directly (a grant remains `ACTIVE` in the database even while its owning ServiceAccount is `DISABLED`; eligibility composition at request time, not grant mutation, is how a future pipeline would deny access in that case — Phase 2D.3 does not build that composition).

## ServiceAccountTenantGrant Lifecycle & Uniqueness

`ACTIVE ⇄ SUSPENDED`, `REVOKED` reachable from either, and `REVOKED → ACTIVE` reachable **only** via the dedicated `POST .../reactivate` endpoint — the generic `PATCH` cannot bypass this (verified: a `PATCH {status: ACTIVE}` against a REVOKED grant returns 409). `UNIQUE(service_account_id, tenant_id)` is the actual duplicate-prevention guarantee, backed by a local `P2002` catch for the common non-racing case and by the constraint itself for the racing case (verified: two concurrent creates against the same pair resolve to exactly one 201 and one 409, with exactly one row persisted). A concurrent `SUSPEND` vs `REVOKE` race converges deterministically on `REVOKED` — the stronger terminal state — regardless of commit order, the same mechanism `TenantProductEntitlementsRepository.transition()` already relies on.

The same ServiceAccount can independently hold grants for multiple tenants; revoking one tenant's grant leaves every other tenant's grant completely unaffected — verified directly, the concrete demonstration that a valid credential never implies "all tenants."

## Product Entitlement Independence

Creating, suspending, or revoking a `ServiceAccountTenantGrant` creates or mutates **no** `TenantProductEntitlement` row — verified directly by counting entitlement rows before and after. The two tables answer two independent questions ("may this ServiceAccount act for this Tenant at all" vs. "may this Tenant use this Product") and no code path in this phase derives one from the other or duplicates the other's logic.

## Organization Boundary

No `service_account_tenant_grant` row carries an `organization_id` — the column does not exist on the table at all. A ServiceAccount's `id` is never a `security_user` id, and a ServiceAccount is not, and does not gain, any `Membership` — verified directly.

## Authorization

Unchanged Platform Operator boundary (`PlatformJwtAuthGuard`/`PlatformPermissionsGuard`), gated by the four new permissions. A tenant-scoped token is rejected outright (401) for every ServiceAccount and grant-management operation — verified for both surfaces independently, not merely inherited from an earlier phase's tests. IDOR: a nonexistent Application/Tenant/ServiceAccount all 404 before any grant operation runs; a grant scoped to Tenant A is both invisible (404 on GET) and unmodifiable (404 on PATCH) through Tenant B's own URL, since the RLS acting-tenant context for every call is the tenantId taken from the request path, never trusted from anywhere else. Listing ServiceAccounts under one Application never leaks another Application's own ServiceAccounts (verified directly against the response body).

## Database

```text
Database changes: 2 new tables (service_account — no RLS; service_account_tenant_grant — ordinary tenant RLS), 4 new platform_only permissions
Migration: PASS (simulated pre-2D.3 state: scratch database, ddl/009 + the 4 seed permission rows temporarily removed, migration applied cleanly, re-applied a second time with zero errors and zero duplicate rows — full idempotency confirmed) + PASS (fresh clean bootstrap via reset-db.sh)
RLS changes: 1 new RLS-enabled table (service_account_tenant_grant, apply_tenant_rls, FORCE ROW LEVEL SECURITY, verified via pg_policies/pg_class) — service_account remains platform-level, no RLS, by design (see rationale in database/ddl/009_service_account.sql)
```

## Tests

```text
Unit:     106/106 PASS (unchanged — no new unit-testable pure logic introduced this phase; the CRUD/state-machine services are e2e-covered only, the established convention for this class of service in this codebase)
E2E:      144/144 PASS (124 pre-existing + 20 new, tests/phase2d3-service-account-tenant-grant.e2e-spec.ts)
Security: covered within the e2e suite above — credential secrecy, ownership immutability, cross-tenant isolation, cross-application isolation, deny-by-default, authorization matrix (Platform Operator ALLOW / tenant token REJECT), full concurrency matrix
```

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    PASS (client regenerated after schema changes)
```

## TravelOS Isolation

```text
Files: 0
Dependencies: 0
DB: 0
Migrations: 0
Git history: 0
```

## Deferred Scope (explicitly confirmed NOT implemented)

Client Credentials token issuance, `/token`, Authorization Code flow, PKCE, OIDC, service token issuance/verification, Token Exchange, Impersonation, MFA, Passkeys, SAML, SCIM, social login, dynamic client registration, device authorization grant, developer portal, SDK, API marketplace, billing, subscriptions, metering, the cross-tenant "list all grants for a ServiceAccount" convenience endpoint (see dedicated section above), and any actual composition of Application-status + ServiceAccount-status + ServiceAccountTenantGrant-status + TenantProductEntitlement-status into one eligibility decision (that composition belongs to whichever future phase actually builds the token-issuance pipeline).

## Known Issues

- **Low**: no automatic credential rotation/expiry — a new credential requires disabling the old ServiceAccount and creating a new one, the same manual-operator-action posture Application's own `client_secret` already has.
- **Low**: `ServiceAccountTenantGrantsService.isGrantActive()` has no HTTP endpoint calling it yet — by design, exercised only by its own tests until a future `/token` pipeline exists to call it.
- **Low**: the e2e test harness (`Test.createTestingModule`) still does not register `main.ts`'s global `ValidationPipe` — a repo-wide, pre-existing gap (documented in every prior phase's own report), not introduced or worsened by this phase.
- **Low**: the global `AllExceptionsFilter`'s `P2002` mapping remains unwired anywhere in this codebase (a separate, pre-existing, already-documented gap) — both new services in this phase carry their own local `P2002` catch, so neither is affected by it.

## Final Decision

```text
PHASE 2D.3 PASS — READY FOR PHASE 2D.4
```
