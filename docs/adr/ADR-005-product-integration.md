# ADR-005: Product Integration Model

## Context

The Identity Platform needs to know about consuming applications at an abstract level without becoming coupled to any one of them. Full analysis: `docs/PRODUCT_REGISTRATION.md`, `docs/MULTI_PRODUCT_INTEGRATION.md`.

## Problem

A single "Application" table (as sketched illustratively in the Phase 2 brief) conflates four distinct concerns: what the product *is* (catalog), what concrete client credential is calling in (OAuth client), whether a given tenant is even entitled to use it (subscription/entitlement), and machine-identity credentials for service calls.

## Options

1. **One flat `Application` table** carrying product metadata, client credentials, and entitlement state together.
2. **Four separate entities** — `Product` (catalog), `Application` (OAuth client), `TenantProductSubscription` (entitlement), `ServiceAccount` (machine identity) — related but independently evolvable.

## Decision

**Option 2.**

## Rationale

Under Option 1, renaming a product, rotating one application's client secret, and suspending a tenant's trial would all mutate the same row for unrelated reasons, and a product needing multiple credential holders (web app + mobile app + backend service) would have to duplicate its own product metadata across rows or awkwardly special-case a "primary" row. Separating the four concerns lets each evolve on its own lifecycle: a `Product` rarely changes; `Application`s are added/rotated per client surface; `TenantProductSubscription` changes with billing events; `ServiceAccount`s are added per automation need — matching how these things actually change in a running system.

## Consequences

Onboarding a new product is: one `Product` row, N `Application` rows, a permission-namespace registration, and a `TenantProductSubscription` row per subscribing tenant (`docs/MULTI_PRODUCT_INTEGRATION.md` §4 demonstrates this concretely for all three initial products). No Identity Platform code or schema change is required per product onboarded going forward.

## Risks

Four entities instead of one is marginally more upfront modeling and query-join complexity — accepted because the alternative (one overloaded table) would need to be split apart later anyway once a product needs a second `Application` or a tenant's subscription needs to change independently of its client credentials, and doing that split later is strictly more disruptive than designing it in now, before any real product is onboarded.
