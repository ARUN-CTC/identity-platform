# Identity Platform Console — Platform Operator Surface

Phase 2UI.3. The operational reference for the Platform Console (`/platform-console/*`) as actually built — every route, every screen's real capability, the security model, and the honest boundary between what's backed by a real API today and what's a documented gap. Builds on `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md` (the target IA from Phase 2UI.1) and `docs/TENANT_BOOTSTRAP.md`/`docs/CREDENTIAL_ROTATION.md` (the Phase 2UI.2 backend this UI calls). Does **not** cover the Tenant Admin Console (`/*` for a tenant user) — that's Phase 2UI.4, explicitly out of scope here.

## 1. The security boundary, as built

Two consoles, never merged, exactly matching the governing principle from Phase 2UI.1's own IA correction:

```text
/                              /platform-console
Tenant Console                 Platform Console
AuthProvider                   PlatformAuthProvider
tenant JWT                     platform operator JWT
```

`PlatformShell` (the console's own chrome) is reachable only through `PlatformProtectedRoute` → `PlatformPermissionRoute`, both reading exclusively from `PlatformAuthProvider` — there is no code path from a tenant session into this tree, and no code path from a Platform Operator session into the tenant app. A tenant administrator cannot reach this console by manipulating a route: `PlatformProtectedRoute` redirects to `/platform-console/login` unconditionally for anyone without a valid platform access token, and the backend's own `PlatformJwtAuthGuard` rejects a tenant JWT with 401 regardless of what the frontend does — verified previously (Phase 2UI.2's own e2e suite, `tests/phase2ui2-admin-foundation-credential-lifecycle.e2e-spec.ts`) and re-confirmed structurally unchanged this phase (no route, guard, or provider in this tree was modified to accept anything but a genuine platform token).

Frontend permission checks (`hasPlatformPermission`, `PlatformPermissionRoute`) are UX-only — every mutating action's real authorization is the backend's own `RequirePlatformPermissions` decorator, unchanged and unweakened by this phase.

## 2. Routes and screens, exactly as shipped

| Route | Screen | Backing API | State |
|---|---|---|---|
| `/platform-console/login` | Login | `POST /platform/auth/login` | Unchanged |
| `/platform-console` | Dashboard | `meta.total` on tenants/products lists, last 5 platform audit events | **Enhanced this phase** — real KPI tiles, no fabrication |
| `/platform-console/tenants` | Tenant Registry (list) | `GET /platform/tenants` | Unchanged |
| `/platform-console/tenants/:id` | Tenant Detail | `GET/PATCH/activate/suspend/delete /platform/tenants/:id` | **Enhanced this phase** — bootstrap CTA + wizard |
| `/platform-console/tenants/:id/entitlements` | Product Access | `GET/POST/PATCH/reactivate .../product-entitlements` | **Enhanced this phase** — per-row expandable "basis" |
| `/platform-console/tenants/:id/service-account-grants` | Service Account Grants | `.../service-account-grants` | Unchanged |
| `/platform-console/products` | Products (list) | `GET /products` | Unchanged |
| `/platform-console/products/:id` | Product Detail (incl. nested Applications) | `GET /products/:id`, `GET/POST /products/:id/applications` | Unchanged |
| `/platform-console/applications/:id` | Application Detail (incl. nested Service Accounts) | `GET/PATCH /applications/:id`, `GET/POST .../service-accounts` | **Enhanced this phase** — credential rotation (both levels) |
| `/platform-console/operators` , `/operators/:id` | Platform Operators | `.../operators` | Unchanged |
| `/platform-console/audit` | Platform Audit | `GET /platform/audit-events` | Unchanged |
| `/platform-console/users` | Users | — | **New — documented API gap** |
| `/platform-console/memberships` | Memberships | — | **New — documented API gap** |
| `/platform-console/invitations` | Invitations | — | **New — documented API gap** |
| `/platform-console/applications` | Applications (cross-product index) | — | **New — documented API gap**, workaround link to Products |
| `/platform-console/service-accounts` | Service Accounts (cross-application index) | — | **New — documented API gap**, workaround link to Products |
| `/platform-console/signing-keys` | Signing Keys | `GET /.well-known/jwks.json` (public) | **New — real, read-only** |
| `/platform-console/configuration` | Configuration | — | **New — deliberate non-gap** (§7) |

## 3. Navigation — grouped sections

`platformNavigation` (`src/platform-console/navigation.ts`) is now a list of sections, not a flat list — Identity / Tenancy / Products / Applications / Service Accounts / Security / Platform, matching the corrected target IA. `PlatformShell` renders each section under a `ListSubheader`. Every item whose route is a documented API gap carries `apiGap: true`, rendered as a small "soon" chip with a tooltip pointing back to this document — visible discoverability of what's coming, never a silent dead end, but also never a functioning-looking screen that secretly does nothing.

## 4. Tenant Bootstrap — the UI for Phase 2UI.2's backend

`TenantBootstrapWizard` (`src/platform-console/features/tenants/TenantBootstrapWizard.tsx`), opened from a prominent `Alert` on Tenant Detail whenever `tenant.status === 'PROVISIONING'`. Four real steps (Organization → Administrator → Product access → Review) — no "Tenant Information" step, since the tenant already exists by the time this wizard runs (created via the pre-existing `PlatformTenantFormDrawer`, unchanged). One network call at the end (`POST /platform/tenants/:id/bootstrap`), matching the backend's own atomicity — never several uncontrolled calls standing in for the one transactional endpoint.

Security-relevant details, all verified by the new test suite (`PlatformTenantDetailPage.test.tsx`):
- No password field anywhere — the wizard collects only email/name; the administrator sets their own password via the standard invitation flow, exactly matching `docs/TENANT_BOOTSTRAP.md`'s own design.
- A 409 (already bootstrapped, concurrent bootstrap, wrong tenant status) is shown verbatim inside the still-open wizard — never silently swallowed, never closes the dialog on failure.
- Product selection is genuinely optional and uses the real, currently-registered ACTIVE product catalog (`GET /products`) — no invented product list.

## 5. Credential rotation — the UI for the other half of Phase 2UI.2

Both `PlatformApplicationDetailPage` (client secret) and the same page's nested Service Account rows (credential) now have a "Rotate" action. Every rule from the governing brief's §19/§40 is implemented and test-covered (`PlatformApplicationDetailPage.test.tsx`, "credential rotation" suite):

- **Confirmation required** — `useConfirm()`, the same imperative pattern every other destructive action in this console already uses, with the exact wording: *"Rotating this credential will immediately invalidate the existing one — there is no overlap window..."* Cancelling makes zero network requests.
- **One-time reveal** — reuses `OneTimeSecretDialog` unchanged in mechanics, with a new optional `title` prop so a rotation reads "...was rotated" rather than "...created successfully."
- **Never persisted** — verified directly in tests: `localStorage.length === 0` and the raw secret string never appears in `sessionStorage` after a rotation completes.
- **Unrecoverable after close** — closing the reveal dialog removes the secret from all component state; nothing on the page offers to show it again (there is no backend endpoint that could serve it again either).
- **Eligibility respected** — the Rotate button is disabled (not hidden) for a `PUBLIC` application (no secret exists) or a non-`ACTIVE` resource, with an inline explanation rather than a silent disable.
- **409 surfaced verbatim** — a concurrent-rotation conflict shows the backend's own message, never a generic "something went wrong."

## 6. Product Access / Access Matrix — scoped to what's real

Brief §15 asks for a tenant × product × user Access Matrix. The backend has no endpoint joining entitlement + membership + organization data (confirmed, `docs/PHASE_2UI1.md`'s own gap analysis, unchanged this phase). Rather than fabricate per-user rows, this phase delivers exactly the **real** half of that matrix — the tenant-level "access" row the brief's own example leads with (`Tenant Access ✓ ✓ ✗`) — at `/platform-console/tenants/:id/entitlements`, now relabeled "Product Access" with an explicit `Alert` stating the per-user limitation and a click-to-expand "basis" panel per product showing exactly what that access is grounded in (entitlement status, granted/changed timestamps) — matching the brief's own example format (*"TravelOS ACTIVE — Basis: Tenant Product Entitlement: ACTIVE"*) using only data that's genuinely available. No product-internal permission (e.g. `TRAVEL_BOOKING_CREATE`) is ever shown or implied — this platform has no visibility into that, by design.

## 7. Platform Configuration — a deliberate non-gap

Unlike Users/Memberships/Invitations/Applications-index/Service-Accounts-index (real gaps — the capability *should* exist but the endpoint doesn't yet), Configuration is listed separately in `docs/PHASE_2UI3.md`'s own gap table as a **deliberate absence**: per the governing brief's own §26, this console must never expose editing of JWT secrets, private keys, database configuration, or other runtime cryptographic material unless a secure backend workflow explicitly supports it — none does, by design (every such value is an environment variable, validated at boot, never readable/writable via any API). The page states this plainly rather than either building a fake settings form or silently omitting the nav item the target IA calls for.

## 8. Design system additions

- `EmptyState` gained a sixth variant, `"not-available"` — semantically distinct from `"no-data"` (zero rows today vs. no endpoint exists at all), used by every documented-gap screen.
- `PlatformApiGapPage` (`src/platform-console/components/`) — the single, reusable "this needs a backend endpoint" screen, used by all six gap pages rather than six near-duplicate hand-rolled ones.
- `OneTimeSecretDialog` gained an optional `title` override, backward-compatible (existing creation-flow call sites unchanged).
- `KpiCard` — pre-existing, previously unused anywhere in the app (a Phase 2UI.1 finding) — now wired into the Dashboard for the first time.

## 9. What this phase deliberately did not touch

No OAuth grant type, PKCE requirement, or client-authentication rule was changed — `ApplicationFormDrawer`/`ApplicationConfigDrawer`'s existing policy enforcement (server-side, mirrored client-side) is unchanged; this phase only clarified the Audiences field's helper text (§10). No new frontend authentication mechanism was introduced — every new screen uses the existing `PlatformAuthProvider`/`platformApiRequest` unchanged. No Tenant Admin Console route (`/tenant/*` or equivalent) was added. No end-user auth screen (login/forgot-password/OAuth consent) was built or modified — those are Phase 2UI.5's own scope, and none already existed in the Platform Console to begin with (this console requires a Platform Operator's own separate login, never a tenant/end-user flow).

## 10. Audience configuration — clarified, not rebuilt

Per the governing brief's explicit request ("Explain clearly: Audience ≠ Client ID ≠ Scope ≠ Permission"), both `ApplicationFormDrawer` and `ApplicationConfigDrawer`'s Audiences field helper text was extended to state this distinction directly, and to name the concrete, live-verified consequence of leaving it empty (every `/oauth/authorize` request for that application fails). No new validation was added on the frontend — `ApplicationAudiencePolicy`'s real rules (no wildcards, no duplicates, no empty entries) are enforced server-side exactly as before; the frontend has never re-implemented that policy and continues not to.
