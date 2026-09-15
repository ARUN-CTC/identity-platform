# Product Registration Model

Answers Phase 2 Step 4: how the Identity Platform knows about consuming applications, at an abstract, product-agnostic level. Builds on `docs/IDENTITY_DOMAIN_MODEL.md`.

> **Implementation status (Phase 2B, `docs/PHASE_2B.md`):** §2.1 (`Product`) and §2.2 (`Application`) below are **implemented** — see `docs/PHASE_2B_DOMAIN_MODEL.md` for the as-built field list (it differs slightly from this document's original illustrative one: `clientType` not `type`, `redirectUris`/`allowedOrigins` not `allowedRedirectUris`, no `tokenPolicy` field — token-policy-per-application was speculative and dropped, not needed yet) and ADR-009 for why "Application" and "Client" are one entity, not two. §2.3 (`TenantProductSubscription`) and §2.4 (`ServiceAccount`) remain **not built** — explicitly deferred, out of Phase 2B's scope; still the intended future model.

## 1. Why one "Application" entity is not enough

The naive design (a single `Application` table with `client_id`/`client_secret`/`redirect_uris`) conflates four genuinely different concepts:

1. **What product is this?** (a catalog fact, rarely changes: "TravelOS" exists)
2. **What concrete OAuth client is calling us?** (TravelOS's web frontend and TravelOS's backend service are different credential holders with different security postures, even though both belong to the same product)
3. **Is this Tenant even allowed to use this product?** (a billing/entitlement fact, changes over time)
4. **Is this specific caller a human session or a machine?** (already answered by Session vs. ServiceAccount — not repeated here)

Collapsing all four into one table forces awkward choices (does adding a mobile app for TravelOS mean a new "product," or a new row that also carries the product's own metadata redundantly?). Phase 2 keeps them separate.

## 2. The four entities

### 2.1 `Product` (catalog)

The abstract SaaS offering, defined once by the platform operator, not by tenants.

```text
Product
-------
id
slug            (e.g. "travelos", "healthcare", "gym") — used as the permission-namespace prefix
name
status          (ACTIVE | DEPRECATED | RETIRED)
created_at / updated_at
```

Adding "Product X" in the future is: insert one `Product` row + register its permission namespace (`docs/AUTHORIZATION_ARCHITECTURE.md` §2) + register at least one `Application`. Nothing about the Identity Platform's core domain model changes.

### 2.2 `Application` (OAuth/OIDC client)

A concrete, credentialed consumer of the Identity API. One `Product` can have multiple `Application`s (web frontend, mobile app, backend service, staging environment) — each with its own blast radius if compromised.

```text
Application
-----------
id
product_id            → Product
name                  (e.g. "TravelOS Web", "TravelOS Backend Service")
client_id
client_secret_hash    (nullable — public clients, e.g. an SPA using PKCE, have none)
type                  (CONFIDENTIAL | PUBLIC)
status                (ACTIVE | SUSPENDED | REVOKED)
allowed_redirect_uris (array — relevant once Step 15's OAuth strategy lands)
allowed_origins       (array — CORS)
token_policy          (access TTL, refresh TTL, rotation rule — overrides platform defaults if set)
created_at / updated_at
```

This is the example table given in the Phase 2 brief — it is correct for a client credential holder, but only for *that one concept*. It is deliberately not also carrying `product` metadata (name changes propagate from one place) or subscription/entitlement state (a suspended trial tenant does not mean TravelOS's client credentials are revoked).

### 2.3 `TenantProductSubscription` (entitlement)

Records that a Tenant is allowed to use a Product, independent of any specific Application or Membership.

```text
TenantProductSubscription
-------------------------
id
tenant_id      → Tenant
product_id     → Product
status         (ACTIVE | TRIAL | SUSPENDED | CANCELLED)
starts_at / ends_at
created_at / updated_at

@@unique(tenant_id, product_id)
```

Decision (answers Step 3, Q6): subscription is modeled at **Tenant** granularity, not Organization, because billing/contracts are normally per-company. An Organization-level override (e.g. one division of a large enterprise tenant is cut off from a product the rest of the tenant still has) is a documented extension point — add an optional `organization_id` (nullable) to this table later if a real customer needs it — not built now, to avoid speculative complexity.

Enforcement point: the Identity Platform checks this at token-issuance and at its own authorization-check endpoint (`docs/API_BOUNDARY.md`) whenever an `aud` (Application → Product) is being resolved for a login/refresh — a Tenant with no active subscription to a Product cannot obtain a token whose audience is that product's Application, even if the user's credentials are otherwise valid. The Product itself should not need to re-check subscription state on every request (see `docs/AVAILABILITY_MODEL.md` for what happens if the Identity Platform is briefly unreachable), but it can via `/v1/organizations/{id}` or a dedicated entitlement endpoint if it wants a live check for its own UI (e.g. "your trial has ended" banners).

### 2.4 `ServiceAccount` (machine identity)

Covered fully in `docs/SECURITY_ARCHITECTURE.md` §"Service-to-service authentication" and ADR-006; listed here only for completeness of the registration model. A `ServiceAccount` belongs to exactly one `Application` (a product's backend calling the Identity API as itself, not as any user) and authenticates via OAuth2 client-credentials using that Application's own `client_id`/`client_secret`.

## 3. Relationships at a glance

```text
Product 1───N Application
Product 1───N Permission (namespace ownership, not a FK — see AUTHORIZATION_ARCHITECTURE.md)
Tenant  1───N TenantProductSubscription N───1 Product
Application 1───N ServiceAccount
```

A login/token-issuance request always names an `Application` (via `client_id`) as its audience. The Identity Platform resolves: does this Application's Product have an active `TenantProductSubscription` for this user's Tenant? If not, the request is rejected before any token is minted, regardless of password correctness.

## 4. What is explicitly not built in Phase 2

Self-service application registration UI, per-application rate-limit tiers, a marketplace/catalog UI for tenants to browse and subscribe to products, and any billing/invoicing integration. Phase 2 defines the data model and enforcement point only; the surrounding product/billing workflow is a later, separate concern (see `docs/PHASE_2_IMPLEMENTATION_PLAN.md`, Phase 2D).
