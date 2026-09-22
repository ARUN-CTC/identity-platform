# Identity Platform — UX Gap Analysis

Phase 2UI.1. Every finding below is source-verified (file + line, or a grep result) against the actual repository at commit `696bc1d`, not assumed. See `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md` for the target navigation this feeds, and `docs/IDENTITY_UX_ARCHITECTURE.md` for personas/journeys/design-system recommendations built on top of it.

## 1. Screen inventory (current state)

### Tenant Console (`/`)

| Route | Screen type | State |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation` | Auth forms | Built |
| `/dashboard` | Static quick-link tiles, zero metrics | Built (deliberately minimal) |
| `/settings` | — | **Unbuilt** (`PlaceholderPage`) |
| `/my-sessions` | Self-service list + revoke | Built |
| `/product-entitlements` | Read-only list | Built |
| `/users`, `/users/:id` | List + tabbed detail (Overview, Roles) | Built |
| `/organizations`, `/organizations/:id` | List + tabbed detail (Overview, Members) | Built |
| `/organization-types` | List/CRUD | Built (placement flagged — IA doc §4) |
| `/roles`, `/roles/:id` | List + tabbed detail (Overview, Permissions) | Built |
| `/permissions` | List/CRUD | Built |
| `/security/audit-events` | Two-tab list (Events, Login Attempts) | Built |
| `/tenant-settings` | Profile form | Built (no activate/suspend — by design) |
| — | Memberships (cross-organization) | **Does not exist** |
| — | Invitations (tracking list) | **Does not exist** |

### Platform Console (`/platform-console`)

| Route | Screen type | State |
|---|---|---|
| `/platform-console/login` | Auth form | Built |
| `/platform-console` | Static quick-link tiles, zero metrics | Built (deliberately minimal) |
| `/platform-console/tenants`, `/:id` | List + detail (profile, activate/suspend/delete) | Built |
| `/platform-console/tenants/:id/entitlements` | Full lifecycle (grant/suspend/activate/revoke/reactivate) | Built |
| `/platform-console/tenants/:id/service-account-grants` | List + status transitions | Built (create only from Application page) |
| `/platform-console/products`, `/:id` | List + detail (incl. nested Applications) | Built |
| `/platform-console/applications/:id` | Detail (config edit, nested Service Accounts) | Built |
| `/platform-console/operators`, `/:id` | List + detail (status, permission grants) | Built |
| `/platform-console/audit` | Single-tab platform event list | Built |
| — | Applications (standalone, cross-product) | **Does not exist** |
| — | Service Accounts (standalone, cross-application) | **Does not exist** |
| — | OAuth consent screen | **Does not exist** (no backend capability either — see §3) |
| — | Access Matrix | **Does not exist** |
| — | Platform Permission Catalog | **Does not exist** |
| — | Signing Keys | **Does not exist** (no backend capability) |
| — | Platform Configuration | **Does not exist** (no backend capability) |

## 2. UX Gap Matrix

| Area | Current State | Gap | Severity | Security Impact | Product Impact | Recommendation | Phase |
|---|---|---|---|---|---|---|---|
| Memberships | Nested per-organization only | No tenant-wide membership view | Medium | None | Admin can't audit membership across orgs without N clicks | New `GET /tenants/me/memberships` + list screen | P1 |
| Invitations | No tracking list; send is implicit | Can't see pending/expired invitations | Medium | Low (stale invitations are a minor exposure window, already time-bounded server-side) | Admin can't follow up on non-acceptance | New `GET /invitations` + list screen | P1 |
| Applications | Nested under Product only | No cross-product list/search | Medium | None | Slow at scale (many products) | New `GET /applications` + standalone route | P1 |
| Service Accounts | Nested under Application only, 3 clicks deep | No cross-application list; no delete UI | Medium | Low-Medium (harder to spot a stale/orphaned service account) | Same | New `GET /service-accounts` + standalone route | P1 |
| Client secret / Service Account credential rotation | One-time reveal at creation only | No rotation endpoint exists at all (server-side) | **High** | **High** — a leaked credential's only remedy today is create-new + manually retire old, with no guided flow | Product teams have no self-service recovery from a leaked secret | New rotation endpoint + UI flow | **P0** |
| Dashboards (both) | Static tiles, zero metrics, by design | No operational visibility (§24's 10 questions unanswered) | Medium | None | Operators can't spot anomalies without navigating into each list | New stats endpoint (partial); `meta.total` reuse (partial) — see §5 | P1 |
| Access Matrix | Does not exist | No single view of tenant×product×user access | Medium | None (RLS already enforces the real boundary; this is visibility, not access control) | Slower incident triage ("does this tenant have this product") | New aggregate endpoint + matrix UI | P1 |
| Platform Permission Catalog view | Free-text `permissionCode` entry only | Operator must already know exact code strings | Low | Low (typo → 400, fails closed, not a security hole) | Operator UX friction only | New filtered `/permissions` view or dedicated endpoint | P2 |
| Organization Types placement | Tenant-editable, "global" per its own copy | Possible cross-tenant data-integrity gap | **Unclassified — needs schema-level verification** | Unknown pending verification | Unknown pending verification | Verify tenant-scoping at schema level first | P0 (verify), then P1/P2 depending on finding |
| Audit log filtering | Event-type + actor-id only | No date-range filter anywhere (tenant or platform) | Medium | Medium — an incident investigation ("what happened between 2am-4am") can't be scoped server-side, must page through everything | Slower incident response | Add `from`/`to` to all 3 audit DTOs | P1 |
| List search/sort (Tenants, Products, Organizations, Applications, Service Accounts, Operators) | Pagination only; `sortBy`/`sortOrder` accepted but silently ignored by 5 of 8 repos | No way to find a specific row by name at scale; misleading DTO (accepts params it drops) | Medium | None | Real UX pain once row counts grow (already true in this dev DB — 1,500+ test tenants/products) | Add search where missing; wire `sortBy`/`sortOrder` or remove the dead DTO fields | P1 |
| `/settings` (tenant personal settings) | `PlaceholderPage` | Unbuilt | Low | None | Minor — users can't self-manage profile/preferences | Build or explicitly scope out | P2 |
| `KpiCard` component | Built, fully styled, zero usages | Dead code, but ready-made for dashboard work | N/A | None | None (positive: reduces cost of §5's dashboard work) | Reuse, don't rebuild | — |
| OAuth consent screen | Does not exist; every Application is implicitly trusted | Every registered Application is first-party by construction — see §3 | Low (today) | **Medium if a 3rd-party/less-trusted Application is ever onboarded** | None for TravelOS/Banking AI/QueueStream (all first-party) | Defer; document the trust assumption explicitly | P2 (revisit if a non-first-party Application is ever planned) |
| Responsive data-dense screens | Shell is responsive; DataGrid-heavy pages not verified at narrow widths | Unverified mobile usability for admin tables | Low | None | Admin work is desktop-first by nature; low priority | Spot-check, don't redesign | P2 |
| Accessibility | `jest-axe` covers 5 design-system components; not the ~30 page-level screens | Partial automated coverage | Medium | None (a11y gaps are usability/compliance, not security) | Real users with assistive tech may hit unverified pages | Extend `jest-axe` coverage to page-level screens incrementally | P1 |

## 3. API / Backend Gap Table

Every row is a direct read of the controller/DTO — see the two inventory passes this document is built from for exact file:line citations.

| Feature | UI requirement | Existing API | Status | Backend gap | Recommended phase |
|---|---|---|---|---|---|
| Cross-organization membership list | `GET /tenants/me/memberships` | `GET /organizations/:id/members` (per-org only) | **NOT SUPPORTED** | New aggregate endpoint | P1 |
| Invitation tracking | `GET /invitations?status=` | none | **NOT SUPPORTED** | New endpoint | P1 |
| Cross-product Application list | `GET /applications?productId=&search=` | `GET /products/:id/applications` (scoped) | **NOT SUPPORTED** | New endpoint | P1 |
| Cross-application Service Account list | `GET /service-accounts?applicationId=&search=` | `GET /applications/:id/service-accounts` (scoped) | **NOT SUPPORTED** | New endpoint | P1 |
| Client secret rotation | `POST /applications/:id/rotate-secret` | none — comment in `update-application.dto.ts` calls it "deliberately not built" | **NOT SUPPORTED** | New endpoint (with old-secret-grace-window design) | **P0** |
| Service account credential rotation | `POST /service-accounts/:id/rotate-credential` | none | **NOT SUPPORTED** | New endpoint | **P0** |
| Tenant/Product search-by-name | Search box on `/platform-console/tenants`, `/platform-console/products` | `GET /platform/tenants`, `GET /products` — no `search` field on either DTO, `sortBy` accepted but ignored | **NOT SUPPORTED** | Add `search` param + repo query; wire `sortBy`/`sortOrder` or remove | P1 |
| Access Matrix (tenant × product × user) | One aggregate view | `GET /product-entitlements` (tenant-scoped, self), `GET /platform/tenants/:id/product-entitlements` (per-tenant), `GET /products/:id/applications` — no join | **NOT SUPPORTED** (composable client-side only, doesn't scale) | New aggregate endpoint | P1 |
| Dashboard counts (tenants/users/products/entitlements) | KPI tiles | `meta.total` on every existing paginated list | **PARTIALLY SUPPORTED** — one call per metric, no single aggregate call | Optional: one `/platform/stats` endpoint to replace N calls | P2 (nice-to-have; §5 below shows it's not blocking) |
| Authentication/OAuth health metrics | "Auth health", "OAuth health" dashboard tiles | Audit events exist but have no date-range filter, no success/fail aggregate | **NOT SUPPORTED** | New aggregate endpoint (e.g. last-24h success/fail counts) | P1 |
| Audit date-range filtering | "Show events between X and Y" | `LoginAttemptQueryDto`, `SecurityEventQueryDto`, `PlatformAuditQueryDto` — none has `from`/`to` | **NOT SUPPORTED** | Add to all 3 DTOs | P1 |
| Platform permission catalog | Picker instead of free-text `permissionCode` | `POST /platform/operators/:id/permissions` takes raw string; no dedicated platform-permission-list endpoint found | **NOT SUPPORTED** | New endpoint or filter on existing `/permissions` | P2 |
| Bulk operations (any) | Bulk invite, bulk grant, bulk entitle | None anywhere — confirmed via `grep bulk\|batch` returning zero matches across every controller | **NOT SUPPORTED** | Case-by-case; not urgent for admin-tool usage patterns | P2 |
| OAuth consent | Consent screen backing | `ConsentPolicy` interface exists but is confirmed **inert** — zero implementations, zero registry, zero call sites | **NOT SUPPORTED** | Deliberately deferred (every Application is currently first-party/trusted) | P2, revisit only if a non-first-party integrator appears |
| MFA / Passkeys / SSO / SAML | — | Confirmed absent (`grep -i "mfa\|totp\|passkey\|webauthn\|saml\|sso"` → zero matches) | **NOT SUPPORTED** | Out of scope per brief §34 (explicitly do not add) | Deferred |

## 4. The Access Matrix — precise design, and why it can't collapse concepts

Brief §14 gives an example matrix (Tenant Access row + per-user rows, columns = products, cells = ✓/✗). Brief §11 separately warns: *"Do NOT collapse Identity Membership, Product Role, Product Permission."* Both must hold simultaneously, so the matrix's semantics need to be exact:

```text
Cell(user, product) = TenantEntitlement(tenant, product).status == ACTIVE
                       AND Membership(user, tenant).status == ACTIVE
```

That is the **entire** meaning of a checkmark. It is composed from exactly two Identity-owned facts — tenant entitlement status and membership status — and explicitly excludes anything about what the user can actually DO inside that product (that's the product's own RBAC, which Identity Platform has no visibility into and must not claim to represent). The click-through "explanation" panel (§14) shows exactly those two facts plus which Organization the membership is under and which Application(s) exist for that product — never a product-internal permission or role name, because Identity Platform doesn't have that data and inventing it would violate the platform boundary in §2/§23.

**This cannot be built from existing endpoints without an N+1 client-side composition** (fetch every tenant's entitlements, then every product's applications, then cross every user's membership status) — infeasible at real scale (the dev database already has 1,541 test tenants and 1,291 test products; a real customer base will be smaller but the pattern still doesn't belong client-side). **Recommendation: a dedicated read endpoint** — e.g. `GET /platform/tenants/:id/access-matrix` returning `{product, applications[], entitlementStatus}[]` joined with membership status per user on request — is P1, not a UI task alone.

## 5. Dashboard — what's answerable today vs. what needs new backend work

Brief §24 asks for 10 specific operational questions. Splitting them by actual buildability, using the confirmed fact that **every existing paginated list already returns `meta.total` for free**:

| Question | Buildable today (zero backend change) | Needs new backend work |
|---|---|---|
| 1. How many tenants? | ✅ `GET /platform/tenants?limit=1` → `meta.total` | — |
| 2. How many users? | ⚠️ Partial — `GET /users` is tenant-scoped; a **platform-wide** user count needs a new endpoint (no platform-level users list exists) | ✅ new endpoint needed for the platform-wide count |
| 3. How many active memberships? | ⚠️ Partial — same issue, no platform-wide aggregate | ✅ |
| 4. Which products are active? | ✅ `GET /products?limit=100` filtered client-side by `status` | — (works today; a `status` filter param would be cleaner but isn't blocking) |
| 5. Which tenants have which products? | ❌ This IS the Access Matrix (§4) | ✅ |
| 6. Authentication health? | ❌ No success/fail aggregate, no date-range | ✅ |
| 7. OAuth health? | ❌ Same | ✅ |
| 8. Suspended/revoked entitlements? | ⚠️ Partial — per-tenant only (`GET /platform/tenants/:id/product-entitlements`), no platform-wide count of "how many entitlements are SUSPENDED right now across all tenants" | ✅ for the aggregate; the per-tenant view already exists |
| 9. Security events (recent, notable)? | ✅ `GET /platform/audit-events?limit=10` (most-recent, unfiltered by severity since none is tracked) | — |
| 10. Actions requiring attention? | ❌ No such concept exists anywhere (no "flagged"/"needs review" state on any entity) | ✅ — and this one needs a product decision (what counts as "needs attention"), not just an endpoint |

**Recommendation**: ship the dashboard in two passes. Pass 1 (P1, no backend work) wires the already-built, already-unused `KpiCard` component to rows 1, 4, 9 above — a real, honest improvement over the current static tiles, using data that already exists. Pass 2 (P1/P2, needs the new endpoints from §3) fills in rows 2/3/5/6/7/8/10 once those endpoints exist. **Do not ship a dashboard that fakes rows 2/3/5/6/7/8/10 from `meta.total` gymnastics** — the prior phase's own restraint (refusing to fabricate metrics) was correct and should continue to hold until the real data exists.

## 6. Severity legend

```text
P0 = required before this can be called an operational Identity Control Plane for multiple products
     (client-secret rotation has no remedy today, and the Organization Types tenant-boundary question
     is unverified — both are P0 not because they block onboarding, but because leaving either
     unresolved is an active risk/unknown, not a missing nice-to-have)
P1 = required for a mature multi-product platform (TravelOS + Banking AI + QueueStream operating
     side by side, with real operational visibility)
P2 = future enhancement — genuinely optional, would not block any of the three target products
```
