# Identity Admin — Information Architecture

Phase 2UI.1. Target navigation structure for the Identity Platform's two administrative surfaces, and the route-by-route mapping from what exists today. Source-verified against `apps/web/src/app/router/routes.tsx`, `apps/web/src/platform-console/router/platformRoutes.tsx`, and every backend permission decorator in `src/modules/*/controllers/*.ts` — see `docs/IDENTITY_UX_GAP_ANALYSIS.md` for the full inventory this is built from.

## 1. The proposed single-tree IA is rejected — here's why

The brief's own proposed structure (one flat `IDENTITY PLATFORM` nav tree containing Identity, Tenancy, Products, Applications, Service Accounts, Security, **and** Platform Administration all as siblings) is a reasonable first draft but contradicts a requirement stated elsewhere in the same brief (§19): *"Platform Operator is a separate security boundary... do not model it as simply SUPER_ADMIN > TENANT_ADMIN... create a visually and functionally distinct Platform Administration area."*

A single nav tree with a "Platform Administration" folder at the bottom does not satisfy that — it's still one tree, one shell, one set of nav items conditionally shown/hidden by permission. That pattern is exactly what this platform's own [[platform-operator-is-separate-auth-boundary]] finding (an earlier phase in this project) already rejected, for a concrete reason: a tenant-scoped `SUPER_ADMIN` token must never even be able to *reach* platform administration by having the right permission bit flip on — the boundary has to be structural (a different login, a different token, a different provider tree), not a hidden nav item.

**The codebase has already built the correct structure**: two physically separate consoles, each its own React Router subtree, each its own auth provider (`AuthProvider` vs `PlatformAuthProvider`), each its own login page, with zero shared token storage. This document formalizes and completes that structure — it does not introduce it.

```text
                    Two consoles, two logins, two token stores
                              (never merged, by design)

   /                                              /platform-console
   Tenant Console                                 Platform Console
   AuthProvider + PermissionProvider               PlatformAuthProvider
   tenant JWT (ordinary user)                     platform operator JWT
        │                                               │
        ▼                                               ▼
   scoped to ONE tenant,                          spans ALL tenants,
   the caller's own                               ALL products,
                                                   platform-wide config
```

## 2. Tenant Console IA (`/`)

```text
My Tenant
│
├── Dashboard                                   [EXISTS — see §Dashboard note below]
│
├── Identity
│   ├── Users                                   [EXISTS — /users]
│   ├── Organizations                           [EXISTS — /organizations]
│   ├── Memberships                             [EXISTS — /memberships, Phase 2UI.4, see §3]
│   ├── Invitations                             [EXISTS — /invitations, Phase 2UI.4, see §3]
│   └── My Sessions                             [EXISTS — /my-sessions, self-service only]
│
├── Roles & Permissions
│   ├── Roles                                   [EXISTS — /roles]
│   └── Permission Catalog                      [EXISTS — /permissions]
│
├── Product Access                              [EXISTS — /product-entitlements, READ-ONLY, relabeled Phase 2UI.4]
│
├── Security & Audit
│   ├── Security Events                         [EXISTS — /security/audit-events, tab 1]
│   └── Login Attempts                          [EXISTS — /security/audit-events, tab 2]
│
├── Organization Types                          [EXISTS but MISPLACED — see §4]
│
└── Tenant Settings                             [EXISTS — /tenant-settings]
```

### Changes from current routing

- **"Identity" as a new grouping folder** — Users/Organizations/Memberships/Invitations/Sessions are currently five ungrouped top-level-ish nav items (per `app/router/navigation.ts`); grouping them under one "Identity" label matches the brief's own conceptual model (§6, §10, §11: "Global User", "Membership must be first-class") and gives Memberships/Invitations a place to live once built (see §3).
- **"Product Access" renamed from whatever label `/product-entitlements` currently carries** — the page is confirmed read-only (frontend inventory: "page copy explicitly states granting/revoking is Platform-Operator-only"); the label should say "Access," not "Entitlements," to a tenant admin — "entitlement" is the platform's own internal noun for the grant record, not a tenant-facing concept. Purely a labeling change, zero code/route change otherwise.

## 3. Gap: Memberships and Invitations are not first-class today — RESOLVED in Phase 2UI.4

The brief (§11) is explicit: *"Membership must be first-class... Do NOT collapse Identity Membership, Product Role, Product Permission."* This section originally described the gap; it's kept below for the historical reasoning, with the actual resolution noted at the end.

- **No standalone `/memberships` route exists.** Memberships are only reachable nested inside `OrganizationDetailsPage`'s "Members" tab (one organization at a time). There is no cross-organization membership list, no way to answer "show me every membership this tenant has, regardless of organization" without opening every organization one at a time.
- **No standalone invitation-tracking view exists.** Sending is implicit (buried in `CreateUserDrawer` / a `ResendInvitationButton` inside the organization members list); there is no page listing "invitations sent, pending, expired, accepted" — an admin cannot answer "who hasn't accepted yet" without cross-referencing user status per row.

**Backend support check** (original, from `docs/IDENTITY_UX_GAP_ANALYSIS.md` §API Gap Table): `GET /organizations/:organizationId/members` exists today but is scoped to one organization — there is no tenant-wide `GET /memberships` across all organizations. **Recommendation: P1, new backend endpoint** — this is exactly the kind of aggregate view Identity Platform should own (it's identity/membership data, not product data), and doing it by N client-side calls violates the platform's own established server-side-pagination convention everywhere else.

**Resolution (Phase 2UI.4)**: `GET /memberships` was added (`src/modules/memberships/controllers/tenant-memberships.controller.ts`) — tenant-wide, RLS-scoped, gated on the same `USER_VIEW` permission as the existing per-organization route, with `organizationId`/`userId`/`status` filters. One endpoint serves three UI needs at once (per the "look for one common capability" discipline): the `/memberships` screen, the `/invitations` screen (same endpoint, `status=INVITED` fixed filter), and User Detail's own Memberships tab (`?userId=`). See `docs/PHASE_2UI4.md` and `docs/IDENTITY_TENANT_CONSOLE.md` for the full account, including the 6 new e2e tests (2 of them explicit cross-tenant isolation checks) and the still-open sub-gaps (no revoke-invitation endpoint, no tenant-wide invitation-token-expiry field).

Invitations: the DTOs (`ValidateInvitationDto`, `AcceptInvitationDto`) and events (`iam.user_invited` — visible in Security Events, confirmed live earlier in this project) already carried everything needed for a tracking list; the same `GET /memberships?status=INVITED` resolution above covers this rather than a separate `GET /invitations` endpoint, since a pending invitation already IS a `Membership` row at `INVITED` status — no separate concept needed.

## 4. Gap: Organization Types placement is architecturally inconsistent

Frontend inventory: `OrganizationTypesPage`'s own on-screen copy describes itself as "global reference data shared across all tenants." But the route lives in the Tenant Console (`/organization-types`), gated by the **tenant** permission `ORGANIZATION_MANAGE`, behind the ordinary `JwtAuthGuard` — meaning **every tenant can edit what the page itself claims is shared, global data**. Either:

- (a) the copy is wrong and organization types are actually tenant-scoped (in which case the placement is correct, fix the copy), or
- (b) the copy is right and this is a real cross-tenant data-integrity gap — one tenant's admin editing/deleting a type could affect every other tenant using it, with no ownership boundary enforcing otherwise.

This wasn't resolved by either inventory pass (it requires reading the actual `organization_type` table's tenant-scoping, which neither agent was asked to check at the schema level) — **flagged as an open question for Phase 2UI.2, not a UX decision this document can make alone.** If (b), the correct fix is moving this under **Platform Console → Platform Administration** as a true shared-catalog page, parallel to Products.

**Answer (confirmed in Phase 2UI.4)**: (b) is correct. `OrganizationTypesRepository`'s own source comment states plainly: *"organization_type is global reference data (no tenant_id)"* — confirmed by reading `src/modules/organization-types/repositories/organization-types.repository.ts` directly; every method (`findMany`/`findById`/`create`/`update`/`remove`) operates on the table with zero tenant filter. Any tenant admin holding the tenant-grantable `ORGANIZATION_MANAGE` permission can create/edit/delete a type that every other tenant on the platform also sees and uses. This is architecturally the same shape as the Permission Catalog (`GET/POST/PATCH/DELETE /permissions` — also global, also gated by a tenant-grantable permission, per `permissions.repository.ts`'s identical "global reference data" comment) — a pattern this codebase uses deliberately for small, low-churn shared catalogs, not a one-off bug. Phase 2UI.4 did **not** move this page or add tenant scoping to it — that would be a real backend behavior change (write-isolation, not a UI concern) outside this phase's scope, and given the Permissions catalog already establishes the same pattern as apparently-intentional, unilaterally "fixing" only one of the two would be an inconsistent, undiscussed judgment call. Documented as a known, accepted architectural characteristic in `docs/PHASE_2UI4.md`'s Known Issues, not fixed.

## 5. Platform Console IA (`/platform-console`)

```text
Platform Console
│
├── Dashboard                                   [EXISTS — see §Dashboard note below]
│
├── Tenants                                     [EXISTS — /platform-console/tenants]
│   └── [tenant detail]                         [EXISTS — /platform-console/tenants/:id]
│       ├── Product Access                      [EXISTS — .../entitlements]
│       └── Service Account Grants              [EXISTS — .../service-account-grants]
│
├── Products                                    [EXISTS — /platform-console/products]
│   └── [product detail]                        [EXISTS — /platform-console/products/:id]
│       └── Applications (nested list only)      [EXISTS, but see §6]
│
├── Applications                                 [GAP — no standalone index; see §6]
│   └── [application detail]                     [EXISTS — /platform-console/applications/:id]
│       └── Service Accounts (nested list only)  [EXISTS, but see §6]
│
├── Service Accounts                              [GAP — no standalone page at all; see §6]
│
├── Security
│   └── Platform Audit                          [EXISTS — /platform-console/audit]
│
└── Platform Administration
    ├── Platform Operators                       [EXISTS — /platform-console/operators]
    ├── Permission Catalog                       [GAP — see §7]
    ├── Signing Keys                              [NOT BUILT — no backend capability, per project memory]
    └── Configuration                             [NOT BUILT — no backend capability]
```

### Changes from current routing

Two new top-level entries — **Applications** and **Service Accounts** — promoted out of the nested-only structure they have today.

## 6. Gap: Applications and Service Accounts are not independently reachable

Confirmed by frontend inventory, verbatim: *"there is no standalone Applications list route or Service Accounts list/route anywhere."* Today:

- An Application is only reachable by first opening its parent Product, then clicking into the nested list. There is no way to browse "every Application across every Product" in one place, no cross-product search.
- A Service Account is only reachable by first opening its parent Application (itself only reachable via its parent Product). Three clicks deep, no independent list, **no delete UI, no credential-rotation UI** (confirmed: rotation doesn't exist server-side either — see the Gap Analysis doc).

This directly contradicts brief §17 (*"Service Account is NOT a User. Make this visually and semantically clear"* — hard to make something visually clear when it has no page of its own) and makes basic operational questions ("which service accounts exist platform-wide, are any stale/unused") unanswerable without opening every Product → every Application one at a time.

**Backend support**: both `GET /applications/:id` and `GET /service-accounts/:id` (single-item) already exist and are usable independently — the *list* endpoints are the ones scoped to a parent (`GET /products/:productId/applications`, `GET /applications/:applicationId/service-accounts`). A cross-product Applications index needs a new backend list endpoint (`GET /applications?productId=&search=`) — does not exist today. Same for Service Accounts (`GET /service-accounts?applicationId=&search=`). **Recommendation: P1 for both** — this is pure list-endpoint work, no new domain modeling, and directly unblocks the nav restructuring above.

## 7. Gap: no way to browse the platform-permission catalog

`PlatformOperatorsController.grantPermission` (`POST /platform/operators/:id/permissions`) takes a free-text `permissionCode: string` — there is no dropdown, no catalog endpoint scoped to `platform_only=true` permissions that a Platform Console screen could list. An operator granting a permission today must already know the exact code string. **Recommendation: P2** — lower urgency than Applications/Service Accounts (this only affects the already-small population of Platform Operators, not every tenant admin), but worth a dedicated `GET /platform/permissions` (or a `platformOnly=true` filter on the existing `/permissions` endpoint) plus a proper picker in `PlatformOperatorDetailPage`, replacing whatever free-text/typo-prone input exists there today.

## 8. Dashboard note (applies to both consoles)

Both dashboards were, at the time this document was written, static quick-link tiles with a code comment explicitly refusing to fabricate metrics from `meta.total` counts alone. That restraint was correct given no aggregate-stats endpoint existed yet — see `docs/IDENTITY_UX_GAP_ANALYSIS.md` §Dashboard for exactly which of the brief's 10 requested KPI questions could be answered at zero backend cost (via existing `meta.total`), and which needed a new endpoint.

**Updated (Phase 2UI.3 / Phase 2UI.4)**: both dashboards now show real `meta.total`-derived KPI tiles (Platform Console: Tenants, Products; Tenant Console: Users, Organizations, Active memberships, Pending invitations, Products enabled) plus a "recent security events" panel (Tenant Console also adds "recent login attempts"), each gated by `PermissionGate` and hidden — never zero'd or 403'd — when the caller lacks the permission. Still no client-side aggregation across N calls, still no fabricated numbers; the restraint itself is unchanged, only the set of real endpoints available to build on has grown.

## 9. What this IA deliberately does NOT do

- **No product-specific screens, ever.** No Bookings, no Banking Analytics, no Queues/Appointments anywhere in either console — confirmed nowhere in the current codebase either, this document only formalizes staying that way (brief §2/§23).
- **No merging of the two consoles.** Even where a screen "feels similar" (Security Events in the tenant console vs. Platform Audit in the platform console both reuse the same `EventDetailModal` component today) they remain separate routes, separate permission gates, separate data scope — confirmed correct and unchanged by this document (brief §19's own boundary, `PlatformAuditPage`'s own code comment: "explicitly never merged with tenant audit events").
- **No new persona-specific console** for the "Application/Developer Administrator" persona — see `docs/IDENTITY_UX_ARCHITECTURE.md` §2 for why that persona is a scoped Platform Operator, not a third console.
