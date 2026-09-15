# Phase 2B — Domain Model: Product, Application, Client

Phase 2B's brief poses a specific question before any implementation: is `Product → Application → Client` a three-tier chain, or is that over-modeling? This document resolves it, then defines every term precisely.

## Definitions

| Term | Definition | Tenant-scoped? |
|---|---|---|
| **Product** | The abstract SaaS offering registered once, platform-wide: TravelOS, Healthcare, Gym. A catalog entry, not a business-data owner. | No — platform-level |
| **Application** | A concrete, credentialed consumer of the Identity Platform's API, registered under one Product (e.g. "TravelOS Web," "TravelOS Backend"). This is also what OAuth/OIDC terminology calls a **"client."** | No — platform-level |
| **Client** | **Not a separate entity.** See §1 below — "Client" is the industry-standard name for exactly the thing this platform calls "Application." One physical table, one set of endpoints, two names used interchangeably in prose. | — |
| **Tenant** | The billing/isolation boundary for a customer account (unchanged from `docs/IDENTITY_DOMAIN_MODEL.md`). | — |
| **Organization** | A subdivision within a Tenant (unchanged). | Yes |
| **Membership** | The Identity↔Organization link (unchanged, Phase 2A). | Yes |
| **Service Account** | A machine identity for service-to-service calls, belonging to an Application (`docs/adr/ADR-006-service-authentication.md`). **Not built in Phase 2B** — explicitly out of scope (see this phase's own scope control). Mentioned here only to draw the boundary: it is not a "type" of Application/Client, it is a distinct future entity that *references* one. | Yes (future) |

## 1. Why Application and Client are one entity, not two

The Phase 2B brief's own Step 4 and Step 5 independently arrive at the *same three examples* — "TravelOS Web / TravelOS Mobile / TravelOS Backend" — once for "Application" and once for "Client." That is the tell: they are not two different things at two different tiers, they are one concept with two names, one from this platform's own vocabulary (established in `docs/PRODUCT_REGISTRATION.md` during Phase 2) and one from the OAuth2/OIDC standard vocabulary the brief also uses (`client_id`, `client_type`).

Introducing a genuine third tier — Product → Application (a grouping) → Client (the actual credential holder) — was considered and **rejected**. It would mean an "Application" with no fields of its own beyond a name and a list of Clients, which is exactly the kind of entity `docs/PRODUCT_REGISTRATION.md` already argued against for a different pairing (a single overloaded `Application` table): unnecessary indirection with no behavior attached to the extra layer. If a real future need appears — e.g., one logical application surface needing multiple simultaneous, independently-rotatable credential sets (a staging client_id alongside a production one, under one conceptual "TravelOS Web") — that need can be met by *renaming* today's `Application` table's relationship (letting `product_id` become `application_id` pointing at a new lightweight grouping row) without touching anything that already depends on today's `Application` id, since nothing else in this phase treats it as anything other than an opaque foreign key. Not built speculatively now.

**Decision: `Product 1───N Application`. "Application" is the table/API name; "client"/"client_id"/"client_secret"/"client_type" are the OAuth-standard vocabulary used for its credential-related fields, not a separate entity.**

## 2. Product

Represents a logical business/application offering — TravelOS, Healthcare, Gym, and any future product — never that product's own business data (`docs/DATA_OWNERSHIP.md`'s boundary applies here too: a `Product` row knows its own name and slug, nothing about bookings, patients, or workouts).

```text
product
-------
id
name
slug        -- unique, case-insensitive; also the future permission-namespace prefix (AUTHORIZATION_ARCHITECTURE.md §2)
description
status      -- ACTIVE | SUSPENDED | DISABLED
created_at / created_by / updated_at / updated_by / version
```

No `tenant_id` — see `docs/TRUST_BOUNDARY.md` for the platform-level-vs-tenant-level determination this required.

## 3. Application (== Client)

```text
application
-----------
id
product_id          -- → product
name
client_id           -- public, non-secret identifier
client_secret_hash  -- null for PUBLIC clients; never plaintext
client_type         -- CONFIDENTIAL | PUBLIC
status              -- ACTIVE | SUSPENDED | DISABLED
redirect_uris        -- reserved for future OAuth2/OIDC — unread/unenforced in Phase 2B
allowed_origins       -- reserved for future CORS enforcement — unread/unenforced in Phase 2B
secret_created_at
secret_revoked_at   -- reserved for a future rotation workflow — not built in Phase 2B
created_at / created_by / updated_at / updated_by / version
```

## 4. Client types

**Decision: `PUBLIC` and `CONFIDENTIAL` only. No `SERVICE` type.** A public client (e.g. a future browser SPA using PKCE) has no secret to hash — `client_secret_hash` stays null. A confidential client (a backend service, today's only real consumer shape) gets a generated secret, shown once. A `SERVICE` "type" was evaluated and rejected: service-to-service calling is a question of *who is authenticating* (a `ServiceAccount`, a distinct future entity — `docs/adr/ADR-006-service-authentication.md`), not a property of the Application/client record itself. Conflating the two would mean an Application's `client_type` column trying to express two independent facts (public-vs-confidential *and* human-facing-vs-machine-facing) in one enum — cleaner to keep them separate, and cheaper to add `ServiceAccount` later without touching this column at all.

## 5. Client credential handling

- `client_id`: generated (`cli_` + 24 random base64url bytes), returned in every response — not a secret.
- `client_secret`: generated only for `CONFIDENTIAL` applications (32 random bytes, base64url), hashed with SHA-256 before storage (a fast hash, not Argon2id — a client secret is high-entropy and machine-generated, never a guessable human password; `docs/PHASE_2B.md` §13 has the full reasoning), and returned **exactly once**, in the create-application response only. Every other read (`GET`, `PATCH`, list) strips `client_secret_hash` entirely.
- Rotation: the schema reserves `secret_created_at`/`secret_revoked_at` for a future rotation workflow. No rotation *endpoint* exists in Phase 2B — explicitly out of scope.

## 6. Who may register a Product/Application

Both are platform-level, so the caller must hold a platform-level grant, not a tenant-scoped one. Phase 2B uses the existing `SUPER_ADMIN` system role (already seeded with "every permission in the catalog," already documented since Phase 1 as "full platform-level access across every tenant") as the stand-in for the not-yet-built platform-operator principal (`docs/IDENTITY_DOMAIN_MODEL.md` §6) — this is a deliberate, documented reuse of existing machinery, not a new authorization path. `TENANT_ADMIN` is explicitly excluded from the four new permission codes (`PRODUCT_VIEW`/`PRODUCT_MANAGE`/`APPLICATION_VIEW`/`APPLICATION_MANAGE`), the same way it's already excluded from `TENANT_MANAGE`. See `docs/PHASE_2B.md` for the full authorization writeup.

## 7. Organization/Tenant relationship — explicitly not built

Per this phase's own scope control, no Tenant↔Product or Organization↔Product association is created — no `TenantProductSubscription` table, no entitlement check anywhere. `docs/PRODUCT_REGISTRATION.md` (Phase 2) already speced this relationship conceptually at Tenant granularity; Phase 2B leaves that design as a documented future model, unbuilt, and does not resolve the brief's own alternative suggestion (organization-level entitlement) either — both remain open until whichever phase actually implements billing/entitlement.
