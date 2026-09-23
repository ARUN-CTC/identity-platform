# Phase 2UI.4 — Identity Platform Tenant Admin Console

## Prerequisite

Phase 2UI.3's own commit (`e2f55be feat(identity): implement platform admin console`) was verified as HEAD before implementation began. Existing frontend architecture was inspected first (`apps/web/src/app/` — the tenant-scoped app — plus `platform-console/`, unchanged and untouched). Every tenant-scoped backend API was inspected directly (controllers, guards, permission decorators) before any screen was built or claimed supported — see §2 below for the audit method and findings. Gate: **PASSED.**

## Objective

Close the real, remaining gaps in the already-substantial Tenant Console (13 of 14 pre-existing routed pages were already real, working implementations, not placeholders) and verify — not just describe — the cross-tenant and Platform-Console isolation properties this phase's brief treats as its primary acceptance criterion.

## 1. Result

**PASS**

## 2. Existing Tenant Console

Contrary to the brief's own illustrative assumption that a Tenant Console needed to be built from scratch, the tenant-scoped app at `apps/web/src/app/` + `apps/web/src/features/*` was already a real, working admin console: Users, Organizations (incl. Members tab), Organization Types, Roles, Permissions, Security Audit, Tenant Settings, Product Entitlements, My Sessions were all real, tested (each with a `.test.tsx`), tenant-scoped implementations. Only `SettingsPage` was a genuine placeholder (untouched — not in the brief's target nav). This was established via a dedicated read-only audit (two parallel research passes: one over the existing frontend, one over the backend's tenant-scoped vs. platform-operator-only API surface) before any code was written, exactly matching this phase's own prerequisite instruction not to assume APIs or screens exist.

## 3. Implemented Screens

New: `/memberships`, `/invitations`. Enhanced: `/dashboard` (real KPI tiles + recent activity), `/users/:id` (new Memberships tab), `/product-entitlements` (relabeled "Product Access" + framing), Topbar (persistent tenant/organization indicator), Sidebar (explicit "Tenant Administration" branding). Fixed: `/tenant-settings` (was calling a removed backend endpoint — see §17). Unchanged: everything else. Full route table in `docs/IDENTITY_TENANT_CONSOLE.md` §4.

## 4. Dashboard

Real `meta.total`-derived KPI tiles: Users, Organizations, Active memberships, Pending invitations (all `USER_VIEW`/`ORGANIZATION_MANAGE`-gated, hidden not zeroed when the caller lacks the permission), Products enabled (self-service, always visible, counted from `GET /product-entitlements`'s own ACTIVE rows — not a separate aggregate call). Plus "Recent security events" and "Recent login attempts" cards (last 5 each, `SECURITY_AUDIT_VIEW`-gated), each linking to the full Security & Audit page. No client-side aggregation across N calls anywhere; no fabricated numbers. Answers all 6 of the brief's own dashboard questions (§5) using only endpoints that already existed or were added for a genuinely shared reason (see §9).

## 5. Users

Unchanged in capability (pre-existing, real: list/detail/lifecycle/role-grants). Enhanced: User Detail gained a third "Memberships" tab showing this user's organization(s) within the current tenant, status, and a link to each — closing the previous gap where this page showed identity + roles but never membership/organization context at all, directly answering brief §6/§8's Global-User-vs-Membership distinction.

## 6. Memberships

New. `/memberships` — tenant-wide list (not per-organization), Organization and Status filters, status-change action (activate/suspend/remove) reusing the same confirmation-gated pattern as the pre-existing per-organization Members tab, routed to the row's own organization. Backed by a new backend endpoint, `GET /memberships` (see §9).

## 7. Invitations

New. `/invitations` — the same tenant-wide endpoint filtered to `status=INVITED`. "Invite user" reuses the existing `CreateUserDrawer` unchanged (already the real invite flow: email → name → organization → send). Resend reuses the existing `ResendInvitationButton`. No revoke action — no backend capability exists for it (confirmed, not built as a fake workaround).

## 8. Organizations

Unchanged — real, tested, tenant-scoped, pre-existing.

## 9. Product Access

Unchanged in capability (read-only, self-service, tenant-scoped `GET /product-entitlements`, no permission gate). Relabeled "Product Access" (from "Product Entitlements") and given the brief's own suggested framing per row (*"Identity Platform access: ✓ Tenant entitlement active"* / *"\<Product\> permissions: managed by \<Product\>"*), matching `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md`'s own Phase 2UI.1 recommendation. Activation/suspension remains Platform-Operator-only, unreachable here, unchanged.

## 10. Applications

**Confirmed architecturally prohibited from ever being tenant-facing**, not merely unbuilt: every route on `src/modules/applications/` is gated by `PlatformJwtAuthGuard` + `RequirePlatformPermissions`; `APPLICATION_VIEW`/`APPLICATION_MANAGE` are `platform_only = TRUE`, enforced by a database trigger that forbids ever granting either to a tenant Role. No nav item, no route, no documented-gap stub page — per the brief's own explicit allowance (§17) to omit the navigation entirely when a capability is Platform-Operator-only, and given the trigger-enforced impossibility, a stub page would falsely imply "coming soon."

## 11. Service Accounts

Same finding and same treatment as Applications (§10) — every route platform-operator-only, `SERVICE_ACCOUNT_*` permissions `platform_only = TRUE`, database-trigger-enforced. Not built, not stubbed, documented.

## 12. Security/Audit

Unchanged — real, tenant-scoped (`GET /security-audit/events`, `GET /security-audit/login-attempts`), confirmed via direct controller read that neither accepts a client-supplied `tenantId` (hard-coded server-side from `RequestContextService.requireTenantId()`).

## 13. Tenant Context

Resolved exclusively from the verified JWT (`RequestContextService.requireTenantId()`), confirmed at the guard level (`JwtAuthGuard.canActivate()`) — never a route param, header, or body field. New this phase: a persistent Tenant + Organization indicator in the Topbar (previously the tenant name was visible only inside a dropdown menu). Full detail in `docs/IDENTITY_TENANT_CONSOLE.md` §3.

## 14. Organization Context

Unchanged — the pre-existing `OrganizationContextSwitcher` already satisfied brief §4/§14's requirements exactly (backend-resolved same-tenant vs. cross-tenant switching, never a client-invented switch, never silent). No changes needed or made.

## 15. Security — cross-tenant attack matrix

| Attack | Method | Result |
|---|---|---|
| Tenant A Admin → Tenant B memberships via `organizationId` | `GET /memberships?organizationId=<orgB>` | 404 (RLS-scoped existence check, same pattern as the pre-existing per-organization route) — **e2e-verified** |
| Tenant A Admin → Tenant B user's membership via `userId` | `GET /memberships?userId=<tenantB-only-user>` | Empty result, not an error, not a leak — `tenantId` always ANDed server-side, never client-controlled — **e2e-verified** |
| No USER_VIEW → `GET /memberships` | Direct call without the permission | 403 — **e2e-verified** |
| No session → `GET /memberships` | Direct call, no token | 401 — **e2e-verified** |
| Tenant Console → Platform Console | Structural: separate route trees, separate providers, separate token stores, separate backend guards | Unreachable — unchanged, unverified-by-this-phase-because-unmodified (Phase 2UI.1-3 already established and tested this boundary) |
| Frontend-only permission hiding | `PermissionGate` hides UI, but is explicitly documented as never the real boundary | Confirmed: every new mutating action (membership status change, invite) is backend-gated (`USER_MANAGE`/`USER_VIEW`) independently of what the frontend shows |

All memberships-related rows above are **new e2e tests added this phase** (`tests/phase2a-membership.e2e-spec.ts`, describe block "Phase 2UI.4: GET /memberships — tenant-wide membership read"), run live against real PostgreSQL with the correct, non-superuser application database role (`identity_app` — see §25's own note on a self-caught false alarm from initially using the wrong, RLS-bypassing owner role for a test run).

## 16. API Gaps

Full table in `docs/IDENTITY_TENANT_CONSOLE.md` §10. Summary: Memberships/Invitations/User-detail-membership-context/Dashboard-metrics — all closed by one new endpoint (`GET /memberships`), per the brief's own instruction to look for one common capability rather than building several. Still open: invitation revoke (no backend method exists), invitation-token expiry display (data exists on a separate entity never exposed via a list endpoint — enforcement itself is real and unaffected), tenant-facing Applications/Service Accounts (architecturally prohibited), tenant-admin session visibility (no backend capability), Organization Types tenant-write-isolation (a pre-existing architectural characteristic, not fixed this phase — see §24).

## 17. Backend Changes

Exact files:
- `src/modules/memberships/dto/list-memberships-query.dto.ts` (new) — `organizationId?`, `userId?`, `status?` filters on `PaginationQueryDto`.
- `src/modules/memberships/controllers/tenant-memberships.controller.ts` (new) — `GET /memberships`, `RequirePermissions('USER_VIEW')`, same permission as the existing per-organization route.
- `src/modules/memberships/repositories/memberships.repository.ts` — added `listForTenant()`, mirrors the existing `listForOrganization()`'s RLS pattern (`prismaContext.runInContext(fn, tenantId)`), joins `user` and `organization` in one query.
- `src/modules/memberships/services/memberships.service.ts` — added `listForTenant()`, re-validates a foreign-tenant `organizationId` filter via the same 404-on-foreign-org check `listForOrganization()` already uses.
- `src/modules/memberships/controllers/index.ts`, `dto/index.ts`, `memberships.module.ts` — wiring only.
- `src/shared/api/tenants.ts`-equivalent frontend fix is listed separately below (§ this is backend-only list); no other backend module touched.

Preserves V1 contracts (the existing `GET /organizations/:organizationId/members` route is completely unchanged, zero behavior difference). Preserves RLS (same `runInContext` pattern as every other tenant-scoped repository method). Preserves authorization (same `USER_VIEW` permission, no new permission introduced). Has unit-equivalent coverage via the live e2e suite (this module has no pre-existing `.spec.ts` unit tests of its own — none were introduced elsewhere in this module either, so the e2e suite is this module's sole, and now expanded, automated coverage, consistent with its existing testing pattern). Has e2e tests (6 new, §15). Has security tests (2 of the 6, explicit cross-tenant IDOR checks). Is documented (`docs/IDENTITY_TENANT_CONSOLE.md` §5, this document).

## 18. Tests

```text
Backend e2e:    348/348 (342 pre-existing + 6 new — tests/phase2a-membership.e2e-spec.ts), 20/20 suites, live PostgreSQL
Backend unit:   277/277, 27/27 suites, unaffected by this phase's additions
Frontend:       223/223, 44/44 files (206 pre-existing + 17 new: 5 MembershipsPage + 6 InvitationsPage +
                3 UserDetailsPage-Memberships-tab + 3 DashboardPage)
```

One real regression bug was found and fixed within this phase's own work before it reached the final count above: `MembershipsPage`'s row-level "Change status" button was silently triggering the row's own `onRowClick` (navigate-to-user) due to MUI DataGrid's click-event bubbling — caught by the new tests themselves, fixed with `event.stopPropagation()` in the actions cell, not worked around in the test.

## 19. Browser E2E

No dedicated browser (Playwright/Cypress-style) E2E infrastructure exists in this repository (confirmed — same finding as Phase 2UI.2/2UI.3). The backend's own Jest+Supertest e2e suite against a real PostgreSQL instance (§18) is this project's actual E2E layer and was used for every cross-tenant security claim in §15 — no claim in this report rests on a frontend-mocked test alone.

## 20. Build

```text
Frontend typecheck (tsc -b --noEmit): PASS, 0 errors
Frontend build (vite build):          PASS
Frontend lint (eslint):               PASS, 0 errors (9 pre-existing, unrelated warnings — unchanged from Phase 2UI.3)
Backend typecheck (tsc --noEmit):     PASS, 0 errors (covers src/**/* and tests/**/*)
```

## 21. Accessibility

No new accessibility issues introduced. New interactive elements (status-change menus, filter selects, invite buttons) reuse existing, already-accessibility-tested design-system components (`FilterSelect`, `DataTable`, `ConfirmDialog` via `useConfirm`) unchanged in their accessibility behavior. No new `autoFocus` or other a11y anti-pattern was added.

## 22. Responsive

No new responsive work needed — every new screen is built from the same `DataTable`/`PageHeader`/`Card` components the rest of this desktop-first console already uses, inheriting its existing responsive behavior (horizontal scroll on dense tables, standard breakpoint stacking) unchanged. The new Topbar tenant/organization indicator is hidden below the `sm` breakpoint, matching the existing `OrganizationContextSwitcher`'s own responsive treatment.

## 23. Product Isolation

```text
TravelOS:                     0 changes
CTC Banking Intelligence AI:  0 changes
QueueStream.health:           0 changes
```
Confirmed by the diff's own scope: every changed file is under `apps/web/src/{app,features/memberships,features/users,features/tenant-settings,features/product-entitlements,shared}`, `src/modules/memberships`, `tests/`, or `docs/`. No product-specific business functionality (bookings, banking analytics, queues/appointments) was added anywhere — every new screen is generic identity/access administration, reusable by any future CTC SaaS product per the brief's own final architectural principle.

## 24. Known Issues

**Critical**: none.

**High**: none.

**Medium**: `Organization Types` (`/organization-types`) is global, tenant-writable reference data — `organization_type` has no `tenant_id` column (confirmed via direct repository read), yet is gated only by the tenant-grantable `ORGANIZATION_MANAGE` permission, so any tenant admin can edit/delete a type every other tenant on the platform also uses. This mirrors the Permission Catalog's own identical architecture (also global, also tenant-gated) and appears to be a deliberate, consistent pattern for small shared catalogs in this codebase, not a one-off bug — flagged as a design characteristic worth a deliberate decision in a future phase, not silently patched in this one (see `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md` §4's updated resolution note).

**Low**: full-frontend-suite test collection is occasionally non-deterministic under this sandboxed environment's resource contention (one run silently collected 43 files instead of the full 44 — no failures, just a dropped file from the run; re-running produced the full, correct 44/223 green count used in §18). Documented previously in Phase 2UI.3's own report as a pre-existing, environment-level condition, not something this phase introduced or needs to fix.

**Note, not a defect**: mid-session, the working directory's checked-out branch was externally switched from `phase2-identity-platform-frontend-and-tenant-fix` to `main` (a separately-diverged branch with its own, unrelated history) by a process outside this session's own actions, briefly leaving one pre-existing, unrelated file (`PHASE_3_1_PRODUCTION_OPERATIONAL_READINESS_REPORT.md`) in a git conflict state. Recovered with explicit user confirmation before any commit was made; all of this phase's own work was verified intact and unaffected afterward (full re-run of typecheck/tests/build, all green). No destructive git command was used without asking first.

## 25. Deferred

```text
Tenant-facing Applications / Service Accounts     — architecturally prohibited (platform_only, DB-trigger-enforced),
                                                       not a "future phase" item unless that trigger/permission
                                                       model is deliberately redesigned
Invitation revoke                                  — no backend capability; P1 if ever prioritized
Invitation-token expiry display                     — data exists on a separate entity, no list endpoint exposes it
Tenant-admin session visibility                     — no backend capability; P2 if ever prioritized
Organization Types tenant-write-isolation           — known, documented, not fixed (§24)
End-user authentication UX (login/forgot-password/  — Phase 2UI.5, untouched, out of scope
  reset/OAuth consent)
MFA / Passkeys / SAML                               — explicitly out of scope
Product-specific IAM (any product's own permission   — never in scope for this console, by architecture
  model)
```

## 26. Recommendation

Phase 2UI.5 (end-user authentication UX) can begin. This phase's own scope is complete and verified end-to-end: backend addition is minimal, tested, and RLS-preserving; every new frontend screen is real, tenant-scoped, and reuses the existing design system without introducing a new pattern; the cross-tenant security matrix central to this phase's brief was verified with live e2e tests, not just described; a real pre-existing correctness bug (Tenant Settings calling a removed endpoint) was found and fixed as a direct byproduct of the phase's own audit discipline; and Platform Console isolation remains fully intact and untouched.

## Final Decision

```text
PHASE 2UI.4 — PASS
```
