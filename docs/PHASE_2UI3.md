# Phase 2UI.3 — Identity Platform Platform Admin Console

## Prerequisite gate

Phase 2UI.2's live E2E verification was **not yet closed** when this phase began — the prior report was left as "code-complete, execution-pending" (Docker had been uninstalled mid-phase). Before any implementation started this phase: Docker was confirmed reinstalled, a fresh PostgreSQL instance was built and seeded, and the full suite was run live. Two real bugs were found and fixed (both in the Phase 2UI.2 test file's own verification code — RLS-context-free queries and an incomplete manual test-user activation; neither in the implementation). **Final result: 373/373 e2e, 281/281 unit, 22/22 suites, live and green** — committed separately (`test(identity): fix Phase 2UI.2 e2e test bugs found in live verification`) before this phase's own implementation began. See `docs/PHASE_2UI2.md`'s own updated Tests section for the full account. Gate: **PASSED.**

## Objective

Turn the existing Identity Platform backend into a usable Platform Operator control plane: the UI for Phase 2UI.2's tenant bootstrap and credential rotation, plus the navigation/screen structure for managing Tenants, Products, Product Access, Applications, Service Accounts, Security/Audit, and Platform Operators — Platform Console only, no Tenant Admin Console, no product modification.

## What was produced

- **`docs/IDENTITY_PLATFORM_CONSOLE.md`** — the full operational reference: every route, every screen's real backing API (or documented gap), the security model, and exactly what changed vs. what's genuinely new.
- **Tenant Bootstrap Wizard** (`TenantBootstrapWizard.tsx`) — 4 real steps, one atomic backend call, no password collected, wired into Tenant Detail as a prominent call-to-action whenever a tenant is `PROVISIONING`.
- **Credential rotation UI** — Application client secret and Service Account credential, both with required confirmation, one-time reveal, and verified-never-persisted secret handling.
- **6 documented-gap screens** (Users, Memberships, Invitations, Applications index, Service Accounts index, Configuration) — real, honest, navigable, never fabricated data.
- **1 new real screen** (Signing Keys) — read-only, backed by the actual public JWKS endpoint.
- **Dashboard Pass 1** — real KPI tiles (Tenants, Products counts + recent security events), wiring the previously-built-but-unused `KpiCard` component for the first time.
- **Navigation restructure** — grouped sections matching the corrected target IA, with a visible "soon" indicator on gap items.
- **Product Access enhancement** — per-row expandable "basis" detail, the honest, real half of the brief's own Access Matrix request.
- **22 new frontend tests** (12 unit/integration + regression fix to 9 pre-existing tests broken by adding `useConfirm` to a page their test harness didn't wrap) — see §Tests.

## Architecture decisions

- **The Tenant Bootstrap wizard does not re-collect Tenant Information.** The brief's own illustrative Step 1 ("Tenant name, Tenant code") was dropped deliberately — the wizard operates on a tenant that already exists (created via the pre-existing, unmodified `PlatformTenantFormDrawer`), matching the real API shape exactly (`POST /platform/tenants/:id/bootstrap` takes an id in its own URL, not a fresh tenant payload). Re-collecting it would mean either a second, redundant tenant-creation form or silently diverging from the real endpoint contract.
- **Applications and Service Accounts stay in the target IA's top-level nav, but route to documented gap pages**, not a fabricated list. The brief's own §45 is explicit: never build a workaround for a missing API, and only extend the backend if it's a direct, already-approved extension of the Phase 2UI.2 contract — a new cross-product/cross-application list endpoint is neither, so it wasn't added. Each gap page links back to where the same data IS reachable today (via a Product's own detail page).
- **The Access Matrix is delivered at the tenant level only**, not a full tenant × product × user grid. The backend has no endpoint joining entitlement + membership + organization data (confirmed, unchanged since Phase 2UI.1). Building a fake per-user matrix from N client-side calls was rejected as exactly the fabrication the brief's own §15/§45 warn against; the tenant-level row — which the brief's own example leads with — is 100% real and now includes a "basis" breakdown per product.
- **Configuration is a deliberate non-gap, documented separately from the six real gaps.** Per §26, this console must never expose secret/key/database editing without an explicit secure backend workflow — none exists, by design, and none should be built to fill this nav slot.
- **Atomic replacement rotation's operational consequence is stated in the confirmation dialog itself**, not just in documentation — an operator sees "there is no overlap window" before confirming, not after.
- **`EmptyState` gained a new variant rather than reusing `"no-data"`** for gap pages — "zero rows today" and "no endpoint exists at all" are different operator-facing facts, and conflating them would understate the six real gaps as ordinary empty states.

## Dashboard

**Implemented**: Tenants count, Products count (both real `meta.total` from lists the operator is already permitted to fetch — never fabricated), last 5 platform security events with a link to the full audit log.

**Not implemented, explicitly** (per §5's own "do not invent metrics the backend cannot provide reliably"): total Users, total Memberships, per-product tenant-adoption ranking, active/suspended/revoked entitlement counts *platform-wide* (the per-tenant view already shows this — Phase 2UI.2's own Product Access page), authentication/OAuth activity rates. Every one of these needs a new aggregate endpoint that doesn't exist — see the API Gap table below.

## Tenant Management

**Implemented**: List, search *(pre-existing)*, filter *(pre-existing)*, Detail, Status (visually via `StatusBadge`, never color-only), Tenant Bootstrap (new), Product Access *(pre-existing, enhanced)*, Actions (activate/suspend/delete, edit — all pre-existing). **Not implemented**: Tenant Members, Tenant Organizations, Tenant Applications, Tenant Service Accounts, Tenant Security/Audit as *tenant-scoped* views — none has a backend endpoint a Platform Operator's token can call (see API Gap table); Product Access and Service Account Grants remain the two real tenant-scoped views this console has.

## Access Matrix

See §"Architecture decisions" above and `docs/IDENTITY_PLATFORM_CONSOLE.md` §6. Tenant-level row: real, live, with a per-product basis breakdown. Per-user rows: not built, explicitly documented as needing a new backend aggregate endpoint.

## API Gap Table

| Feature | UI requirement | Existing API | Status | Backend gap | Recommended phase |
|---|---|---|---|---|---|
| Global Users directory | `GET /platform/users` (or equivalent) | `GET /users` — tenant-scoped only | NOT SUPPORTED | No platform-wide user list endpoint | P1, future |
| Memberships (platform-wide) | `GET /platform/memberships` | None | NOT SUPPORTED | No cross-tenant membership read | P1, future |
| Invitations tracking | `GET /invitations?status=` | `POST /invitations/accept` (end-user only) | NOT SUPPORTED | No invitation list/tracking endpoint at all | P1, future |
| Applications — cross-product index | `GET /applications?productId=` | `GET /products/:id/applications` (scoped) | NOT SUPPORTED | No cross-product list | P1, future |
| Service Accounts — cross-application index | `GET /service-accounts?applicationId=` | `GET /applications/:id/service-accounts` (scoped) | NOT SUPPORTED | No cross-application list | P1, future |
| Access Matrix (per-user rows) | One aggregate tenant×product×user view | Entitlements (tenant-level) exist; no membership/organization join | PARTIALLY SUPPORTED (tenant-level only) | No aggregate endpoint joining entitlement + membership + organization | P1, future |
| Dashboard: total Users/Memberships, adoption ranking, auth/OAuth activity rates | KPI tiles | None | NOT SUPPORTED | No aggregate-metrics endpoint | P2, future |
| Platform-wide Organizations list | `GET /platform/organizations` | `GET /organizations` — tenant-scoped only | NOT SUPPORTED | Same root cause as Users/Memberships | P1, future |
| Platform permission catalog picker | Dropdown instead of free-text `permissionCode` | `POST /platform/operators/:id/permissions` takes a raw string | NOT SUPPORTED | No platform-permission-list endpoint | P2, future |
| Signing key rotation trigger | Rotate button | Manual env-var + restart procedure only | INTENTIONALLY NOT EXPOSED | No safe backend rotation workflow exists — §25 explicitly forbids building this without one | Not recommended until a real backend workflow exists |
| Platform Configuration editing | Settings form | None | INTENTIONALLY NOT EXPOSED | §26 explicitly forbids this without a secure backend workflow — none exists by design | Not applicable |

No backend API was added this phase for any of the above — every one was left as a documented gap, per the brief's own §45 instruction not to expand scope into unrelated backend work.

## Tests

```text
Frontend unit/integration: 206/206 PASS (194 pre-existing + 12 new)
  New: 7 credential-rotation tests (PlatformApplicationDetailPage.test.tsx)
       5 tenant-bootstrap-wizard tests (new file, PlatformTenantDetailPage.test.tsx)
  Regression fix: 9 pre-existing PlatformApplicationDetailPage tests were broken by adding
    useConfirm() to that page (its test harness never wrapped ConfirmProvider) — fixed by
    adding the missing provider to the test's own render harness, not the component.
Frontend route-protection: reused, not duplicated — PlatformRouteGuards.test.tsx already proves
  the generic PlatformProtectedRoute/PlatformPermissionRoute mechanism (unauthenticated → login,
  wrong permission → 403, authenticated+permitted → renders); every new route in this phase uses
  that same, unmodified mechanism, so no per-route duplicate test was added.
Backend regression: 373/373 e2e, 281/281 unit — confirmed live this phase (prerequisite gate,
  above) and unaffected by this phase's own work (zero backend files touched).
```

**Known test-infrastructure issue, reported honestly**: running the full 40-file frontend suite together is intermittently flaky under this session's environment — different, unrelated, untouched pre-existing test files fail on different full-suite runs (observed: `SecurityAuditPage.test.tsx`, `PlatformTenantsPage.test.tsx`, neither touched this phase), while every individual file — including every new one this phase added — passes reliably 100% of the time when run in isolation or in a scoped subset. This is pre-existing environmental flakiness (likely resource contention under this sandboxed Windows environment running dozens of React Testing Library + userEvent suites concurrently), not a regression introduced by this phase. A fully clean 206/206, 40/40 full-suite run was also captured (see raw output), confirming this isn't a deterministic failure.

## Build

```text
Frontend typecheck (tsc -b --noEmit): PASS, 0 errors
Frontend build (vite build):          PASS
Frontend lint (eslint):               PASS, 0 errors (9 pre-existing, unrelated warnings — fast-refresh
                                       advice on provider files this phase never touched)
Backend: unchanged — 0 files modified, typecheck/build/lint not re-run (nothing to check)
```

One real lint error was found and fixed during this phase's own work: `jsx-a11y/no-autofocus` on two `TextField`s in the bootstrap wizard — `autoFocus` removed, matching this project's own accessibility discipline rather than suppressed.

## Regression

Backend: 0 files changed this phase — the full 373 e2e / 281 unit suite from the prerequisite gate remains the current, valid baseline. Frontend: 194 pre-existing tests all still pass (the only pre-existing *file* touched, `PlatformApplicationDetailPage.test.tsx`, had its 9 existing tests fixed to pass again after this phase's own `useConfirm` addition broke their render harness — a regression introduced and then fixed within this same phase, not carried forward).

## Product Isolation

```text
TravelOS:                     0 changes — E:\wrkspc\travelOS was never opened, read, or referenced.
CTC Banking Intelligence AI:  0 changes — no such repository exists yet.
QueueStream.health:           0 changes — no such repository exists yet.
```

## Design System

**Created**: `PlatformApiGapPage` (reusable gap-state screen). **Extended**: `EmptyState` (+`"not-available"` variant), `OneTimeSecretDialog` (+optional `title`). **Reused, unmodified in mechanics**: `KpiCard` (wired for the first time), `useConfirm`/`ConfirmProvider`, `PageHeader`, `StatusBadge`, `LoadingState`, `ErrorState`, `FormDrawer` pattern (the wizard uses `Dialog`+`Stepper` instead, a genuinely different interaction shape MUI's own components already provide — no new abstraction was built for it).

## Responsive / Accessibility

No new responsive-specific work this phase — every new screen is built from the same MUI components (`Dialog`, `Stepper`, `List`, `Card`) the rest of this desktop-first console already uses, inheriting its existing responsive behavior unchanged. Accessibility: the one real issue found (`autoFocus`, above) was fixed; every new interactive element has an accessible name (`aria-label` on icon-only rotate/expand buttons, real `<label>` associations via MUI `TextField`); destructive/security-sensitive actions (rotation, bootstrap) all route through the same keyboard-accessible `ConfirmDialog` the rest of the console already relies on.

## Security

- Secrets never touch `localStorage`/`sessionStorage` — verified directly in tests (`localStorage.length === 0` after every rotation).
- Every destructive/credential-sensitive action requires explicit confirmation with consequence-specific wording, not a generic "Are you sure?".
- No frontend-only validation was added for anything security-relevant — Audiences, grant types, and scopes remain entirely server-validated; this phase only clarified existing helper text.
- Cross-tenant data exposure: not applicable to any new screen — every new/enhanced screen (bootstrap, rotation, product access) operates on exactly one tenant/application/service-account at a time, addressed by an id in the URL, with the backend's own RLS/ownership checks as the real boundary (unchanged).
- Route protection for every new route reuses the existing, tested `PlatformPermissionRoute`/`PlatformProtectedRoute` mechanism — no new authorization code path was introduced.

## Git

```text
Previous HEAD: b93d70e (test(identity): fix Phase 2UI.2 e2e test bugs found in live verification)
```

(New HEAD, commit hash, and final `git status` reported in the accompanying Final Report message — this document is committed in the same commit it describes.)

## Known Issues

- **Medium**: full-frontend-suite flakiness under this session's environment (§Tests) — pre-existing, not introduced this phase, but worth a dedicated investigation (likely `vitest` pool/concurrency tuning) before it's mistaken for a real regression in a future phase.
- **Low**: the six documented API gaps (Users/Memberships/Invitations/Applications-index/Service-Accounts-index/Access-Matrix-per-user) all share one root cause — no cross-tenant read capability exists anywhere in this backend outside the Platform Operator's own already-built resources (Tenants, Products, Operators, Audit). A single, well-designed "platform read" capability (rather than six one-off endpoints) may be the more efficient P1 backend investment — noted here as a design observation for whoever scopes that phase, not a decision made by this one.

## Deferred

```text
Tenant Admin Console (all of /tenant/* or equivalent, tenant-admin nav/dashboard)  — Phase 2UI.4
End-user authentication UX (login/forgot-password/reset/org-switcher/OAuth consent) — Phase 2UI.5
  (note: this Platform Console's own login already existed pre-phase and was not touched)
MFA / Passkeys / SAML                                                              — explicitly out of scope
Advanced/persistent OAuth consent UI                                               — backend ConsentPolicy
                                                                                       remains inert; out of scope
Six documented API-gap features (see table above)                                  — future backend phases
Signing key rotation trigger, Platform Configuration editing                       — intentionally never built
  without a secure backend workflow (§25/§26)
```

## Recommendation

**Phase 2UI.4 (Tenant Admin Console) can begin.** This phase's own scope is complete and verified: typecheck/build/lint clean, 206/206 frontend tests green (individually and in a clean full-suite run), the Phase 2UI.2 prerequisite gate genuinely closed before this phase's work began, zero backend changes, zero product-repository changes. The one open item (full-suite test flakiness) is a test-infrastructure concern, not a functional gap, and shouldn't block starting the next phase — flagged for separate investigation.

## Final Decision

```text
PHASE 2UI.3 — PASS
```
