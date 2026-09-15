# ADR-001: Identity Platform Boundary

## Context

Phase 1 extracted a product-agnostic IAM core from TravelOS into an isolated repository/database/runtime. Phase 2 must decide how that core integrates with multiple independent products (TravelOS, Healthcare, Gym, future) without becoming, in practice, a TravelOS-shaped module that other products merely bolt onto.

## Problem

Where exactly is the line between "Identity Platform" and "Product"? Without an explicit boundary, product-specific concerns leak in under time pressure (a quick TravelOS-specific field on `User`, a shortcut authorization check that only makes sense for bookings) and the platform stops being reusable in practice even if it remains reusable in name.

## Options

1. **Network API boundary only** — products talk to the Identity Platform exclusively over HTTPS; no shared database, ORM, domain code, or filesystem dependency.
2. **Shared library/package boundary** — products import an Identity Platform-authored package containing domain models and business logic directly into their own codebase.
3. **Shared database boundary** — products query the Identity Platform's tables directly (read replica or same instance).

## Decision

**Option 1.** The Identity Platform's entire integration surface is its versioned REST API (`docs/API_BOUNDARY.md`), full stop. See `docs/DATA_OWNERSHIP.md` for the explicit no-shared-database/no-shared-ORM rule and `docs/SDK_STRATEGY.md` for how generated clients and a JWT-validation library still let products consume the platform conveniently without violating this boundary — a generated client and a validation library contain no product-specific or Identity-domain *business logic*, only mechanical request/response shapes and cryptographic verification, which is why they don't reintroduce Option 2's problem.

## Rationale

Option 2 would make every product implicitly coupled to the Identity Platform's release cadence, language, and internal representations — exactly the coupling Phase 1 spent its effort removing from TravelOS. Option 3 defeats tenant isolation and RLS enforcement the moment any product can issue an arbitrary query, and creates two paths to the same data (API + direct query) that can disagree. Option 1 is the only one consistent with Phase 1's already-proven isolation model and with onboarding N future products without deployment coupling.

## Consequences

Every authorization decision a product needs must be answerable from a token claim, a cached copy, or an API call (`docs/TOKEN_ARCHITECTURE.md` §6, `docs/AVAILABILITY_MODEL.md`) — this is a real design constraint on every future feature, not a formality. Products bear the cost of implementing correct token validation (mitigated by `docs/SDK_STRATEGY.md`'s validation-library plan).

## Risks

A product team under deadline pressure requests direct database access "just this once" — mitigated by this ADR being the explicit, citable reason to say no, and by `docs/DATA_OWNERSHIP.md` naming the specific anti-patterns to watch for.
