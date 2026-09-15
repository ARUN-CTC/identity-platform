# ADR-011: Product Entitlement Model

## Context

Phase 2B registered Products/Applications; Phase 2B.1 established who administers the platform. Neither answered a distinct question this phase must: given a registered Product and a real Tenant, is that Tenant actually permitted to use it? Nothing before this phase modeled that fact at all — a Tenant with zero rows referencing a Product had no defined relationship to it, positive or negative.

## Problem

Three concepts that must never be conflated: **Membership** (does this user belong to this organization — Phase 2A), **Entitlement** (is this tenant/organization permitted to use this product — this phase), **Authorization** (what can this user do within the product — Phase 1/2A RBAC, plus each product's own enforcement). Get this wrong and either a product-agnostic entitlement check ends up gated on a per-user role (conflating entitlement with authorization), or a tenant's commercial/administrative access to a product ends up implied by having any Organization at all (conflating entitlement with membership).

## Options

1. **`OrganizationProductEntitlement`** — entitlement granted per Organization Unit within a Tenant.
2. **`TenantProductEntitlement`** — entitlement granted at the Tenant level, inherited by every Organization under it.

## Decision

Option 2, tenant-level, primary and (for this phase) only model. Organization-level entitlement is evaluated and explicitly deferred, not built — see `docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md` §"Organization-level decision" for the reasoning the brief itself demanded ("prove why tenant-level is insufficient" before building the alternative): no demonstrated requirement exists yet where two Organizations under the same Tenant need different entitlement to the same Product, and Membership + Organization-scoped authorization already gives real per-organization differentiation in *who* can use a product once the Tenant is entitled — which covers every scenario this phase was asked to test (§13/§14 of the brief). An extension point (an optional `organizationId` column, or a small override table) is documented, not built.

## Rationale

Product Entitlement answers a commercial/administrative question about the customer account as a whole — the same level `Tenant` already represents for billing/isolation purposes (`docs/IDENTITY_DOMAIN_MODEL.md`). Building the Organization-level variant first, on the strength of "it might be needed later," would be exactly the kind of speculative complexity this codebase's own architecture has repeatedly rejected elsewhere (ADR-005, ADR-009) — a second table, a second RLS surface, a second set of endpoints, for a requirement nobody has stated. The tenant-level model, deliberately, is the smallest thing that satisfies every scenario in this phase's own test matrix.

## Consequences

`tenant_product_entitlement` — one row per `(tenant_id, product_id)`, tenant-scoped RLS (`apply_tenant_rls`, unmodified mechanism). Product Entitlement management requires Platform Operator authentication (`PRODUCT_ENTITLEMENT_VIEW`/`_MANAGE`), consistent with Product/Application administration (Phase 2B/2B.1) — a Tenant Admin cannot self-grant entitlement, however broad their tenant-scoped role. A central `ProductAccessService` is the one place "is this tenant entitled" is computed, applying Product-status precedence over entitlement status, so no controller ever duplicates that logic. A tenant-facing self-service read endpoint (`GET /v1/product-entitlements`) lets a tenant see its own entitlements/eligibility without needing Platform Operator involvement for that one, non-privileged, RLS-scoped query.

## Risks

If a genuine per-organization entitlement requirement appears later, retrofitting it means deciding whether it overrides, narrows, or coexists with the tenant-level grant — a real design question, deferred rather than guessed at now. Documented as future work (`docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md`), not a silent gap.
