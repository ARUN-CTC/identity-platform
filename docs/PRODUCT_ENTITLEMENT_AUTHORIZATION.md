# Product Entitlement Authorization

## 1. Permissions

| Code | Meaning |
|---|---|
| `PRODUCT_ENTITLEMENT_VIEW` | View a tenant's product entitlements |
| `PRODUCT_ENTITLEMENT_MANAGE` | Create entitlements and change their lifecycle status (including reactivate) |

Both `platform_only = TRUE` (`docs/adr/ADR-010-platform-operator-security-boundary.md`'s mechanism) — granted only via `platform_operator_permission`, never reachable through any tenant-scoped role (enforced by the same database trigger Phase 2B.1 introduced; no new enforcement mechanism needed).

**No separate permission per lifecycle action** (activate/suspend/revoke/reactivate) was introduced — a single `PRODUCT_ENTITLEMENT_MANAGE` covers all of them. Evaluated and rejected: splitting further (e.g., a distinct `PRODUCT_ENTITLEMENT_REVOKE`) would be exactly the kind of permission proliferation Phase 2B.1 already argued against for Platform Operator permissions generally — nothing in this phase's actual requirements distinguishes "may suspend" from "may revoke" as separate operator responsibilities.

## 2. Actor matrix

| Actor | Platform Product APIs | Tenant Entitlement APIs (`/platform/tenants/...`) | Tenant self-service read (`/v1/product-entitlements`) |
|---|---|---|---|
| Anonymous | DENY (401) | DENY (401) | DENY (401) |
| Normal tenant user (Membership, no special role) | DENY (401 — wrong auth path) | DENY (401) | ALLOW (own tenant only, RLS-scoped) |
| Tenant Admin (any tenant-scoped role, however broad) | DENY (401) | DENY (401) | ALLOW (own tenant only) |
| Platform Operator, no `PRODUCT_ENTITLEMENT_*` | ALLOW/DENY per their own product/application permissions | DENY (403) | N/A (no tenant context) |
| Platform Operator, `PRODUCT_ENTITLEMENT_VIEW` only | — | Read: ALLOW. Write: DENY (403) | N/A |
| Platform Operator, `PRODUCT_ENTITLEMENT_MANAGE` | — | ALLOW (any tenant) | N/A |
| Disabled Platform Operator | — | DENY (401, live status re-check) | N/A |

No cell is ambiguous — every row is tested directly (`tests/phase2b2-product-entitlement.e2e-spec.ts`, `tests/phase2b1-platform-operator.e2e-spec.ts`).

## 3. Why a Tenant Admin cannot self-grant entitlement (Security Invariant #13)

`TenantEntitlementsController` is `@Public()` (exempt from the tenant-scoped global `JwtAuthGuard`) with `PlatformJwtAuthGuard`/`PlatformPermissionsGuard` applied locally — a tenant-scoped access token (any role, any permission set) is rejected at the authentication layer, before any permission check runs, exactly the same mechanism Phase 2B.1 established for Product/Application administration. There is no code path by which holding every tenant-scoped permission grants any platform-scoped one. Tested explicitly, including the scenario where the Tenant Admin also happens to be the sole Organization Owner and holds every organization permission — none of that changes the outcome (`tests/phase2b2-product-entitlement.e2e-spec.ts`, "a Tenant Admin (however broad) is rejected outright").

## 4. Why the tenant self-service read needs no special permission

`GET /v1/product-entitlements` runs through the ordinary tenant-scoped guard chain, RLS-scoped to the caller's own tenant (`apply_tenant_rls` on `tenant_product_entitlement`) — a caller can only ever see their own tenant's rows, the same guarantee every RLS-protected read in this codebase already provides. Requiring a special permission for "can I see what my own company is entitled to" would be inconsistent with `GET /v1/organizations`'s own precedent (no special permission, self-scoped by RLS) and adds no real security value: the information ("your tenant can/cannot use Product X") is not sensitive relative to the tenant's own members.
