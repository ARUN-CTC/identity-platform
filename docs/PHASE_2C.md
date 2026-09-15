# Phase 2C — Organization Context & Context Switching

## Objective

Let a global Identity (Phase 2A) select, switch, and clear which Organization — and therefore which Tenant — their session is currently operating within, with that selection driving RLS tenant context, organization role/permission resolution, and (in a future phase) product entitlement evaluation, while treating the selection as a server-validated fact, never client-supplied authorization. See `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md`, `docs/ORGANIZATION_CONTEXT_SECURITY.md`, `docs/ORGANIZATION_CONTEXT_API.md`, `docs/adr/ADR-012-organization-context.md` for the full design.

## What was implemented

- **Database**: one RLS policy change — `database/ddl/008_organization_context.sql` — a narrow, read-only relaxation of `membership`'s `USING` clause to also match the caller's own `current_user_id()`, enabling cross-tenant Membership discovery before any Tenant context exists. `WITH CHECK` (writes) unchanged. Forward migration `database/migrations/20260913200000_organization_context.sql`, verified both as a first run (against a simulated pre-2C database, reverted policy) and an idempotent re-run.
- **Token contract**: `AccessTokenClaims.organizationId?: string | null` — additive, optional (`src/modules/jwt/services/token.service.ts`).
- **Request context**: `AppClsStore`/`RequestContextService` carry `organizationId`; `JwtAuthGuard` populates it from the verified token's claim.
- **Authorization**: `PermissionsGuard` now resolves grants against `(tenantId, userId, context.organizationId)` — previously it never passed `organizationId` at all, so organization-scoped role grants were invisible to every permission-gated route. `UserRolesRepository.resolveGrants()` additionally re-validates `Organization.status === 'ACTIVE'` for the organization-scoped branch (previously only Membership status was checked).
- **Services**: `AuthenticationService.switchOrganizationContext()` (same-tenant in-place mutation, or cross-tenant revoke+new-session), `.clearOrganizationContext()`, `.listMyOrganizations()`, `.getMe()` extended with `organizationContext` and organization-aware grant resolution, `.refresh()` extended with live re-validation of a session's `organizationId`. `MembershipsService`/`MembershipsRepository` extended with cross-tenant discovery methods. `SessionsRepository.updateOrganization()`/`.create()` extended. `OrganizationsService`/`OrganizationsRepository.findByIdForTenant()` added.
- **APIs**: `POST /v1/auth/context/switch`, `POST /v1/auth/context/clear` (`AuthenticationController`); `GET /v1/me/organizations`, `GET /v1/me/context` (new `MeController`); `GET /auth/me` extended with `organizationContext`.
- **Audit**: `organization_context.switched` / `.cleared` / `.denied` / `.cleared_stale`, all correctly tenant-attributed (never faked).
- **Tests**: `tests/phase2c-organization-context.e2e-spec.ts` — 17 tests against the real database.

## A. Architecture

Session-level organization context (`SecuritySession.organizationId`, present since Phase 1), reflected into a short-lived access token on every switch/refresh — Option D from `docs/ORGANIZATION_CONTEXT.md`, now implemented with the one refinement that document's own §4a flagged as unresolved: cross-tenant switching. Full detail: `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md`.

## B. Context Source

The client supplies exactly one fact — a target `organizationId` — to `POST /v1/auth/context/switch`. Every other fact (which Tenant it belongs to, Membership validity, Organization/Tenant status) is resolved and re-validated entirely server-side, every time. No code path anywhere in this feature accepts a client-supplied `tenantId`.

## C. Session Strategy

Same-tenant switch: existing `SecuritySession` row mutated in place (`organizationId` only). Cross-tenant switch: old session revoked, new session created in the target Tenant's own RLS partition (`tenant_id`, the RLS partition key, is immutable per row). Clear: always same-tenant, mutates back to `null`. Every switch/clear reissues both tokens and revokes the prior refresh token.

## D. JWT Strategy

`AccessTokenClaims.organizationId` is additive and optional — a convenience/identity fact, never itself trusted as authorization (see Security doc §2 for the full "why"). A token minted before Phase 2C, or for a tenant-wide session, simply omits it.

## E. Membership

`MembershipsRepository.findByUserAndOrgAnyTenant(userId, organizationId)` and `.listActiveForUser(userId)` back cross-tenant discovery, relying on the RLS relaxation in §F below. Both take `userId` explicitly as a defense-in-depth WHERE-clause filter, redundant by construction with the RLS predicate itself (both trace back to the same authenticated caller).

## F. Tenant Derivation

Resolved from the discovered Membership row's own `tenantId` — never from client input, never assumed from the caller's current session. See `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md` §4 for the full chicken-and-egg problem and its resolution.

## G. RLS

One policy changed (`membership`, read-only relaxation, `WITH CHECK` untouched) — see `docs/adr/ADR-012-organization-context.md` for the full option analysis and rationale. No other table's RLS was touched. `identity_app` remains `NOBYPASSRLS` throughout; no `BYPASSRLS` grant was introduced anywhere.

## H. CLS / Request Context

`AppClsStore.organizationId` / `RequestContextService.organizationId` — populated exclusively by `JwtAuthGuard` from the verified token's own claim, per-request (the existing `nestjs-cls` AsyncLocalStorage model, unchanged in shape from every prior phase — a fresh store per HTTP request, structurally preventing cross-request leakage).

## I. Product Entitlement

Untouched. `ProductAccessService.canAccess(tenantId, productId)` (Phase 2B.2) already takes only `(tenantId, productId)` — ready for a future phase to call once it resolves the caller's active tenant from context. No organization-level entitlement was built this phase (not in scope — see "Deferred Work").

## J. Authorization

`PermissionsGuard` resolves against `(tenantId, userId, context.organizationId)` — the single structural authorization change this phase makes. `UserRolesRepository.resolveGrants()` additionally checks `Organization.status` live for the organization-scoped branch. Full precedence/resolution: `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md` §8.

## K. APIs

`POST /v1/auth/context/switch`, `POST /v1/auth/context/clear`, `GET /v1/me/organizations`, `GET /v1/me/context`, `GET /auth/me` (extended). Full contract: `docs/ORGANIZATION_CONTEXT_API.md`.

## L. Audit

`organization_context.switched` / `.cleared` / `.denied` / `.cleared_stale` — see `docs/ORGANIZATION_CONTEXT_SECURITY.md` §4 for the exact attribution table. Every write is awaited inline, never fire-and-forget.

## M. Concurrency

Tested directly: two concurrent switch requests on the same session, to two different organizations the caller genuinely belongs to, both resolve (`200`/`200`) without corrupting session state — the session lands on one of the two valid targets, never a mixed value (ordinary Postgres per-statement atomicity on the `UPDATE`; no advisory lock was needed, unlike Phase 2B.1's last-operator invariant, because there is no cross-row invariant here to protect — each switch is a single-row, self-contained write).

## N. Real-World Scenarios (as specified in the brief)

| # | Scenario | Result |
|---|---|---|
| 1 | Fresh login | No organization context; tenant-wide by default |
| 2 | Switch to an org the caller has ACTIVE membership in, same tenant | Succeeds; same session mutated; org-scoped grants apply |
| 3 | Switch to an org in a different tenant | Succeeds; old session revoked, new session in target tenant |
| 4 | Switch to an org with no membership at all | 403, audited as `.denied` |
| 5 | Switch to a nonexistent `organizationId` | 403, indistinguishable from #4 |
| 6 | Switch using an `INVITED` (not yet accepted) membership | 403 |
| 7 | Switch using a `SUSPENDED` membership | 403 |
| 8 | Switch to an `INACTIVE` organization, membership otherwise ACTIVE | 403 |
| 9 | Cross-tenant switch into a `SUSPENDED` tenant | 403 |
| 10 | Clear context | Returns to tenant-wide, same session, tokens reissued |
| 11 | Membership revoked mid-session (another admin action) | Caught on next refresh; `organizationId` cleared; `.cleared_stale` audited |
| 12 | Organization disabled mid-session | Same as #11 |
| 13 | Still-valid context across a refresh | Unchanged; carried forward |
| 14 | `GET /v1/me/organizations` | Lists only the caller's own ACTIVE memberships, across every tenant |
| 15 | `GET /v1/me/context` vs `GET /auth/me` | Consistent (`tenant`/`organizationContext` identical) |
| 16 | Old refresh token after a switch (same-tenant) | Invalid — revoked as part of the switch |
| 17 | Old refresh token after a switch (cross-tenant) | Invalid — the whole prior session is revoked |
| 18 | Two concurrent switches, same session, two valid targets | Both succeed; session lands on one valid value, never corrupted |
| 19 | An outsider attempts to leverage another user's membership | 403 — self-visibility RLS carve-out is scoped to the caller's own identity only |
| 20 | Denied switch attempt's effect on existing context | None — the session/context is left exactly as it was |
| 21 | Org-scoped role grant, before vs. after selecting that organization | Invisible before, visible (via `/auth/me` and `PermissionsGuard`) after |
| 22 | Tenant-wide grant, with an organization selected | Still applies — organization selection narrows what's *additionally* visible, never revokes tenant-wide grants |
| 23 | Multiple concurrent sessions for one Identity (browser/mobile/API client) | Independent — context lives per-`SecuritySession`, never on the global Identity |
| 24 | A token minted before Phase 2C (no `organizationId` claim at all) | Treated identically to `null` — no special-case handling needed |
| 25 | Switching back to the same organization already selected | Same-tenant path; harmless no-op mutation, still reissues tokens |

## O. Security

Full threat model: `docs/ORGANIZATION_CONTEXT_SECURITY.md`. Summary: the client supplies only `organizationId`; every other fact is server-derived and live-re-validated; the JWT's own `organizationId` claim is never trusted as authorization by itself; enumeration-resistant (identical 403 for every denial cause); every switch/clear/deny/stale-clear is audited.

## P. Migration

`database/migrations/20260913200000_organization_context.sql` — a single `DROP POLICY IF EXISTS` + `CREATE POLICY` on `membership`, no data change, no other table touched. Verified: (1) against a simulated pre-2C database (the policy manually reverted to its pre-2C form, the migration applied, the resulting policy confirmed correct via `pg_get_expr(polqual, ...)`), (2) idempotent re-run (applied a second time with no error, resulting policy unchanged), (3) a from-scratch `db:reset` bootstrap (`build-schema.sh` running `ddl/008_organization_context.sql` directly), independently verified. **Rollback**: re-run `CALL apply_tenant_rls('membership');` (restores the original, unrelaxed policy) — no data-loss risk; the relaxation is read-only in nature and no row's actual tenant/organization/user data is affected either way.

## Q. Tests

```text
Unit:        0 dedicated (consistent with every prior phase's approach — policy/lifecycle logic is fully exercised through the e2e suite against the real database)
Integration: covered within e2e (RLS carve-out, cross-tenant session issuance, refresh re-validation, all against the real database)
E2E:         17/17 PASS (tests/phase2c-organization-context.e2e-spec.ts)
Security:    covered within the e2e suite above (enumeration resistance, membership-status/org-status/tenant-status gating, RLS self-visibility isolation)
Concurrency: 1 dedicated test (two concurrent switches, same session) — PASS
Migration:   PASS (first run against a simulated pre-2C state + idempotent re-run)
Build:       PASS
Typecheck:   PASS
Prisma:      PASS
Full regression: 75/75 e2e (all six suites: health, 2A, 2B, 2B.1, 2B.2, 2C) + 3/3 unit, from a clean bootstrap
```

## R. Files Changed

New: `database/ddl/008_organization_context.sql`, `database/migrations/20260913200000_organization_context.sql`, `src/modules/authentication/controllers/me.controller.ts`, `src/modules/authentication/dto/switch-organization-context.dto.ts`, `src/modules/authentication/entities/my-organization.entity.ts`, `tests/phase2c-organization-context.e2e-spec.ts`, `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md`, `docs/ORGANIZATION_CONTEXT_SECURITY.md`, `docs/ORGANIZATION_CONTEXT_API.md`, `docs/adr/ADR-012-organization-context.md`, `docs/PHASE_2C.md`.

Modified: `src/modules/jwt/services/token.service.ts` (`organizationId` claim), `src/common/context/app-cls-store.ts`, `src/common/context/request-context.service.ts`, `src/modules/authentication/guards/jwt-auth.guard.ts`, `src/modules/authentication/guards/permissions.guard.ts`, `src/modules/authentication/services/authentication.service.ts`, `src/modules/authentication/controllers/authentication.controller.ts`, `src/modules/authentication/controllers/index.ts`, `src/modules/authentication/dto/index.ts`, `src/modules/authentication/entities/me.entity.ts`, `src/modules/authentication/entities/index.ts`, `src/modules/authentication/authentication.module.ts`, `src/modules/users/repositories/user-roles.repository.ts`, `src/modules/memberships/repositories/memberships.repository.ts`, `src/modules/memberships/services/memberships.service.ts`, `src/modules/organizations/repositories/organizations.repository.ts`, `src/modules/organizations/services/organizations.service.ts`, `src/modules/sessions/repositories/sessions.repository.ts`, `docs/ORGANIZATION_CONTEXT.md`, `docs/PHASE_2_IMPLEMENTATION_PLAN.md`.

## S. TravelOS

```text
TravelOS files changed: 0
TravelOS dependencies added: 0
TravelOS DB changed: 0
TravelOS migrations changed: 0
TravelOS Git history changed: 0
```

No TravelOS file was opened for writing at any point in this phase; TravelOS's own dev servers (backend/vite/nest-cli, observed running under separate PIDs during this phase's manual boot-testing on port 3000) were left untouched — the Identity Platform's own dev server was run on its own configured port (4000) and never interfered with TravelOS's processes.

## T. Known Issues

- **Blocking**: none.
- **Medium**: none newly introduced. `AllExceptionsFilter`'s `P2002 → 409` gap (first noted Phase 2A, still present Phase 2B.2) and `TenantsController`'s stale `TENANT_MANAGE` gating (noted Phase 2B.2) are both pre-existing and untouched by this phase — neither intersects organization-context switching.
- **Low**: No caching — every switch/refresh re-validation is a live database read, consistent with every prior phase's "no cache to invalidate" stance.
- **Low**: `GET /v1/me/organizations` has no pagination — acceptable at this phase's scale (one Identity's own membership count); flagged as a future concern only if an Identity legitimately accumulates a very large number of memberships.
- **Low**: `docs/PHASE_2_BASELINE.md` (a point-in-time snapshot document, per its own framing) was deliberately left unedited — item 2 in its "current gaps" list ("no organization-context switching implementation") describes the state *at the time that baseline was written*, consistent with how prior phases (2A/2B/2B.1/2B.2) also left it as a historical record rather than a living checklist.

## U. Deferred Work (explicitly confirmed)

`security_user.current_organization_id` (deliberately not built — see architecture doc §3 and ADR-012), organization-level Product Entitlements, product-specific business authorization, OAuth2, OIDC, SAML, MFA, Passkeys, Service Accounts, Client Credentials, SDKs, Billing, Subscription management, Usage metering, TravelOS integration — all untouched, per the brief's explicit scope boundary.

## V. Stabilization & Security Hardening (post-implementation audit)

An independent post-implementation review re-verified every claimed security property against the actual code, the live database's RLS policy (direct `psql` probes as `identity_app`, not just code reading), and 10 new targeted tests (`tests/phase2c-stabilization.e2e-spec.ts`) covering forged-JWT-claim resistance, cross-tenant/cross-organization grant isolation, CLS/async-context concurrency, and Platform Operator/Membership separation. Two genuine, non-blocking defects were found and fixed:

- **Audit-ordering defect** (`AuthenticationService.switchOrganizationContext()`/`.clearOrganizationContext()`): the `organization_context.switched`/`.cleared` success events were recorded *before* token issuance had fully completed — a failure in between (e.g. a DB error minting the new refresh token) could have left a false "success" audit record for an operation the caller never actually received working tokens for. Fixed by moving both audit writes to strictly after all mutation and token issuance succeed; `switchOrganizationContext()`'s cross-tenant branch now also attributes its event to the session it actually switched *into* (previously omitted for that branch), via a new internal `issueTokensWithSessionId()` helper (the public `AuthTokens` response shape is unchanged — the extra `sessionId` is never serialized to the client).
- **Stale organizationContext display** (`AuthenticationService.getMe()`): `organizationContext.organizationId`/`.organizationName` echoed the access token's claim unconditionally, even when the underlying Membership had been revoked or the Organization disabled — inconsistent with `roles`/`permissions`, which already correctly resolved to empty in that case. Fixed by applying the identical live Membership + Organization-status check to the display field itself; a stale claim now reports `{ organizationId: null, organizationName: null }`, indistinguishable from no context selected — never a capability, but a confusing/inconsistent read was possible before this fix.

Neither defect was an authorization bypass — every actual access-control decision already went exclusively through `resolveGrants()`'s own live re-validation. Full findings, evidence, and invariant-by-invariant verification are in the review's own final report (delivered to the user, not re-duplicated here). Regression after both fixes: 85/85 e2e (75 prior + 10 new) + 3/3 unit, typecheck/build clean.
