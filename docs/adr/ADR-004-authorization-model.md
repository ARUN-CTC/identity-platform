# ADR-004: Authorization Model

## Context

The Identity Platform must support core IAM permissions (its own admin surface) and product-specific permissions (`travel.booking.create`, etc.) without either polluting the other, and without forcing every product into the same enforcement engine. Full analysis: `docs/AUTHORIZATION_ARCHITECTURE.md`.

## Problem

Where should product-specific permission codes be defined and stored, and who enforces them?

## Options

1. **Central authorship** — the Identity Platform's own team defines every product's permission codes.
2. **Fully product-managed, separate stores per product** — each product keeps its own permission catalog entirely outside the Identity Platform.
3. **Hybrid** — one shared catalog (central storage, unified role composition), namespaced ownership (each product authors and registers its own codes under its own prefix).

## Decision

**Option 3.** One physical permission table inside the Identity Platform, partitioned by namespace prefix (`identity.*` core, `<product>.*` per product), where only the owning product's `ServiceAccount` may write codes under its own prefix (`POST /v1/products/{id}/permissions`). Enforcement of product-namespaced permissions happens in the product itself, never inside the Identity Platform.

## Rationale

Option 1 would require the Identity Platform's team to understand every product's business domain — a direct violation of the platform's own prime directive (no product business logic in the Identity Platform). Option 2 breaks the one genuinely valuable cross-product feature a shared Identity Platform provides: composing a single role from permissions across multiple products for one Tenant admin to manage, and would require real-time fan-out to N product APIs for every role edit — reintroducing a distributed-consistency problem the API-boundary architecture (ADR-001) exists to avoid. Option 3 gets both: unified storage/role-composition without central authorship, and a namespace-ownership check that is purely string-prefix based, so the Identity Platform enforces registration boundaries without ever interpreting permission meaning.

## Consequences

Every product must implement a one-time registration call for its permission catalog (part of onboarding, `docs/PRODUCT_REGISTRATION.md`) and must enforce its own permission checks locally rather than delegating to the Identity Platform. The grant-ceiling rule (`docs/AUTHORIZATION_ARCHITECTURE.md` §4) continues to work unmodified across namespaces since it only compares opaque code strings.

## Risks

A product could attempt to register misleadingly-named permissions or squat on another product's implied namespace — mitigated by strict prefix-match enforcement (a `gym` ServiceAccount literally cannot write a `travel.*` row) and by the audit trail (`PRODUCT_PERMISSION_REGISTERED`).
