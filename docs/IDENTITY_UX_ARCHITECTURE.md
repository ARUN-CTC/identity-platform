# Identity Platform — UX Architecture

Phase 2UI.1. Personas, navigation model, core user journeys, design-system requirements, security UX requirements, and responsive/accessibility strategy for the Identity Platform as a reusable Identity Control Plane for TravelOS, CTC Banking Intelligence AI, and QueueStream.health. Builds on `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md` (the IA/navigation target) and `docs/IDENTITY_UX_GAP_ANALYSIS.md` (the full gap matrix) — this document does not repeat their tables, it explains the *why* behind the design decisions.

## 1. Personas

### A. Platform Operator

Full-authority identity, separate from every tenant, authenticated via `/platform-console/login` (own JWT, own token store, `PlatformAuthProvider`). Sees: all tenants, all products, all entitlements, all applications, all service accounts, all platform operators, platform-wide security/audit. **Never** sees tenant-internal operational detail a Tenant Admin manages day-to-day (a tenant's own organization structure beyond what's needed for entitlement/grant decisions) — the Platform Console shows tenant *administration* facts (status, entitlements, grants), not tenant *usage* facts (who logged in when, which org a specific user belongs to) unless drilling into a specific tenant's own audit trail.

### B. Tenant Administrator

Scoped entirely to one tenant, authenticated via `/login` (ordinary tenant JWT). Sees and manages: Users, Organizations, Memberships (once built), Invitations (once built), Roles & Permissions, Product Access (read-only), Security & Audit (tenant-scoped only), Tenant Settings. **Structurally cannot** see another tenant, Platform Operators, Signing Keys, platform configuration, or platform-wide audit — not because a permission check hides a nav item, but because the Tenant Console never authenticates against, or requests data from, any platform-scoped endpoint. This is the same boundary discipline `PlatformAuthProvider`/`AuthProvider` already enforce at the code level (confirmed: zero shared token state) — this document's job is to make sure every *new* screen preserves it, not to introduce it.

### C. End User (of TravelOS / Banking AI / QueueStream)

Never sees the Tenant Console or Platform Console at all in the common case — their entire Identity-Platform-facing surface is: login, logout, forgot/reset password, organization selection/switching if they belong to more than one organization, and (for a product with its own session/security page) a view of their own active sessions. The OAuth authorization redirect (§4.7) is invisible infrastructure to them in the first-party-trust model this platform currently implements (no consent screen — see the Gap Analysis §3 OAuth consent row) — they experience it as "click login on TravelOS, land back on TravelOS already signed in," never as a separate Identity Platform screen they consciously interact with, unless something goes wrong (see §4.8, Authentication UX error journeys).

### D. Application/Developer Administrator — recommended boundary

The brief explicitly asks not to assume this persona is identical to Tenant Administrator, and to recommend the right boundary instead of inventing one from scratch.

**Finding**: in the current permission model, Application/Product/Service-Account management (`APPLICATION_MANAGE`, `PRODUCT_MANAGE`, `SERVICE_ACCOUNT_MANAGE`, `PRODUCT_ENTITLEMENT_MANAGE`) are **exclusively platform-scoped permissions** — every one of them lives behind `PlatformJwtAuthGuard`/`RequirePlatformPermissions`, never the tenant `JwtAuthGuard`. There is no tenant-level "manage my own product's OAuth client" capability anywhere in this codebase today, and no tenant role (including `TENANT_ADMIN`/`SUPER_ADMIN`) is ever granted a platform-only permission (enforced by a DB trigger, per prior-phase documentation — a structural guarantee, not a convention).

**Recommendation**: this persona is not a new role type and not a third console. It is **a Platform Operator granted a narrow permission subset** — `APPLICATION_VIEW`/`APPLICATION_MANAGE`, `PRODUCT_VIEW` (rarely `PRODUCT_MANAGE`), `SERVICE_ACCOUNT_VIEW`/`SERVICE_ACCOUNT_MANAGE` — using the grant-ceiling mechanism `PlatformOperatorsController` already enforces (an operator can only grant permission codes they themselves hold). In practice: TravelOS's own engineering lead gets a Platform Operator account scoped to exactly those codes, can register/update TravelOS's own Applications and Service Accounts, and cannot touch Tenant Registry, other Products, or Platform Operators management. **No new backend work is required for this persona** — it's a configuration/onboarding decision (which permission codes to grant a given operator account), not a missing capability. The only UX consequence: the Platform Console's nav should hide sections the signed-in operator lacks permission for (already the pattern `PlatformDashboardPage` uses today for its quick-link tiles — extend the same filtering to the main nav, not a new mechanism).

**Explicitly not recommended**: giving Tenant Administrators any Application/Service-Account capability over their own tenant's integrations. Every target product (TravelOS, Banking AI, QueueStream) is first-party and platform-operator-provisioned in the current model; self-service tenant-level app registration is a real, coherent future feature (common in mature IDaaS platforms) but is out of scope until a concrete requirement for it exists — flagged as a **P2, future persona extension**, not built or half-built here.

## 2. Navigation model

Fully specified in `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md`. Summary of the governing rule: **the console you're in is determined by which login page you used, not by a permission check inside one shared shell.** A Platform Operator who also happens to hold a tenant Membership (rare, but not structurally forbidden) still needs to log into the Tenant Console separately to act as that tenant user — the two sessions never merge, matching [[platform-operator-is-separate-auth-boundary]].

Within each console, nav-item visibility is permission-filtered exactly as today (`isNavItemVisible()` pattern, confirmed in the frontend inventory) — this is a UX convenience, never the security boundary; every route's real protection is server-side, and every gated screen still needs to handle a 403 gracefully if reached directly (already true via `PermissionRoute`/`PlatformPermissionRoute` rendering `/403` in place).

## 3. Core user journeys

### 3.1 Tenant onboarding — **a real, currently-unbuildable backend gap found here**

The brief's proposed flow: `Create Tenant → Initial Administrator → Select Products → Organizations → Invitations → Review → Activate`. Checking each step against the actual API surface:

| Step | API support | Verdict |
|---|---|---|
| Create Tenant | `POST /platform/tenants` | ✅ Supported |
| Select Products (entitle) | `POST /platform/tenants/:id/product-entitlements` (per product) | ✅ Supported |
| Review/Activate | `POST /platform/tenants/:id/activate` | ✅ Supported |
| **Initial Administrator** | **No path exists** | ❌ **Blocked** |
| **Organizations (first one)** | **No path exists** | ❌ **Blocked** |
| Invitations | Depends on the above two | ❌ Blocked transitively |

**Why "Initial Administrator" and "Organizations" are structurally blocked today**, verified directly against `TenantsService.create()` (`src/modules/tenants/services/tenants.service.ts:95-124`): creating a Tenant inserts *only* the `tenant` row — no default Organization, no initial user, no role assignment. To create that tenant's first Organization, the only endpoint is `POST /organizations` (tenant-scoped, gated by `ORGANIZATION_MANAGE`, requires a **tenant** JWT). To create that tenant's first User, the only endpoint is `POST /users` (also tenant-scoped, requires `organizationId`). **A Platform Operator's token cannot call either** — both require an authenticated member of the tenant being onboarded, and no member exists yet. This is a genuine chicken-and-egg gap, not a UX oversight: it's exactly why the one place this repository successfully creates a first tenant+org+admin today is `database/seeds/003_bootstrap_dev_tenant.sql` — **raw SQL, not an API call**, unusable in production.

**Recommendation (P0 — this blocks the entire tenant-onboarding wizard as specified)**: a new platform-operator-authenticated bootstrap endpoint, e.g. `POST /platform/tenants/:id/bootstrap`, atomically creating: a default Organization (using a pre-existing, shared Organization Type — see the connection to the Organization Types placement question in the IA doc §4: if Organization Types genuinely are global reference data, the bootstrap flow can simply let the operator pick one rather than invent a type from scratch) + the first User (email/name from the wizard) + a `TENANT_ADMIN` role assignment + triggering the normal invitation-email flow so that user sets their own password the same way every other invited user does. This single endpoint is what makes the wizard in the brief actually buildable; until it exists, "Register Tenant" in the Platform Console can only produce an empty, unusable tenant shell.

Target wizard UX (once the endpoint exists): `Create Tenant` (name/code) → `Initial Administrator` (email/first/last name — reuses the existing invitation-email mechanism, no new email template) → `Select Products` (checkbox list, one `POST .../product-entitlements` call per selection — no bulk endpoint exists, see Gap Analysis §3, so the wizard issues N sequential calls with per-item progress, not a single bulk call) → `Review` (read-only summary) → `Activate` (`POST /platform/tenants/:id/activate`). Organizations beyond the first, and additional invitations, happen **after** activation, inside the Tenant Console itself (the Tenant Admin who just received their invitation does that work, not the Platform Operator) — keeping the wizard itself short and matching the ownership boundary (Platform Operator provisions the tenant and its first admin; everything else is that tenant's own business).

### 3.2 Product onboarding

Fully designed in `docs/PRODUCT_ONBOARDING_UX.md`, validated against all three target products plus a fourth hypothetical ("GymOS"). Summary: `Product Information → Application → OAuth Configuration → Redirect URIs → Scopes → Review → Activate`, all steps already API-supported today (confirmed live in `docs/NEW_PRODUCT_ONBOARDING_WALKTHROUGH.md` — an actual worked run against the real backend, not a hypothetical). This is the one onboarding journey with **zero backend gaps** — the wizard is a pure UX/sequencing exercise over existing endpoints.

### 3.3 Application/OAuth configuration journey

Platform Operator (or a scoped Application/Developer Administrator, §1.D) opens a Product → Applications tab (or, once built, the standalone Applications index — Gap Analysis §3) → Register Application → fills Name/Client Type/Grant Types/Redirect URIs/Allowed Origins/Scopes/Audiences → on success, `OneTimeSecretDialog` shows the plaintext secret exactly once (CONFIDENTIAL only) → operator copies it into a secrets vault for the product team → **today, that's the only chance they get.** See §5 for the rotation gap this journey currently cannot recover from.

### 3.4 Service account journey

Platform Operator opens an Application's detail page → Service Accounts section (nested, per Gap Analysis §3's standalone-page recommendation) → Register Service Account (name only) → `OneTimeSecretDialog` reveals the credential once → separately, a Platform Operator grants that service account a **Tenant Grant** (`POST /platform/tenants/:tenantId/service-account-grants`) authorizing it to act on a specific tenant's behalf — this is a **second, independent authorization step**, and the UX must make clear that registering a service account and granting it tenant access are two different actions with two different blast radii (a service account with no tenant grants can authenticate but can act on nothing).

### 3.5 Security/Audit journey

Two parallel, never-merged experiences: Tenant Admin sees `Security & Audit` (their tenant's own events + login attempts); Platform Operator sees `Platform Audit` (platform-scoped events only). Both currently filter by event-type/actor-id only — see Gap Analysis §3 for the missing date-range filter, which materially affects this journey's usefulness for real incident investigation ("what happened in this two-hour window" is not answerable today without manually paging through results sorted by time).

### 3.6 Organization context journey

A user with memberships in multiple Organizations (within one tenant) switches via `POST /auth/context/switch` — already fully built (`AuthProvider`'s `switchOrganization`), issues a fresh token pair server-validated against real membership state (never a client-trusted claim). `GET /me/organizations` (cross-tenant, confirmed by backend inventory) is the one endpoint that shows a user their *entire* footprint across every tenant they belong to — this is the correct home for a future "which of my tenants do I want to work in today" picker, distinct from the org-switcher, if/when TravelOS-style users who belong to multiple tenants become common (currently every seeded/tested user in this project belongs to exactly one tenant — this is a forward-looking note, not a currently-observed pain point).

### 3.7 Authentication UX error journeys

All of the following are real, already-distinguishable states given the confirmed API error shapes (`ApiError` with `.isUnauthorized`/`.isForbidden`/`.isNotFound`/`.isRateLimited`/`.isConflict` getters) — this is a checklist that each should render a distinct, correctly-worded screen/toast, not a generic "Something went wrong":

`Login` · `Logout` · `Forgot password` · `Password reset` · `Account disabled` (user status ≠ ACTIVE) · `Account locked` (rate-limit/lockout — Phase 3's own hardening) · `Session expired` (401 mid-session → `emitSessionExpired()`, already wired) · `Invalid session` (refresh itself fails) · `Organization selection` (multi-org login) · `Organization switch` (denied — stale membership) · `Authorization denied` (`/403` — already built, both consoles) · `Application unavailable` (an Application in SUSPENDED/DISABLED status attempting `/oauth/authorize` or `/oauth/token`) · `Tenant unavailable` (tenant SUSPENDED — `TenantStatusGuard`, already enforced server-side; confirm the frontend surfaces this distinctly from a generic 403) · `Product unavailable` (entitlement REVOKED/SUSPENDED — surfaces at token-issuance time per the Product Registration doc's own enforcement point) · `Identity Platform unavailable` (network/5xx — `ErrorState`'s "network-error" variant already exists).

**Gap**: not every one of these has been confirmed to render distinctly today (the frontend inventory covered the *mechanism* — `ApiError` getters, `ErrorState` variants — but not a page-by-page audit of which specific error path each screen actually branches on). **Recommendation: P1**, a dedicated pass mapping each backend error condition above to its exact frontend handling, filling any gap found with the existing `ErrorState`/`EmptyState` vocabulary rather than new components.

## 4. Design system assessment

The existing design system (`apps/web/src/design-system/`) is **substantially complete and already fit for an enterprise control-plane** — this section recommends targeted additions, not a rebuild.

**What's already correct and should be reused, not replaced**: semantic status-color tokens (`statusColorTokens`/`SEMANTIC_TONE`, explicitly documented as "never color alone" — matches brief §28's color-independent status requirement already); `DataTable` (server-pagination-first, consistent loading/error/empty wiring); `FormDrawer`/`ConfirmDialog`/`Modal` three-tier interaction pattern; `OneTimeSecretDialog` (a genuinely well-designed security-sensitive component — see §5); `PageHeader`/`Breadcrumbs`/`EmptyState`/`ErrorState`/`LoadingState` consistency; the `createCrudQueryHooks()` factory for simple reference-data resources.

**Gaps to fill, in priority order**:
1. **`KpiCard` is built and unused** — wire it into both dashboards per Gap Analysis §5. Zero new component work.
2. **No Access Matrix component exists** — new: a grid component (rows = users or tenants, columns = products, cells = status-tone-colored ✓/✗/– with a click-through detail popover). Should be built as a new `design-system/components/AccessMatrix/` following the existing token/pattern conventions, not a one-off page-local component, since the Gap Analysis identifies this as needed in more than one place (tenant-level and, potentially, a future per-user view).
3. **No dedicated audit-timeline visual** beyond the existing `ActivityTimeline` pattern (`design-system/patterns/audit/ActivityTimeline.tsx`) — confirm this pattern is actually used by `SecurityAuditPage`/`PlatformAuditPage` today or if those pages just use plain `DataTable` rows; if the latter, evaluate whether a timeline view adds real value over the tabular one before building it (brief §25 lists "audit timeline" as a requirement, but a second visualization of the same data is only worth it if it answers a question the table doesn't — e.g. "what happened right before/after this event" — not merely because it looks more dashboard-like).
4. **Server-side `sortBy`/`sortOrder` is dead on the frontend where the backend ignores it** — either wire the missing backend `orderBy` clauses (Gap Analysis §2/§3) or remove the now-misleading sort-control affordance from those specific tables until the backend supports it; shipping a sort dropdown that silently does nothing is worse than no sort dropdown.

## 5. Security UX requirements

**Destructive/high-risk actions**: the existing `ConfirmDialog`/`useConfirm()` imperative pattern already covers delete/suspend/revoke/disable across every module inspected — this is correct and should remain the single mechanism (no new confirmation pattern needed). The one place to double-check case-by-case: does a *platform-operator-disabling-the-last-active-operator* attempt (already rejected server-side with a 409, per the backend inventory) surface as a clear, specific message rather than a generic "request failed" — this is exactly the kind of guardrail-explaining UX brief §19 asks for ("make destructive/high-risk actions visibly distinct").

**Credential generation/display**: `OneTimeSecretDialog` already implements every rule brief §15/§18/§28 asks for — masked by default, explicit reveal toggle, copy-to-clipboard, never persisted to any browser storage or the query cache, a `warning`-severity alert stating it won't be shown again, and a deliberate dead end (no "show again"). **The one missing piece is rotation** (Gap Analysis §2/§3, flagged P0) — the UX pattern for a *rotation* flow should reuse `OneTimeSecretDialog` exactly as-is once the endpoint exists (rotation produces a new one-time secret, same display rules apply), plus a brief "the old secret stops working at [time/immediately]" notice so a product team can coordinate the swap.

**Never display**: passwords, access tokens, refresh tokens, client secrets (post-creation), authorization codes — confirmed by the frontend inventory that no screen outside `OneTimeSecretDialog`'s two call sites displays any credential value; this document's job is to keep it that way as new screens (Applications index, Service Accounts index) are built — neither should ever re-fetch or re-display a secret, only metadata (`clientId`, `status`, `createdAt`, never `clientSecret`/`credential` outside the creation moment).

**Frontend reflects, never replaces, backend authorization**: every `PermissionGate`/`usePermission` call site is explicitly documented in its own source as "UX-only... never the security boundary" — confirmed true by construction (every gated action's underlying endpoint independently enforces the same permission server-side). This document reaffirms the rule for every new screen this phase's roadmap adds: build the nav/UI gate for usability, never treat it as the reason a request is safe.

**Cross-tenant access prevention**: not a frontend concern to build — RLS + the `identity_app` role's `NOBYPASSRLS` posture is the actual, already-verified-live enforcement (prior phase's own direct `psql` verification). The Access Matrix (§4) is explicitly a **visibility** feature, not an access-control feature — worth restating because a matrix showing "who can reach what" could be mistaken for the mechanism that decides it; it is not.

## 6. Responsive strategy

**Desktop-first, by evidence, not by decree.** The frontend inventory confirms: the shell (`AppShell`, collapsible sidebar → mobile drawer below `lg`) is genuinely responsive; a handful of leaf components (`PageHeader`, `FormDrawer`, auth pages) have real breakpoint-aware `sx` styling; the two built-for-this-purpose hooks (`useIsMobile`/`useIsTablet`) have **zero call sites** anywhere in the app. Dense `DataGrid`-based admin screens are not verified usable at narrow widths.

**Recommendation**: authentication screens (already confirmed responsive — Login, Forgot/Reset Password, Accept Invitation) stay fully responsive, matching brief §26's explicit requirement, no further work needed. Administrative workflows (every list/detail/wizard screen in both consoles) remain **intentionally desktop-oriented** — this is a reasonable, evidence-based scope decision for an internal admin tool used by a small number of Platform Operators/Tenant Admins on real workstations, not a gap to close speculatively. The unused `useIsMobile`/`useIsTablet` hooks should either be wired into the one or two screens where a genuinely different narrow-width layout would help (long multi-column detail `Grid`s collapsing to single-column, primarily), or removed as dead code — leaving them unused indefinitely is a minor maintenance smell, not a UX gap.

## 7. Accessibility strategy

**What exists is real, not decorative**: `jest-axe` automated testing on 5 design-system components (`ConfirmDialog`, `DataTable`, `FormDrawer`, `Modal`, `PageHeader`) with a correctly-scoped rule config (document-level rules disabled only where they don't apply to isolated-component rendering — not a blanket suppression), `eslint-plugin-jsx-a11y` enforced at lint time, 32 files with explicit `aria-label` usage on icon-only controls, `role="status"`/`role="alert"` on loading/error states, `aria-labelledby` wiring on every dialog/drawer, and a real `<nav aria-label="Primary">`/`<ul>`/`<li>` sidebar structure.

**What's unverified**: the 5 tested components are the *design system's* primitives — the ~30 page-level screens built from them have not individually been run through `jest-axe`, and no custom keyboard-navigation (roving tabindex, focus-trap beyond what MUI's own `Dialog`/`Drawer` provide, skip-links) was found anywhere.

**Recommendation (P1, incremental, not a big-bang pass)**: extend the existing `jest-axe` pattern to page-level screens as they're touched for other reasons in this roadmap (the Applications/Service Accounts index pages being newly built, the Access Matrix being newly built, the dashboards being reworked) rather than a standalone accessibility-audit phase — this keeps the cost attributable to work already happening, consistent with how the existing 5-component coverage was clearly added incrementally rather than all at once.

## 8. Implementation roadmap

See `docs/PHASE_2UI1.md` §Roadmap for the phase-by-phase sequencing (this section intentionally does not duplicate it — the summary document is the single source of truth for phase numbers so they don't drift out of sync across five documents).
