# Identity Tenant Console — Tenant Administrator Surface

Phase 2UI.4. The operational reference for the Tenant Console (`/`, the app rooted at `apps/web/src/app/`) as actually built — every route, its real backing API, the tenant-context model, and the honest boundary between what's backed by a real API today and what's a documented gap. Builds on `docs/IDENTITY_PLATFORM_CONSOLE.md` (the Platform Console's own equivalent reference) and `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md` (the Phase 2UI.1 target IA this phase closes out).

## 1. What already existed vs. what this phase built

Before this phase began, the Tenant Console was NOT a placeholder shell — 13 of its 14 routed pages were already real, working, tested implementations (Users, Organizations incl. Members tab, Organization Types, Roles, Permissions, Security Audit, Tenant Settings, Product Entitlements, My Sessions, plus the pre-existing Dashboard quick-link hub). Only `SettingsPage` was a genuine placeholder (untouched by this phase — no Settings screen is in the brief's target nav). Phase 2UI.4's job was narrower than "build a console": close the specific, real gaps (Memberships, Invitations, real Dashboard metrics, tenant-context visibility) and verify/harden the security properties the brief centers on (cross-tenant isolation, Platform Console isolation).

## 2. The security boundary, as verified (not just described)

```text
/                              /platform-console
Tenant Console                 Platform Console
AuthProvider                   PlatformAuthProvider
tenant JWT                     platform operator JWT
```

Unchanged this phase — no file under `platform-console/` was touched. The boundary is structural, not a nav toggle: `ProtectedRoute`/`PermissionRoute` (tenant) and `PlatformProtectedRoute`/`PlatformPermissionRoute` (platform) read from entirely separate providers with separate token stores; the backend's `JwtAuthGuard` and `PlatformJwtAuthGuard` are separate guard classes that reject the other token type outright (confirmed, `src/common/context/request-context.service.ts`'s own comment: platform and tenant context are "never co-populated on the same request").

## 3. Tenant context — where it comes from, and where it doesn't

Every tenant-scoped read/write this console makes resolves its tenant exclusively from the caller's own JWT (`RequestContextService.requireTenantId()`), set once by `JwtAuthGuard.canActivate()` from the cryptographically verified access token — never from a route param, header, or request body. Confirmed directly in this phase for the one place that used to be an exception: **`shared/api/tenants.ts`'s `getOwnTenant`/`updateOwnTenant` were found calling a stale `GET/PATCH /tenants/:id` pattern that no longer exists on the backend** (the route was replaced by `/tenants/me` during an earlier Phase 2D security remediation — [[tenant-manage-unscoped-registry-vulnerability]] — but the frontend was never updated to match, and its own test file mocked the same stale URL, so the drift was invisible). Fixed this phase: both functions now call `/tenants/me`, taking no id parameter at all — see §9.

Organization context (`useAuth().organizationContext`) is separate from tenant context and optional — most users hold no organization-scoped role grant and never see the switcher. When present, `OrganizationContextSwitcher` (pre-existing, unchanged) lets a caller move between every organization they hold an ACTIVE membership in, **including across tenants** — the backend resolves same-tenant vs. cross-tenant switches transparently and the frontend never guesses; this already matched brief §4's "never silently switch tenant context, use the existing organization/context model" requirement without any change needed.

**New this phase**: a persistent Tenant + Organization indicator in the Topbar (`TenantContextIndicator`, `app/layouts/AppShell/Topbar.tsx`) — previously the tenant name was visible only inside the UserMenu dropdown. Now always visible: tenant name, and the active organization name directly beneath it when one is selected (brief §28's "ABC Bank / Kampala Branch" example).

## 4. Routes and screens, exactly as shipped

| Route | Screen | Backing API | State |
|---|---|---|---|
| `/dashboard` | Dashboard | Real `meta.total` from Users/Organizations/Memberships lists, `GET /product-entitlements`, last 5 security events, last 5 login attempts | **Enhanced this phase** — was quick-links-only |
| `/users`, `/users/:id` | Users | `GET/POST/PATCH/DELETE /users`, lifecycle, roles | Unchanged, **Users detail enhanced this phase** — new Memberships tab |
| `/memberships` | Memberships | `GET /memberships` | **New this phase** |
| `/invitations` | Invitations | `GET /memberships?status=INVITED`, `POST /users` (invite), `POST /users/:id/resend-invitation` | **New this phase** |
| `/organizations`, `/organizations/:id` | Organizations (incl. Members tab) | `GET/POST/PATCH/DELETE /organizations`, `GET /organizations/:id/members`, `PATCH .../members/:userId` | Unchanged |
| `/organization-types` | Organization Types | `GET/POST/PATCH/DELETE /organization-types` | Unchanged — see §8's known-issue note |
| `/roles`, `/roles/:id` | Roles & Permissions | `GET/POST/PATCH/DELETE /roles`, role-permission grants | Unchanged |
| `/permissions` | Permission Catalog | `GET/POST/PATCH/DELETE /permissions` | Unchanged |
| `/security/audit-events` | Security & Audit | `GET /security-audit/events`, `GET /security-audit/login-attempts` | Unchanged |
| `/tenant-settings` | Tenant Settings | `GET/PATCH /tenants/me` | **Fixed this phase** — was calling a removed endpoint, see §9 |
| `/product-entitlements` | Product Access | `GET /product-entitlements` | **Enhanced this phase** — relabeled, added Identity-vs-product-permission framing |
| `/my-sessions` | My Sessions | `GET /sessions/me`, `DELETE /sessions/:id`, `POST /sessions/revoke-others` | Unchanged — self-service only, see §7 |
| `/settings` | Settings | — | Placeholder, pre-existing, out of this phase's scope (not in the brief's target nav) |

## 5. Memberships and Invitations — one endpoint, three UI surfaces

The brief asks for Users, Memberships, and Invitations as three separate nav items (§3, §6-11), and for User Detail to show "the user's membership within the current tenant" (§8). Before this phase, membership data existed only nested one organization at a time (`GET /organizations/:organizationId/members`) — no tenant-wide view, no way to answer "who belongs to this tenant at all" without opening every organization.

Per the brief's own explicit instruction (§30 — *"do not implement six independent endpoints... look for common platform-read capabilities"*), this phase added **one** new backend endpoint — `GET /memberships` (`src/modules/memberships/controllers/tenant-memberships.controller.ts`) — tenant-wide, RLS-scoped via the same `runInContext(fn, tenantId)` pattern every other tenant-scoped repository method already uses, gated on the same `USER_VIEW` permission the existing per-organization route uses, with `organizationId`/`userId`/`status` filters. It backs all three real gaps at once:

- **`/memberships`** — the full tenant-wide list, with organization/status filters and the same status-change control (`TenantMembershipStatusMenu`) as the existing per-organization Members tab.
- **`/invitations`** — the same endpoint with `status=INVITED` fixed, i.e. exactly the memberships still awaiting acceptance. "Invite user" reuses `CreateUserDrawer` unchanged (it already IS the real invite flow: email → name → organization → send) rather than building a second parallel form.
- **User Detail's new "Memberships" tab** — `?userId=` filtered, showing this user's organization(s), status, and a link to each — the concrete answer to brief §6/§8's "Global User → Membership → Tenant" requirement, which the page previously didn't show at all (Overview/Roles tabs only).

Status changes (activate/suspend/remove) still go through the existing, unchanged `PATCH /organizations/:organizationId/members/:userId` — a membership is always changed in the context of one specific organization, so the new tenant-wide list's status control (`TenantMembershipStatusMenu`) takes `organizationId` per row and calls the same endpoint, just with its own cache-invalidation key (see hooks.ts's own doc comment for why it isn't the existing organization-bound hook).

**What this endpoint deliberately does NOT add**: no revoke-invitation capability (no such backend method exists — `UserInvitationsService` has no revoke method, confirmed by direct read), no invitation-token expiry field on the list (that lives on a separate `InvitationToken` entity never exposed via any list endpoint — the accept flow validates expiry server-side regardless, so this is a display-only gap, not a security gap). Both are documented in the API gap table, §10.

## 6. Product Access — relabeled, read-only by design

Unchanged in capability (real, `GET /product-entitlements`, tenant-scoped from JWT, no permission gate needed since a tenant admin's own entitlements are always visible to them). This phase relabeled it "Product Access" (from "Product Entitlements" — "entitlement" is the platform's own internal noun for the grant record, not a tenant-facing concept, per `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md` §2's original recommendation) and added the brief's own suggested framing per product row: *"Identity Platform access: ✓ Tenant entitlement active"* / *"\<Product\> permissions: managed by \<Product\>, not Identity Platform"* — making explicit what this screen already meant, without adding any new data or capability. Activating/suspending a product entitlement remains Platform-Operator-only, unreachable and unshown here, exactly as before.

## 7. Applications, Service Accounts, and Sessions — confirmed NOT tenant-reachable, correctly not built

Verified directly against every controller in `src/modules/applications/` and `src/modules/service-accounts/`: **every route on both modules is gated by `PlatformJwtAuthGuard` + `RequirePlatformPermissions(...)`** — there is no tenant-facing route for either, not a hidden one, not a partially-built one. `APPLICATION_VIEW/MANAGE` and `SERVICE_ACCOUNT_VIEW/MANAGE` (plus `SERVICE_ACCOUNT_TENANT_GRANT_VIEW/MANAGE`) are all `platform_only = TRUE` in the permission catalog, enforced by a database trigger (`trg_security_role_permission_no_platform_only`) that forbids ever granting one to a tenant Role — this is a stronger guarantee than "not built yet," it's "cannot become reachable by any future tenant Role without a database schema change." Per brief §17/§19's own explicit allowance ("omit the navigation entirely" when this is Platform-Operator-only), neither has a nav item, a route, or even a documented-gap stub page — adding one would falsely imply "coming soon" for something that's architecturally excluded.

Sessions: `src/modules/sessions/controllers/sessions.controller.ts` has no `userId` route param on any method — every route resolves exclusively via the caller's own JWT identity (`this.context.userId!`). There is no way, structurally, for a tenant admin to view or revoke another user's session. "My Sessions" (self-service, pre-existing, unchanged) remains the only session UI this console has; no admin session-browsing screen was built, matching brief §22's own explicit instruction not to invent one.

## 8. Organizations, Roles, Permissions — unchanged, with one documented finding

All three remain exactly as they were: real, working, tenant-scoped (Organizations, Roles) or tenant-gated-but-globally-scoped (Permissions — confirmed `security_permission` is global reference data with no tenant filter at all, by design, matching the catalog pattern brief §23 describes). One finding surfaced during this phase's own investigation, not fixed (see Known Issues, `docs/PHASE_2UI4.md`): `Organization Types` (`/organization-types`) is *also* global reference data (`organization_type` has no `tenant_id` column, confirmed via direct repository read) but is gated by the tenant-grantable `ORGANIZATION_MANAGE` permission — any tenant admin can edit/delete a type every other tenant also uses. This mirrors the Permission Catalog's own architecture exactly (also global, also tenant-gated) — treated as a consistent, apparently intentional platform pattern for small shared catalogs, not a one-off bug this phase should silently patch.

## 9. A real bug found and fixed: Tenant Settings was calling a removed endpoint

Not a new capability — a correctness fix, found while auditing existing tenant-scoped screens before building new ones (per this phase's own prerequisite instruction: "inspect all tenant-scoped APIs before creating screens"). `shared/api/tenants.ts`'s `getOwnTenant`/`updateOwnTenant` called `GET/PATCH /tenants/${tenantId}` — a route pattern that **no longer exists on the backend**. An earlier Phase 2D security remediation ([[tenant-manage-unscoped-registry-vulnerability]]) replaced it with `GET/PATCH /tenants/me` (no id parameter at all, resolved server-side from the JWT) specifically because the old shape had no ownership check — but the frontend, and its own test file (which mocked the same stale URL, so the drift never surfaced as a test failure), were never updated to match. This means `TenantSettingsPage` would have 404'd against a live backend today. Fixed: both functions now call `/tenants/me`, the hook signatures dropped their now-unnecessary `tenantId` parameter, and the test file's mocked URLs were corrected — re-verified live (4/4 tests pass against the corrected endpoint).

## 10. API Gap Table

| Feature | UI requirement | Existing API | Status | Recommendation |
|---|---|---|---|---|
| Memberships (tenant-wide) | List across every organization | `GET /memberships` (built this phase) | SUPPORTED | Done |
| Invitations (tenant-wide) | List of pending invites | `GET /memberships?status=INVITED` (built this phase) | SUPPORTED | Done |
| Invitation revoke | Cancel a pending invite | None | NOT SUPPORTED | `UserInvitationsService` has no revoke method — P1, future |
| Invitation-token expiry display | "Expires" column | None — expiry lives on a separate `InvitationToken` entity never exposed via any list endpoint | NOT SUPPORTED (display only; enforcement is real, server-side) | P2, future |
| User Detail membership context | This user's org/status in this tenant | `GET /memberships?userId=` (built this phase) | SUPPORTED | Done |
| Dashboard: Users/Organizations/Active memberships/Pending invitations | Real KPI tiles | Existing `meta.total` on each list | SUPPORTED | Done |
| Applications (tenant-scoped) | Tenant admin manages own applications | None — every route is `platform_only` | NOT SUPPORTED — architecturally prohibited | Not recommended without a deliberate platform_only→tenant-grantable permission redesign |
| Service Accounts (tenant-scoped) | Tenant admin manages own service accounts | None — every route is `platform_only` | NOT SUPPORTED — architecturally prohibited | Same as above |
| Tenant-admin session visibility | View/revoke other users' sessions | None — every route is self-only | NOT SUPPORTED | P2, future, if ever needed |
| Organization Types tenant-scoping | Type edits stay within one tenant | None — global reference data | NOT SUPPORTED (by apparent design, matches Permission Catalog) | Documented as known issue, not fixed this phase |

No other backend API was added this phase beyond `GET /memberships` — every other gap was left honestly documented, per the brief's own instruction not to expand scope into unrelated backend work.

## 11. Design system

No new components this phase — every new screen (`MembershipsPage`, `InvitationsPage`, the Dashboard's KPI tiles) reuses `DataTable`, `FilterSelect`, `KpiCard` (the same component Phase 2UI.3's Platform Dashboard introduced), `StatusBadge`, `PageHeader`, `PermissionGate`, and `useConfirm` exactly as the rest of this console already does. One new small component, `TenantMembershipStatusMenu` (mirrors the existing `MembershipStatusMenu` but targets the tenant-wide list's own cache key — see `features/memberships/hooks.ts`).

## 12. What this phase deliberately did not touch

No Platform Console file was read or modified. No product-specific business functionality was added anywhere (no Bookings, Banking Analytics, Queues/Appointments — confirmed by scope of the diff itself: every changed file is under `apps/web/src/{app,features/memberships,features/users,features/tenant-settings,features/product-entitlements,shared}` or `src/modules/memberships`). No end-user authentication UX (login/forgot-password/OAuth consent) was touched. No MFA/Passkeys/SAML. No new role or permission was introduced — every gate in this phase uses an existing `PERMISSIONS.*` constant (`USER_VIEW`, `USER_MANAGE`), never a new one.
