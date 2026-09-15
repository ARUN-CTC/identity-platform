# Trust Boundary

```text
                          Identity Platform
                                  │
                            Trust Boundary
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
          TravelOS            Healthcare              Gym
      (Product: travelos)  (Product: healthcare)  (Product: gym)
              │                   │                   │
       Application(s)       Application(s)       Application(s)
      (client_id/secret)   (client_id/secret)   (client_id/secret)
```

Phase 2B (`docs/PHASE_2B.md`) implements the registration side of this boundary: the Identity Platform now knows, as first-class data, which Products and which Applications exist. It does **not** yet implement the enforcement side — no endpoint validates a caller's `client_id` against this registry, no token carries an `aud` claim naming an Application (`docs/TOKEN_ARCHITECTURE.md` still correctly describes that as a future step, ADR-003). This document defines the boundary that registration makes possible; `docs/adr/ADR-007-oidc-oauth-strategy.md`'s phased path is what will eventually close it.

## Platform-level vs. tenant-level (Step 20's required determination)

**Product and Application are platform-level entities. Neither carries a `tenant_id` column, and neither is protected by Row-Level Security.**

Rationale: RLS in this codebase is a `tenant_id`-column mechanism (`database/shared/002_functions.sql`) that partitions data *by customer account*. A Product (TravelOS) and its Applications do not belong to any one Tenant — the same TravelOS Product is what every TravelOS-subscribing Tenant's users eventually authenticate against. Blindly tenant-scoping `product`/`application` would be a category error: it would ask "which Tenant owns the concept of TravelOS," a question that has no correct answer, the same way "which Tenant owns the `MEMBER` system role" has no correct answer (and indeed `security_role`'s own system rows are `tenant_id IS NULL` for exactly this reason). This mirrors the precedent already set by `organization_type` and `security_permission` — both global catalogs, both explicitly documented as "no RLS" in their own DDL comments.

What *is* tenant-scoped, and remains completely untouched by this phase: `Tenant`, `Organization`, `Membership`, `security_user_role` (the grant), `security_session`. A Tenant's relationship to a Product — "is Tenant X even allowed to use TravelOS" — is a genuinely different, still-unbuilt question (`docs/PRODUCT_REGISTRATION.md`'s `TenantProductSubscription`, explicitly deferred — see `docs/PHASE_2B_DOMAIN_MODEL.md` §7).

## How the Identity Platform identifies a calling application (future)

Phase 2B registers the identity; it does not yet check it on any request. The intended mechanics, unchanged from `docs/TOKEN_ARCHITECTURE.md`/ADR-003 and restated here for this document's own completeness:

- **`application_id`** (this Application's own `id`) or **`client_id`** — either could serve as the token's `aud` claim once tokens actually carry one; `docs/TOKEN_ARCHITECTURE.md` specified `aud = client_id` (stable, public, and already what a product would present at login) as the intended shape. Not decided further here — this is JWT design, explicitly out of Phase 2B's scope ("do not redesign JWT yet").
- **`audience`**: the term for that claim once it exists.
- **`scope`**: a future coarse capability grant tied to the Application (`docs/AUTHORIZATION_ARCHITECTURE.md` §1's "Scope" row) — not built.
- **Service identity**: a `ServiceAccount` belonging to an Application, for machine-to-machine calls with no end user present — not built (`docs/adr/ADR-006-service-authentication.md`).

None of these are implemented in Phase 2B. What Phase 2B *does* provide, that all of the above will eventually build on: a stable `Application.id` and a stable, unique `client_id` for every registered consumer, and a `status` an eventual enforcement point can check.

## What "trust" means today, concretely

Today, after Phase 2B: the Identity Platform can answer "does an Application named X, under Product Y, exist and hold this client_secret" as a pure data question (nothing calls that check yet). It cannot yet answer "is this specific HTTP request coming from that Application" — that requires the token/audience work above. The trust boundary in the diagram is therefore, honestly, a **registered-identity boundary**, not yet an **enforced** one. Recording this distinction explicitly matters: a reader should not assume Phase 2B makes any request more secure by itself — it makes the *next* phase (audience-checked tokens) possible without a schema change first.

## Products cannot see each other, or any tenant's data, through this registry

Nothing in `product`/`application` references Organization, Tenant, Membership, or any product's own business data. `ApplicationsRepository.findManyForProduct()` is scoped strictly by `product_id` (verified directly in `tests/phase2b-product-registration.e2e-spec.ts`'s cross-product isolation test) — TravelOS's registration rows are not reachable through Healthcare's or Gym's product id, and none of the three could enumerate another's Applications even with a client_id/secret in hand, because nothing about calling the (not-yet-built) authenticated API path exposes another product's registration data — only the platform-operator-only admin endpoints do, and those require `PRODUCT_VIEW`/`APPLICATION_VIEW` (SUPER_ADMIN-only), never a product's own credential.
