# ADR-015: Service-to-Service Tenant & Scope Authorization

## Context

ADR-006 already decided the **mechanism** for service-to-service authentication (OAuth2 Client Credentials, `ServiceAccount` tied to an `Application`, JWT-client-assertion as an upgrade path). It did not decide the question Phase 2D must answer: once a service authenticates and receives an access token, **which tenants, organizations, and API scopes is it actually authorized for?** A valid `client_id`/`client_secret` proves *which service is calling*, not *what it may access* — conflating the two would silently make every service a platform-wide superuser the moment it can authenticate at all.

## Problem

Define how a service becomes authorized for a specific Product, Tenant, Organization (where relevant), API, and scope — without assuming that valid credentials imply universal tenant access, and without inventing a second, parallel authorization model that diverges from the human Membership/Organization-context model Phase 2A–2C already built.

## Options

**A. Service token contains tenant context** (the token itself names one or more `tenant_id`s the service may act on, decided at token-issuance time). Simple to validate (a resource server just reads the claim), but re-creates exactly the staleness problem `docs/ORGANIZATION_CONTEXT_SECURITY.md` §2 already solved for human tokens: a tenant relationship revoked after issuance stays valid in the token until it expires, and a service with many tenant relationships needs an unboundedly large claim or one token per tenant.

**B. Service token is tenant-neutral; tenant is established per-request by the API** (the caller states which tenant it's acting on, e.g. a path parameter or header, and the resource server/Identity Platform validates that relationship live, per request). Mirrors the human "client selects organization, server validates membership" principle (`docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md` §2) most closely, but requires a live authorization check on every request unless cached, and does not by itself say *where* that relationship is stored.

**C. Service has explicit tenant entitlements** — a durable, database-backed grant (analogous to `TenantProductEntitlement`, ADR-011) naming exactly which Tenants a given `ServiceAccount` may act on, for which Product/scope. Requires a new entity and its own admin surface (Platform-Operator-managed, by the existing boundary — ADR-010), but gives a single, auditable, revocable source of truth that is never embedded in a token and therefore never goes stale in a client's hands.

**D. Hybrid**: B's request-time tenant assertion + C's durable entitlement as the thing that request is validated against — the token itself stays tenant-neutral (avoiding A's staleness and claim-bloat problems); the caller states the tenant it wants to act on per-request (avoiding a token-per-tenant explosion); the Identity Platform (or the resource server, via a cached, short-TTL check) validates that assertion against the durable, revocable entitlement from C.

## Decision

**Option D.** A service access token (`docs/TOKEN_AND_SCOPE_ARCHITECTURE.md` §Service tokens) never carries a `tenant_id`/`organization_id` claim — it is tenant-neutral, scoped only to `(sub = ServiceAccount, aud = resource API, scope = service scopes)`. A request that needs to act on a specific Tenant states which Tenant explicitly (a request parameter, mirroring how a human client states `organizationId` at `/auth/context/switch` — never assumed, never embedded). That assertion is validated, live, against a new conceptual entity — **`ServiceAccountTenantGrant`** (`docs/PHASE_2D_ARCHITECTURE.md` §Data Model; not implemented in Phase 2D) — a durable, Platform-Operator-managed, revocable row naming exactly which `(ServiceAccount, Tenant)` pairs are authorized, itself layered underneath the existing `TenantProductEntitlement` check (a service still cannot act for a Tenant that has no ACTIVE entitlement for its Product, regardless of any service-tenant grant).

## Rationale

This is the direct service-principal analog of the human resolution chain Phase 2C already established and hardened (`Membership → Organization → Tenant`, never trusted from a client claim, always re-derived server-side) — Option D reuses that exact shape (durable database grant, request-time assertion, live re-validation) rather than inventing a second authorization philosophy for services. Option A is rejected for the same staleness reason `docs/ORGANIZATION_CONTEXT_SECURITY.md` rejected embedding authoritative tenant state in a human token. Option B alone is rejected because it says nothing about *where the durable truth lives* — without C's entitlement table, "the API validates it" has nothing authoritative to validate against, and would either fall back to trusting the request (unacceptable) or reinvent C informally per-product (inconsistent, unauditable). Option C alone (no per-request assertion) would force one token per tenant relationship, an operationally worse version of Option A's own token-bloat problem.

## Security implications

A compromised service credential is bounded by its `ServiceAccountTenantGrant` rows, not by every tenant that has ever entitled the service's Product — the blast radius of a leaked `client_secret` is the set of tenants that specific service was explicitly authorized for, auditable and immediately revocable independently of rotating the credential itself. This directly upholds the non-negotiable principle "a valid client credential does not imply universal tenant access."

## Operational implications

Platform Operators (ADR-010) manage `ServiceAccountTenantGrant` rows the same way they manage `TenantProductEntitlement` today — a new admin surface, not a new security boundary or a new operator concept. No change to how Tenants manage their own Memberships/Organizations; a service grant is entirely orthogonal to human membership.

## Consequences

Every resource server consuming a service token must itself validate the requested tenant against either a live call to the Identity Platform or a short-TTL cached copy of the grant (same local-vs-introspection trade-off as human authorization, `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §Resource Server Architecture) — this is genuine, real implementation cost placed on products, accepted for the same reason ADR-003 already accepted it for fine-grained permission checks.

## Deferred considerations

`ServiceAccountTenantGrant` is a conceptual, future entity — not created in Phase 2D (no migration, no table). Whether it should support an organization-level (not just tenant-level) grant is deferred exactly as organization-level product entitlement was deferred in ADR-011 — no demonstrated requirement yet.

## Gate Review Amendment, then Correction (Phase 2D Architecture Gate — Gate 3/Gate 4)

An earlier pass through this gate review amended every reference above from `ServiceAccount` to `Application`, renaming the grant entity to `ApplicationTenantGrant`. **That amendment is retracted** — see ADR-018's own "Gate Review Correction" section for the full reasoning: `docs/PRODUCT_REGISTRATION.md` §2.4/§3 and ADR-005 already establish an explicit `Application 1───N ServiceAccount` cardinality (one Application/credential, many independent automated processes each needing their own audit/scope/tenant-grant identity) that the retracted amendment overlooked. **`ServiceAccountTenantGrant`, keyed by `ServiceAccount.id`, is restored exactly as originally decided above** — no further change to this ADR's Decision, Rationale, or Consequences sections; they stand as written.

This gate review does, however, **confirm** (independent of the naming question) that the *existing* `TenantProductEntitlement` alone is not sufficient for service authorization (§Gate 4 of the gate-review brief): consider one Product with two Tenants (A, B) both entitled to it, and two `ServiceAccount`s under the same Application ("Sync Service," "Full Backend") — relying on `TenantProductEntitlement` alone would let *either* ServiceAccount act on *both* tenants merely because the tenant is entitled to the Product, even if "Sync Service" was only ever meant to touch Tenant A. `ServiceAccountTenantGrant` is the additional, necessary layer that bounds *which specific service identity* may act on *which specific tenant*, even among tenants otherwise entitled to the same Product — `TenantProductEntitlement` answers "is this tenant using this product at all," `ServiceAccountTenantGrant` answers "is this specific service allowed to act on this specific tenant," and neither substitutes for the other.
