# ADR-002: Tenant/Organization Model

## Context

Phase 1's schema ties `SecurityUser` to exactly one `Tenant`. The Phase 2 brief requires answering whether one user can belong to multiple organizations, multiple tenants, and multiple products, and whether Tenant and Organization are the same concept. See `docs/IDENTITY_DOMAIN_MODEL.md` for the full analysis this ADR summarizes.

## Problem

A tenant-scoped user model cannot represent one real person authenticating into more than one customer account (Tenant) with one identity — a hard requirement the moment the platform serves multiple products and multiple independent customers who might share personnel (consultants, agency staff, a company that is simultaneously a TravelOS and a Gym customer under two separate contracts).

## Options

1. **Keep tenant-scoped users** — one `SecurityUser` row per tenant; the same person needing access to two tenants gets two unrelated accounts.
2. **Global identity + per-tenant/organization Membership** — one `Identity` row platform-wide; a `Membership` entity links it to exactly one Organization (and transitively one Tenant), independently statused.
3. **Collapse Tenant and Organization into one concept.**

## Decision

**Option 2** for the user model (global identity + Membership), **reject Option 3** — Tenant and Organization remain distinct (`docs/IDENTITY_DOMAIN_MODEL.md` §2.2): Tenant is the billing/isolation boundary, Organization is an operational subdivision within it, both already exist in Phase 1's schema and both are kept, only their relationship to `User` changes.

## Rationale

Option 1 (status quo) fails the platform's own stated goal the first time two products, or two customer tenants, need to share a real person's login. Option 2 matches how comparable multi-tenant B2B platforms model this (Slack, GitHub, Auth0 Organizations, WorkOS, Okta) and is a bounded, well-understood schema change: uniqueness moves from `(tenant_id, email)` to global, and per-tenant state (status, invitation) moves onto the new `Membership` entity instead of living on `User` itself. Option 3 was considered and rejected because Tenant (billing/isolation) and Organization (operational subdivision, can be plural per tenant) answer genuinely different questions — collapsing them would either force every small customer into fake "sub-organizations" or prevent large customers from having real internal subdivisions.

## Consequences

- `SecurityUser` → global `Identity`; email uniqueness becomes global (or is scoped by an explicit, deliberate multi-account policy if a real need for it ever appears — not designed for by default).
- A new `Membership` entity carries what `SecurityUserRole`'s implicit tenant/org linkage used to imply, plus its own lifecycle (invited/active/suspended) independent of the Identity's own global status.
- Platform-operator (cross-tenant) staff are explicitly **not** modeled as a Membership (`docs/IDENTITY_DOMAIN_MODEL.md` §6) — kept out of tenant-partitioned data entirely.
- Organization-context switching (`docs/ORGANIZATION_CONTEXT.md`) is a direct corollary of this decision: once a user can hold multiple Memberships, "which one is active right now" becomes a real question that Option D (hybrid session+token) answers.
- This is a real schema migration, not a documentation-only change — scheduled as Phase 2A in `docs/PHASE_2_IMPLEMENTATION_PLAN.md`, not executed in this documentation-only pass (Phase 2's own "Implementation Limit" rule).

## Risks

Migrating existing Phase 1 seed/dev data from tenant-scoped users to global identities + memberships needs a careful one-time migration script (dev data only at this stage — no production customer data exists yet, which makes this the cheapest time to make this change). Risk is LOW today specifically because it is being decided before any real tenant data exists.
