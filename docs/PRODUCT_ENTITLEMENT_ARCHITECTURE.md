# Product Entitlement Architecture

Phase 2B.2. See `docs/adr/ADR-011-product-entitlement-model.md` for the core decision, `docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md` for state-machine detail, `docs/PRODUCT_ENTITLEMENT_AUTHORIZATION.md` for the permission model.

## 1. Three concepts, never conflated

```text
MEMBERSHIP        = does this user belong to this organization?           (Phase 2A)
PRODUCT ENTITLEMENT = is this tenant permitted to use this product?       (this phase)
AUTHORIZATION     = what can this user do within the product?            (Phase 1/2A RBAC + each product's own enforcement)
```

No code path derives one from another. A tenant can be fully entitled to TravelOS while a specific user has zero Membership anywhere in that tenant (denied — no membership). A user can be a Tenant Admin with every organization permission while their tenant has no entitlement to a product at all (denied — no entitlement). Both checks are independent and both must pass; neither can substitute for the other. This is Security Invariants #1–#2, #11–#12 (`docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md` §6).

## 2. The model

`TenantProductEntitlement` — one row per `(tenantId, productId)`:

```text
tenant_product_entitlement
---------------------------
id
tenant_id      -- -> tenant
product_id     -- -> product
status         -- ACTIVE | SUSPENDED | REVOKED
created_at / created_by / updated_at / updated_by / version
UNIQUE(tenant_id, product_id)
```

Tenant-level, not Organization-level — see ADR-011 for why, and §"Organization-level decision" below for the specific proof the brief demanded.

## 3. Entitlement is not billing

No invoices, plans, pricing, metering, payment providers, or renewal logic exist here or are implied by this model. `ACTIVE`/`SUSPENDED`/`REVOKED` represent *authorization to use a product*, full stop — whatever commercial process outside this platform decides those values (a sales agreement, a support ticket, a future billing system) is out of scope and unmodeled. If a future billing phase needs to drive entitlement status automatically, it would call the same `PATCH .../product-entitlements/:productId` this phase's Platform Operator UI would call — entitlement doesn't need to know why its status changed, only that it did.

## 4. Semantics (Step 7)

| State | Meaning | Product access |
|---|---|---|
| **(no row)** | This tenant has never been entitled to this product. | Denied |
| **ACTIVE** | Product access may be granted, subject to Product.status (see §5). | Allowed (if Product ACTIVE) |
| **SUSPENDED** | Access denied — reversible; the tenant remains "known" to the product (e.g., for a temporary billing hold), not administratively removed. | Denied |
| **REVOKED** | Access denied — administratively/permanently removed. Distinct from SUSPENDED: reactivating a REVOKED entitlement is a deliberate, separate action (`docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md`), never a side effect of a generic status PATCH. | Denied |

No `PENDING` state — see the lifecycle doc for why.

## 5. Product status vs. entitlement status — precedence

**Product.status always takes precedence.** A `DISABLED` product denies every tenant, regardless of how "ACTIVE" their own entitlement is — the product itself isn't available to anyone. Implemented as the first check in `ProductAccessService.canAccess()`:

```text
Product not found          -> DENY (PRODUCT_NOT_FOUND)
Product.status != ACTIVE   -> DENY (PRODUCT_DISABLED)          -- regardless of entitlement
No entitlement row         -> DENY (NO_ENTITLEMENT)
Entitlement = SUSPENDED    -> DENY (ENTITLEMENT_SUSPENDED)
Entitlement = REVOKED      -> DENY (ENTITLEMENT_REVOKED)
Entitlement = ACTIVE       -> ALLOW
```

Disabling a Product never mutates any tenant's own entitlement rows — verified directly (`tests/phase2b2-product-entitlement.e2e-spec.ts`: an entitlement's `status` stays `ACTIVE` throughout a disable/re-enable cycle; only the *computed* `eligible` flag changes). Re-enabling a Product restores eligibility for exactly the tenants whose own entitlement was already valid — nothing is "restored" that wasn't already ACTIVE.

## 6. Access evaluation — `ProductAccessService`

The single, central decision point (Step 9) — `canAccess(tenantId, productId): Promise<{allowed, reason?}>`. Deny-by-default throughout (Step 10): every branch defaults to denial; only the fully-valid path returns `allowed: true`. Knows nothing about TravelOS, Healthcare, Gym, or any product's own business rules — only `Product.status` and `TenantProductEntitlement.status`. No controller computes this logic itself; every consumer (today: the tenant self-service read endpoint) calls this one service.

Conceptual request flow this phase prepares for (Step 8), not yet wired end-to-end (no per-product API-boundary callback exists yet — that's a future phase, once `aud`-checked tokens exist, `docs/TOKEN_ARCHITECTURE.md`):

```text
Request -> Authentication -> Global User -> Organization Context (Phase 2C)
        -> Membership validation -> Product Entitlement (ProductAccessService)
        -> Product Authorization -> ALLOW/DENY
```

`ProductAccessService` takes only `tenantId`/`productId` — no organization or user parameter — so Phase 2C can call it once it resolves "which tenant is the active organization's tenant" from its own context-switching work, without this service needing to change at all.

## 7. Platform Operator + RLS — no bypass

`tenant_product_entitlement` has ordinary tenant RLS (`apply_tenant_rls`) — same mechanism as `Organization`/`Membership`. A Platform Operator has no ambient tenant context (Phase 2B.1) and must still manage any tenant's entitlements. This is **not** solved with `BYPASSRLS` — `identity_app` remains `NOBYPASSRLS`, untouched. Instead: the tenantId is always explicit — named in the request path (`/v1/platform/tenants/:tenantId/product-entitlements`), existence-checked (`TenantsService.findById`), and passed as `PrismaContextService.runInContext`'s `actingAsTenantId` parameter for that one call — the exact mechanism this codebase already uses for every pre-authenticated/cross-context flow (login, refresh, forgot-password) since Phase 1. RLS is fully enforced for the duration of that call, scoped to precisely the tenant named in the URL: a request naming Tenant A can never see or write Tenant B's rows through this repository, verified directly (`tests/phase2b2-product-entitlement.e2e-spec.ts`, "Multi-tenant isolation").

## 8. Organization-level decision (Step 12, proving tenant-level sufficiency)

Every required test scenario resolves correctly with tenant-level entitlement alone:

- **Different organizations, same tenant, same product** (brief §14): Tenant entitled to TravelOS; User X is a member of Organizations A and B, not C. Org A + TravelOS eligible, Org B + TravelOS eligible, Org C denied — but the reason Org C is denied is **membership**, not entitlement (User X isn't a member there at all). Entitlement never needed to distinguish A from B from C — it answers one tenant-wide question, and Membership/authorization already answer the per-organization one.
- **One organization enabled, another disabled** (the brief's own example of when org-level *would* be needed): not a real requirement yet — no scenario in this phase's test matrix demonstrates a need for two organizations under one tenant to see *different* product availability. If that need appears, it is a genuinely new requirement, not an oversight in this phase's design.

No `OrganizationProductEntitlementOverride` was built. Documented extension point: an optional `organization_id` (nullable) column, or a small override table consulted only when non-null, layered on top of the existing tenant-level check without changing its shape — deferred, not designed further, per Step 12's own instruction not to implement without a demonstrated requirement.

## 9. What Product/Application registration does NOT imply (Step 41)

Registering a Product creates no entitlements for any tenant. Registering an Application creates no tenant product access. `Product ≠ Application ≠ Entitlement ≠ Membership ≠ Authorization` — five independent facts, each with its own table, its own lifecycle, and (with the sole intentional exception of Product-status precedence, §5) no automatic derivation from any other. Verified directly: creating a brand-new Product and immediately checking `GET /v1/product-entitlements` for an unrelated tenant shows no row for it at all (`tests/phase2b2-product-entitlement.e2e-spec.ts`, "no entitlement record at all = not eligible").

## 10. Cache considerations (Step 38)

No distributed cache is introduced in this phase. If a future phase adds one (e.g., a product's own backend caching entitlement decisions to avoid a round-trip per request, mirroring `docs/TOKEN_ARCHITECTURE.md` §6's permission-caching guidance), it must invalidate on every status transition this phase defines: `ACTIVE→SUSPENDED`, `ACTIVE→REVOKED`, `SUSPENDED→ACTIVE`, `SUSPENDED→REVOKED`, `REVOKED→ACTIVE` (reactivate), and any Product-status change (`ACTIVE↔DISABLED`) — the latter is easy to miss since it isn't an entitlement-table write at all. Security correctness takes priority over any future caching layer's performance; this is a documented requirement for whoever builds that layer, not a design commitment made now.
