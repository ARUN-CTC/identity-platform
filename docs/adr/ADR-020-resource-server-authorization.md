# ADR-020: Resource Server Token Validation and Authorization Pipeline

## Context

Once products validate tokens issued by this platform (rather than only ever calling back into it, as the fully-coupled TravelOS extraction once did — `docs/TRAVELOS_COUPLING.md`), each product's own API ("resource server," in OAuth terms) needs a defined, repeatable pipeline for what it validates locally versus what remains this platform's own live decision. `docs/AVAILABILITY_MODEL.md` and ADR-003 already commit to short-lived, locally-verifiable access tokens as the availability-preserving default; this ADR makes the full pipeline explicit for multi-product, OAuth-issued tokens specifically.

## Problem

Define exactly which checks a resource server performs with zero network dependency on the Identity Platform, which checks require a call back to it (or a short-TTL cache of one), and in what order — so that "Identity Platform is briefly unavailable" degrades gracefully rather than taking down every product simultaneously, while dynamic, fast-changing authorization facts are never trusted stale.

## Options

**A. Fully local JWT validation only** — signature, `iss`, `aud`, `exp`, `scope` all checked locally; nothing else ever re-validated per-request. Maximally available, but re-introduces the exact staleness ADR-003/`docs/ORGANIZATION_CONTEXT_SECURITY.md` already rejected for human authorization — a revoked Membership or disabled entitlement would remain effective until token expiry.

**B. Full introspection on every request** (`docs/EXTERNAL_API_TRUST_BOUNDARY.md` §`/introspect`) — always fresh, but makes every single product API call depend on the Identity Platform's live availability and latency, exactly the coupling `docs/AVAILABILITY_MODEL.md` was written to avoid.

**C. Hybrid** — local validation for everything a signature can prove (identity, audience, scope, expiry), live (or short-TTL-cached) checks only for the facts that genuinely change on their own schedule and matter for THIS request (membership/organization validity for human tokens already re-validated by `resolveGrants()`-equivalent logic; product entitlement for the resource being accessed).

## Decision

**Option C.** The resource-server validation pipeline, in order:

```text
1. Verify signature (local, via cached JWKS — no network call unless kid is unrecognized)
2. Verify iss (local)
3. Verify aud (local — MUST equal this product/API's own registered audience)
4. Verify exp/nbf (local)
5. Verify scope covers the operation being attempted (local — string-set membership, ADR-016)
6. Resolve principal — human (sub = security_user.id) or service (sub = service_account.id) (local — read from token)
7. Resolve context — tenant_id/organization_id from the token (local, human only; a service token carries none — ADR-015)
8. Authorization — the PRODUCT'S OWN IAM-permission check (namespaced permission codes, ADR-004) — local, using the token's roles/scope plus the product's own business-authorization logic; NOT the Identity Platform's concern (ADR-004 already decided product-namespaced permissions are enforced by the product, never by the Identity Platform)
9. Product entitlement — MUST be checked; MAY be local (a short-TTL cache of `ProductAccessService.canAccess()`, refreshed periodically) or a live call, product's choice, but never skipped and never assumed from token issuance time (entitlement changes are exactly the kind of fast-changing fact §Problem above warns against trusting stale — ADR-011)
10. RLS / database isolation — the product's OWN database's own tenant isolation, using the tenant_id resolved in step 7 (this platform's RLS pattern is a model to follow, not a shared mechanism — each product's data is its own, docs/DATA_OWNERSHIP.md)
```

Steps 1–7 are always local. Step 8 is always local and always the product's own responsibility (never delegated back to the Identity Platform, reaffirming ADR-004). Step 9 (entitlement) is the one step this ADR explicitly allows either local-cached or live, at the product's discretion, because it is bounded, single-purpose, and already has a defined server-side decision function (`ProductAccessService`) a product can call or cache without re-deriving it. Full introspection (Option B, calling `/introspect` for the *entire* validation on every request) is available for a product with unusually high revocation-latency requirements but is not the default and not required.

## Rationale

This is the direct extension of `docs/AVAILABILITY_MODEL.md`'s and ADR-003's already-accepted trade-off (local signature/audience/expiry validation, server-side re-derivation only for what genuinely changes fast) into the multi-product OAuth world — it does not introduce a new philosophy, it operationalizes the existing one into a concrete, numbered pipeline every product implementer can follow without re-deriving the trade-off themselves. Keeping IAM-permission enforcement (step 8) strictly product-local reaffirms ADR-004's namespace-ownership decision; letting the Identity Platform make that call would recreate the "central team must understand every product's business domain" problem ADR-004 already rejected.

## Security implications

A resource server that skips `aud` validation (step 3) is the single most dangerous implementation mistake available to it — a token issued for a different product remains cryptographically valid and would otherwise be accepted (`docs/PHASE_2D_THREAT_MODEL.md`, "cross-product token reuse"). This is called out as a **mandatory**, not advisory, step for exactly this reason (already true under ADR-003; restated here as the first step of a concrete pipeline).

## Operational implications

Every product implementing this pipeline needs a JWKS-caching HTTP client (standard in essentially every JOSE/JWT library) and, if it chooses local entitlement caching, a background refresh job — both are one-time integration costs per product, not a recurring operational burden once built.

## Consequences

The `POST /v1/authorize` "escape hatch" already sketched in `docs/API_BOUNDARY.md` (a real-time, non-cached fine-grained check) remains available for the rare case a product wants a live answer for one specific decision without adopting caching at all — it is the exception path, not the default pipeline.

## Deferred considerations

A formal SLA for JWKS endpoint availability/latency, and a recommended default cache TTL, are operational decisions deferred to the actual key-management implementation phase (`docs/KEY_MANAGEMENT_ARCHITECTURE.md`), not fixed by this ADR.
