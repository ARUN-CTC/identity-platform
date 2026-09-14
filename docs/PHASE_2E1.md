# Phase 2E.1 — TravelOS Integration Architecture & Migration Plan

## Objective

Design the safe integration of TravelOS with the frozen Identity Platform V1 contract (`identity-platform-v1.0.0`). Architecture, discovery, and migration planning only — no TravelOS implementation, no Identity Platform runtime/schema change.

## What was produced

- **`docs/TRAVELOS_CURRENT_IDENTITY_INVENTORY.md`** — a source-verified inventory of TravelOS's actual authentication/user/tenant/organization/role/permission/JWT/session model, built entirely from direct inspection of `E:\wrkspc\travelOS\TravelPlatform\travelos` (read-only). Every claim cites the exact file/model it came from; anything not directly confirmed is explicitly marked UNKNOWN rather than assumed.
- **`docs/TRAVELOS_IDENTITY_MAPPING.md`** — entity-by-entity mapping (User, Tenant, Organization, Membership, Application, Entitlement, Roles/Permissions) with explicit cardinality, ID-preservation decisions, and a conflict-resolution strategy for TravelOS's per-tenant email uniqueness vs. Identity Platform's global email uniqueness.
- **`docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md`** — the target architecture, authentication-migration option comparison (A/B/C/D), resource-server integration design, audience/scope taxonomy, Application topology, and two documented Identity Platform V1 compatibility gaps (neither a blocker).
- **`docs/TRAVELOS_IDENTITY_MIGRATION_PLAN.md`** — a 14-phase migration sequence (input/output/owner/validation/rollback per phase), zero-downtime evaluation, a 20-row failure-scenario table, a data-quality checklist, and the conflict-resolution strategy for duplicate identities.
- **`docs/TRAVELOS_AUTH_CUTOVER_PLAN.md`** — the token-migration window mechanics, revocation posture, account-lifecycle ownership transition, audit-event split, and five validation checklists (migration/contract/security/reconciliation/cutover/rollback) for 2E.2+ to execute.
- **`docs/TRAVELOS_INTEGRATION_THREAT_MODEL.md`** — 20 integration-specific threats (T1-T20), every one classified MITIGATED/ACCEPTED/DEFERRED, none left unclassified.
- **`docs/adr/ADR-022-travelos-identity-integration.md`** — the formal decision record: Strangler/cohort migration (Option D), converging to an Identity-Platform-front-door end state (Option C).

## Key findings (all source-verified)

- TravelOS and Identity Platform share deep architectural lineage (near-identical `security_*` schema, identical RLS pattern/role posture, identical Argon2id password hashing, identical "never trust JWT for roles" RBAC discipline) — unsurprising, since Identity Platform's own Phase 1 was extracted from this exact codebase, but now directly confirmed rather than merely asserted.
- **The single largest reconciliation challenge**: TravelOS's `SecurityUser.email` is unique PER TENANT; Identity Platform's is unique GLOBALLY. A person with accounts in multiple TravelOS tenants today has multiple, independent TravelOS identities that must reconcile to ONE global Identity Platform identity plus multiple Memberships — a real N:1 reconciliation, not a straight copy, with an explicit conflict-resolution strategy for divergent password hashes.
- TravelOS has NO existing OAuth/OIDC implementation (the module is an empty stub) and NO existing ServiceAccount/Application-equivalent for incoming machine callers — the OAuth/OIDC integration is new wiring, not a replacement of a competing system.
- TravelOS is internally a three-product platform (`travel`/`healthcare`/`fitness`) with its OWN business-permission catalog already cleanly separated (by TravelOS's own existing convention) from identity-administration permissions — directly confirming, not merely assuming, the Phase 2D.6 ownership boundary applies cleanly.
- TravelOS's password hashing is directly compatible (same library call, same default parameters) — password migration can likely proceed without a forced reset, pending a verification spot-check.

## Architecture decisions

- **Selected migration strategy**: Strangler/cohort (Option D) — see ADR-022 for full rationale.
- **No Identity Platform V1 contract change** — every capability this integration needs already exists in the frozen v1 contract; two gaps (no `/revoke` endpoint, no live cross-process entitlement-check endpoint) are documented as accepted interim limitations with a safe existing behavior, not silently worked around.
- **No forced role/permission migration** — TravelOS's business permissions (`TRAVEL_*`, organization/document/bank-account management) remain permanently TravelOS-owned; only identity-administration-shaped permissions (`USER_MANAGE`, `TENANT_MANAGE`, etc.) are superseded by Identity Platform's own admin surface.

## Tests

This is an architecture-only phase — no automated test suite was written or executed (per brief §49: "do not implement integration tests against TravelOS yet"). Five validation-plan checklists were produced instead, for 2E.2+ to execute.

```text
Migration validation checklist:   produced (docs/TRAVELOS_AUTH_CUTOVER_PLAN.md §6)
Contract validation plan:         produced
Security test plan:               produced
Data reconciliation plan:         produced
Cutover validation plan:          produced
Rollback validation plan:         produced
```

## Database

```text
Identity Platform DB changes: 0
Identity Platform migrations: 0
TravelOS DB changes: 0
```

## TravelOS Verification

```text
Source changes: 0
Database changes: 0
Dependencies: 0
Configuration changes: 0
Git history: 0
```

Verified via `git -C E:\wrkspc\travelOS\TravelPlatform\travelos status --short` (empty) and `git -C ... rev-parse HEAD` (unchanged from the `4bec101d...` value recorded at the start of this phase's discovery).

## Known Issues

- **Medium**: TravelOS's own `failedLoginCount`/`lockedUntil` lockout state is not automatically synchronized to Identity Platform during the coexistence window (Threat T16) — requires an operational runbook, not a code fix, before 2E.4.
- **Medium**: a disabled/revoked TravelOS user is not automatically disabled in Identity Platform post-reconciliation (Migration plan §3, "Revoked user" scenario) — same class of coexistence-window process gap.
- **Low**: several data points remain UNKNOWN pending further investigation (exact `Tenant.status` value set, healthcare/fitness permission catalogs, whether any backend ServiceAccount need actually exists, real production audience-naming conventions) — each is explicitly scoped to a specific future phase, none blocks this phase's own architecture decision.

None of the above is Critical/High — no tenant-isolation, authentication-bypass, or cross-tenant-data-exposure defect was found in the proposed architecture.

## Deferred Scope

Everything in `docs/TRAVELOS_INTEGRATION_THREAT_MODEL.md`'s DEFERRED classification (implementation-verification items for 2E.7), plus all of 2E.2-2E.8 themselves:

```text
2E.2 TravelOS Integration Foundation
2E.3 Identity Data Migration
2E.4 Authentication Cutover
2E.5 Authorization Integration
2E.6 Legacy Auth Retirement
2E.7 Integration Security Validation
2E.8 Production Cutover
```

## Git

```text
Previous HEAD: 9929fa1 (chore(identity): freeze v1 API and security contract)
```

Commit created at the end of this phase containing only Phase 2E.1 documentation — see the final report for the exact SHA. `identity-platform-v1.0.0` is NOT amended or modified.

## Final Decision

```text
PHASE 2E.1 — PASS
```
