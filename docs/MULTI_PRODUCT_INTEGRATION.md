# Multi-Product Integration Example

Demonstrates that TravelOS, Healthcare, and Gym can all consume the same Identity Platform without any of them modifying — or being reflected in — its core domain model. This is a worked example, not a new architecture; every entity/endpoint referenced here already exists in the other Phase 2 documents.

## 1. TravelOS

```text
TravelOS
   ├── Login              → POST /v1/auth/login  (client_id = TravelOS Web's Application)
   ├── Identity           → GET /v1/users/me
   ├── Organization       → GET /v1/organizations, /v1/auth/context/switch
   ├── Authorization      → roles/scopes from token + POST /v1/authorize for travel.booking.*
   └── User management    → POST /v1/invitations, /v1/organizations/{id}/members
          │
          ▼
Identity Platform
```

Registration footprint: one `Product` row (`slug: "travelos"`), at least one `Application` (`"TravelOS Web"`, possibly a second `"TravelOS Backend Service"` for service-to-service calls), a `TenantProductSubscription` per customer tenant, and a set of `travel.*` permission codes registered by TravelOS itself via `POST /v1/products/{id}/permissions`. TravelOS's own database keeps Booking/Ticket/Supplier/Itinerary/Customer entirely to itself, referencing Identity Platform `user_id`/`organization_id` values only by id.

## 2. Healthcare

Same Identity Platform, same mechanism, zero code changes to the Identity Platform:

```text
Healthcare
   ├── Patient
   ├── Doctor
   ├── Appointment
   └── Medical Record
```

stay entirely inside Healthcare's own database. Its registration footprint: `Product(slug: "healthcare")`, its own `Application`(s), its own `healthcare.*` permission namespace (`healthcare.patient.read`, `healthcare.patient.create`, ...), its own `TenantProductSubscription` rows. Healthcare's higher sensitivity data (medical records) is a reason for Healthcare to adopt the JWT-client-assertion upgrade path (`SECURITY_ARCHITECTURE.md` §5) sooner than other products, not a reason for the Identity Platform to treat it differently — the platform's core mechanism is identical.

## 3. Gym

```text
Gym
   ├── Member (business profile — distinct from Identity Platform's Membership, see IDENTITY_DOMAIN_MODEL.md §1)
   ├── Trainer
   ├── Workout
   └── Subscription (Gym's own billing concept — distinct from TenantProductSubscription)
```

Same pattern again: `Product(slug: "gym")`, its own Application(s), its own `gym.*` permission namespace. Worth calling out explicitly since Gym's vocabulary ("Member," "Subscription") collides with Identity Platform terms — this is exactly why `IDENTITY_DOMAIN_MODEL.md` §1 flags the naming collision: Gym's "Member" is a product-domain profile row that merely references an Identity Platform `user_id`; it is never confused with, or backed by, the Identity Platform's own `Membership` entity.

## 4. What "without modifying the core domain model" actually means, demonstrated

Onboarding all three products required, in total, changes to exactly these tables (all already designed in this Phase 2 pass, none product-specific in shape): `Product` (3 new rows), `Application` (3+ new rows), `TenantProductSubscription` (N rows, one per tenant per product), `Permission` (N new rows, all namespaced, none authored by the Identity Platform's own team). Nothing about `User`/Identity, `Tenant`, `Organization`, `Role`, `Session`, or `Token` needed to change shape to accommodate any of the three — confirming the domain model in `IDENTITY_DOMAIN_MODEL.md` is genuinely product-agnostic rather than TravelOS-shaped with two more products squeezed in after the fact.

## 5. A fourth, hypothetical future product

To make the "N future products" requirement concrete: adding "Product X" tomorrow is, in full: one `Product` row, one or more `Application` registrations, its own permission namespace registered through its own ServiceAccount, and `TenantProductSubscription` rows for whichever tenants buy it. No Identity Platform deployment, migration, or code change is required to onboard it — this is the acceptance test for Phase 2's product-agnosticism claim, and it is testable today against this document's own design without waiting for a real fourth product to show up.

## 6. Phase 2D — external/OAuth consumption of this same model

Phase 2D (`docs/PHASE_2D_ARCHITECTURE.md`) formalizes exactly how each product's own web/mobile Applications and its own API (resource server) authenticate against and validate tokens from the Identity Platform, once OAuth2.1/OIDC is actually built — see `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §Multi-Product Isolation for the `aud`-per-product diagram this section's own multi-product model extends. Nothing in this document changes as a result — Phase 2D adds a protocol surface on top of the same `Product`/`Application` rows described here, it does not reshape them (beyond the conceptual, not-yet-implemented attribute additions in ADR-018).
