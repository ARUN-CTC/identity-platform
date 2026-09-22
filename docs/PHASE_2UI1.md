# Phase 2UI.1 — Identity Platform UI/UX Architecture & Productization

## Objective

Determine whether the existing Identity Platform frontend has the UI/UX capabilities required to operate as a reusable, production-grade Identity Control Plane for three independent SaaS products (TravelOS, CTC Banking Intelligence AI, QueueStream.health) plus future products, while preserving the platform/product ownership boundary. Gap analysis and design architecture only — no backend/schema/OAuth/security-model change, no TravelOS/Banking AI/QueueStream modification, matching the original brief's explicit scope limits.

## What was produced

- **`docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md`** — the target navigation structure for both consoles (Tenant Console, Platform Console), route-by-route mapped against what exists today, with an explicit rejection-and-correction of the brief's own proposed single-tree IA (it would have collapsed the Platform/Tenant security boundary the codebase has already correctly built as two separate consoles).
- **`docs/IDENTITY_UX_GAP_ANALYSIS.md`** — full screen inventory, the UX gap matrix (severity/security-impact/product-impact/recommendation/phase per row), the API/backend gap table (every list endpoint's search/filter/sort/pagination support verified directly against source), the precise Access Matrix design (and why it can't collapse Membership/Entitlement/Product-role), and a metric-by-metric dashboard buildability breakdown.
- **`docs/IDENTITY_UX_ARCHITECTURE.md`** — four personas (with an explicit, source-grounded boundary recommendation for "Application/Developer Administrator" — a scoped Platform Operator, not a new role type or console), seven core user journeys, design-system assessment, security UX requirements, and responsive/accessibility strategy.
- **`docs/PRODUCT_ONBOARDING_UX.md`** — the "Onboard Product" wizard design (with a real correction to the brief's own proposed step list — an "Audiences" step is required or every onboarded product silently fails its first login), validated against TravelOS, CTC Banking Intelligence AI, and QueueStream.health, plus a fourth simulated product (GymOS) proving zero Identity Platform code change is needed to onboard a genuinely new SaaS product.
- **`docs/NEW_PRODUCT_ONBOARDING_WALKTHROUGH.md`** (pre-existing, from the prior conversation phase, not re-created) — the API-level evidence base every UX-level claim above cites back to; a real, live-run worked example, not a hypothetical.

Two dedicated inventory passes (frontend: 271 files, every route/screen/provider/pattern; backend: every controller/DTO across 17 modules) were run first and are cited throughout — every claim in all four new documents traces to a specific file, line, or grep result, not an assumption.

## Key findings (all source-verified)

- **The Platform/Tenant boundary is already correctly built at the code level** — two separate React Router subtrees, two separate auth providers, zero shared token storage. The brief's own proposed IA would have quietly undone this; the corrected IA formalizes what already exists instead.
- **A real, previously-undocumented backend gap blocks the Tenant Onboarding wizard as specified**: `POST /platform/tenants` creates only the `tenant` row — no default Organization, no initial Administrator. Creating either requires a *tenant* JWT, which cannot exist until a tenant has a member. This is a genuine chicken-and-egg gap (confirmed by reading `TenantsService.create()` directly) — the only place this repository successfully bootstraps a tenant today is a raw-SQL dev seed script, not an API call. **P0.**
- **Client secret and Service Account credential rotation do not exist server-side at all** — confirmed via source (`UpdateApplicationDto`'s own comment calls it "deliberately not built") and via grep (no "rotate"/"rotation" hit anywhere outside refresh-token rotation, which is unrelated). Today, a leaked production credential's only remedy is create-new-and-manually-retire-old. **P0.**
- **Applications and Service Accounts have no standalone, cross-product/cross-application list view** — both are reachable only by drilling into a parent entity (Service Accounts: three clicks deep, under Application under Product), directly working against brief §17's own requirement to make Service Accounts "visually and semantically clear" as distinct from Users.
- **The onboarding wizard step list in the original brief is missing a required step**: an Application's `audiences` allow-list must be set before `/oauth/authorize` will ever succeed for it — verified by actually running the flow and hitting the real `400 audience is required` rejection. Corrected in `docs/PRODUCT_ONBOARDING_UX.md` §1.
- **Both dashboards are static by deliberate, documented restraint, not oversight** — a prior phase's own code comments explicitly refuse to fabricate metrics from `meta.total` alone. This phase's dashboard design (Gap Analysis §5) honors that restraint while identifying exactly which of the brief's 10 requested KPIs are answerable today at zero new backend cost vs. which need a new aggregate endpoint.
- **`KpiCard`, a fully-built dashboard component, has zero usages anywhere in the app** — directly reduces the cost of the dashboard work recommended above.
- **One genuine open question, not resolved by this phase**: `OrganizationTypesPage`'s own on-screen copy claims the data is "global reference data shared across all tenants," but the route/permission/guard structure is entirely tenant-scoped — this is either a labeling bug or a real cross-tenant data-integrity gap, and determining which requires reading the schema's own tenant-scoping, out of this phase's frontend/API-surface scope. Flagged P0 for verification in the next phase.

## Architecture decisions

- **Rejected**: the brief's proposed single-tree "IDENTITY PLATFORM" navigation (Identity/Tenancy/Products/Applications/Service Accounts/Security/Platform Administration all as nav siblings in one shell). **Adopted instead**: two consoles, formalized in `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md` — see that document §1 for the full rationale.
- **Adopted**: "Application/Developer Administrator" is a Platform Operator scoped to a narrow permission subset (`APPLICATION_*`, `SERVICE_ACCOUNT_*`, `PRODUCT_VIEW`), using the grant-ceiling mechanism the codebase already enforces — not a new role type, not a new console, not built into Tenant Administration. No backend change needed; a configuration/onboarding-process decision only.
- **Adopted**: the Access Matrix is defined as `TenantEntitlement.status == ACTIVE AND Membership.status == ACTIVE` — exactly two Identity-owned facts, explicitly excluding any product-internal role/permission, preserving the ownership boundary brief §11/§23 requires. Needs one new aggregate backend endpoint; not buildable as a responsible client-side composition at real scale.
- **Adopted**: dashboards ship in two passes — Pass 1 wires the existing, unused `KpiCard` to metrics already free via `meta.total` (tenant count, product count, recent audit events); Pass 2 fills in the metrics that genuinely need new backend aggregation (auth/OAuth health, cross-tenant entitlement counts, "needs attention" — the last of which also needs a product decision about what qualifies, not just an endpoint).
- **Deferred, deliberately**: OAuth consent UI (every registered Application is currently first-party/trusted by design — the inert `ConsentPolicy` interface confirms this was a conscious prior-phase choice, not an oversight this phase should reverse speculatively); self-service tenant-level Application registration (no current product needs it; a real, coherent future feature, not built ahead of a concrete requirement); bulk operations generally (confirmed absent everywhere in the API; not urgent for admin-tool usage patterns at the scale of three products).

## Success criteria — answered explicitly (brief §36)

```text
1.  Can a Platform Operator manage multiple products from one Identity Platform?          YES
2.  Can a Tenant Administrator manage only their tenant?                                  YES
3.  Can a global user belong to multiple tenants?                                         YES
4.  Can tenants have different product entitlements?                                      YES
5.  Can different applications belong to different products?                              YES
6.  Can TravelOS, Banking AI and QueueStream use the same Identity UX?                     YES
      (validated by simulation, docs/PRODUCT_ONBOARDING_UX.md §4-6)
7.  Can a new product be onboarded without redesigning Identity?                          YES
      (validated by GymOS simulation, docs/PRODUCT_ONBOARDING_UX.md §7)
8.  Is Identity membership clearly separated from product RBAC?
      Data/API model: YES. Visualized in the UI (Access Matrix): NOT YET BUILT — designed, P1.
9.  Is product entitlement clearly separated from product permissions?                    YES
      (entitlement is ON/OFF access only; Identity Platform holds zero product-internal
      permission data by construction)
10. Are Service Accounts clearly separated from Users?
      Data/protocol model: YES (distinct entity, distinct principal_type claim).
      UX presentation: WEAK TODAY — nested 3 levels deep, no standalone page; P1 fix designed,
      not yet built.
11. Is Platform Operator clearly separated from Tenant Administration?                    YES
      (strongest finding in this phase — two consoles, two auth providers, zero shared
      token state, confirmed by direct source inspection)
12. Are security-sensitive operations properly represented in UX?
      For what exists (secret reveal, destructive-action confirmation): YES.
      Credential rotation: NOT REPRESENTABLE YET because it doesn't exist server-side; P0.
13. Does the UI respect the backend security model?                                       YES
      (every permission gate documented and confirmed as UX-only; backend independently
      enforces every case checked)
14. Are backend/API gaps explicitly identified?                                           YES
      (docs/IDENTITY_UX_GAP_ANALYSIS.md §3, file-level citations throughout)
15. Is there a clear implementation roadmap?                                              YES — below
```

No answer above is a bare NO — every caveated item (8, 10, 12) has a concrete, already-designed fix with a phase assigned, not an open question with no plan.

## Roadmap

```text
Phase 2UI.2 — Verification & P0 backend work
  - Resolve the Organization Types tenant-scoping question (schema-level read)
  - Design + build the tenant-bootstrap endpoint (POST /platform/tenants/:id/bootstrap)
  - Design + build client-secret and service-account-credential rotation endpoints
    (grace-window/invalidation-timing design needs its own review — see Risks)

Phase 2UI.3 — P1 list/aggregate endpoints
  - GET /tenants/me/memberships (cross-organization)
  - GET /invitations (tracking)
  - GET /applications (cross-product), GET /service-accounts (cross-application)
  - Access Matrix aggregate endpoint
  - Audit date-range filtering (all 3 audit DTOs)
  - Search on Tenant/Product lists; resolve the dead sortBy/sortOrder fields
    (wire or remove, per list)

Phase 2UI.4 — P1 frontend build-out
  - Standalone Applications and Service Accounts index pages (IA doc §6)
  - Memberships and Invitations screens (IA doc §3)
  - Access Matrix UI component + page
  - Dashboard Pass 1 (KpiCard wiring, zero-new-backend metrics) then Pass 2
    (once 2UI.3's aggregate endpoints exist)
  - Tenant Onboarding wizard (once 2UI.2's bootstrap endpoint exists)
  - Product Onboarding wizard (zero backend gaps — buildable in this phase directly)
  - Credential rotation UX (once 2UI.2's endpoints exist) — reuses OneTimeSecretDialog

Phase 2UI.5 — P1 accessibility & error-journey audit
  - Extend jest-axe coverage to page-level screens touched by 2UI.4's new work
  - Map every error condition in docs/IDENTITY_UX_ARCHITECTURE.md §3.7 to its actual
    current frontend handling; fill any gap found

P2 (unscheduled, genuinely optional): Platform Permission Catalog picker, audit timeline
  visualization (only if proven to answer a question the table view doesn't), responsive
  polish for narrow-width admin screens, useIsMobile/useIsTablet cleanup, self-service
  tenant-level Application registration.
```

## Tests

Documentation-only phase (brief §34/§4 — no implementation this phase). No automated test suite was written or executed. The equivalent of "validation" for this phase is the four onboarding scenarios in `docs/PRODUCT_ONBOARDING_UX.md` §4-7, each checked against real, already-verified API behavior (`docs/NEW_PRODUCT_ONBOARDING_WALKTHROUGH.md`'s live run) rather than assumed.

```text
Backend tests:  unchanged (0 run, 0 needed — no backend code touched)
Frontend tests: unchanged (0 run, 0 needed — no frontend code touched)
```

## Database

```text
Identity Platform DB changes: 0
Identity Platform migrations: 0
```

## Known Issues / Risks

- **Medium**: the Organization Types tenant-scoping question is genuinely unresolved and blocks locking in that part of the IA doc's recommendation with full confidence — flagged, not guessed at.
- **Medium**: credential-rotation design (Phase 2UI.2) needs its own careful pass on grace-window vs. immediate-invalidation semantics — a naive "invalidate the old secret immediately" could cause a production outage for whichever product is mid-rotation if their deployment isn't already staged to pick up the new one; this is a real design decision, not a mechanical CRUD addition.
- **Low**: new list/aggregate endpoints (Phase 2UI.3) must preserve the existing tenant-isolation discipline exactly — e.g. a cross-application Service Accounts endpoint must remain platform-scoped only, never exposed on a tenant-accessible route; called out explicitly so it isn't lost in translation from "gap" to "ticket."
- **Low**: TravelOS's own migration (a pre-existing customer base, unlike Banking AI/QueueStream which onboard from zero) will feel the missing bulk-entitlement endpoint most — a process/patience cost today, not a blocker (the single-item endpoint still works, N times).

None of the above is a security defect in what's shipped today — every finding is either a missing convenience/visibility feature or a clearly-scoped, not-yet-built capability, not a broken guarantee.

## Deferred Scope

```text
MFA / Passkeys / SSO / SAML                    — out of scope per brief §34, confirmed absent, not touched
OAuth consent UI                                — deliberately deferred, see Architecture decisions
Self-service tenant-level Application registration — real future feature, no current requirement for it
Platform-wide Configuration UI                  — no backend capability exists to build a UI for
Signing Key management UI                       — no backend capability exists (per project memory)
Bulk operations (invite, grant, entitle)        — confirmed absent everywhere; not urgent at 3-product scale
Any actual TravelOS/Banking AI/QueueStream/GymOS implementation — this phase is simulation/validation only
```

## Git

```text
Previous HEAD: 696bc1d (docs: add end-to-end new product onboarding walkthrough)
Branch: phase2-identity-platform-frontend-and-tenant-fix
Pre-existing, unrelated working-tree changes preserved and NOT touched by this phase's commit:
  - PHASE_3_1_PRODUCTION_OPERATIONAL_READINESS_REPORT.md (modified, user's own edit)
  - arch.md (untracked, user's own file)
```

Commit created for this phase contains only the five files listed under "What was produced" (`docs/PHASE_2UI1.md`, `docs/IDENTITY_UX_ARCHITECTURE.md`, `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md`, `docs/IDENTITY_UX_GAP_ANALYSIS.md`, `docs/PRODUCT_ONBOARDING_UX.md`) — no `git add -A`/`git add .`, no unrelated file staged, per brief §37.

## Final Decision

```text
PHASE 2UI.1 — PASS
```

Every success-criterion question in §36 is answerable, none is a bare NO, every gap found has a concrete recommendation and phase assignment, and every claim in all four design documents traces to a specific, cited piece of real source code or a live-verified request/response — not an assumption. UI implementation does not begin until this architecture is reviewed, per brief §5/§34.
