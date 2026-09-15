# ADR-016: OAuth/OIDC Token and Scope Model

## Context

ADR-003 already decided asymmetric signing, a mandatory `aud` per `Application`, and "roles + scopes, not full permission expansion" for the existing access token — but was written before Phase 2C's organization-context work and before any OAuth-specific concept (client-issued scope, service token, ID token) existed. `docs/TOKEN_ARCHITECTURE.md` §5 already proposed `tenant_id` + `organization_id` both present (its "Option B," in this ADR's own terms) as an illustrative design, ahead of Phase 2C actually implementing it — Phase 2C's real `AccessTokenClaims` (`tenantId`, `organizationId`, plus `sessionId`/`email`) confirms that design was followed. This ADR is the formal, OAuth/OIDC-aware version of that decision, extending — not reopening — ADR-003.

## Problem

Define, precisely, what belongs in a human access token, a service access token, and an ID token; which OAuth-specific claims (`client_id`, `scope`, `jti`) are needed; and settle the tenant-claim question (brief's Option A/B/C/D) formally for the OAuth surface, not just the existing proprietary one.

## Options — tenant/organization claim presence

**A. `organization_id` only** — cheapest, but a resource server needing tenant-scoped storage (every current product's own DB is tenant-partitioned) would have to make a network call back to the Identity Platform just to resolve which tenant an organization belongs to, on every request. Rejected for the same reason `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md` avoids unnecessary round-trips.

**B. `organization_id` + `tenant_id`** — both present, `organization_id` nullable (tenant-wide/no-selection). Already the design in `docs/TOKEN_ARCHITECTURE.md` §5 and already the actual implementation (Phase 2C `AccessTokenClaims`).

**C. `tenant_id` only** — cheaper still, but loses the organization-context feature Phase 2C exists to provide; a resource server would have no way to know which organization a request is scoped to without a separate call.

**D. No context claims; resolve entirely server-side** — maximally fresh (no staleness window at all), but reintroduces Option B (`docs/ORGANIZATION_CONTEXT.md`'s own rejected option) from the human-login design: a network round-trip on every request, coupling every product's request latency/availability to the Identity Platform's own.

## Decision

**Option B, formally reaffirmed** for both the existing proprietary access token (already shipped) and any future OAuth-issued human access token. `tenant_id`/`organization_id` are present, `organization_id` nullable; both are treated as convenience/routing claims only, never as authorization by themselves — every consuming guard/resource server must still independently verify Membership/Organization/Tenant status for anything access-relevant, exactly as `PermissionsGuard` already does (`docs/ORGANIZATION_CONTEXT_SECURITY.md` §2). A **service** access token carries neither claim (ADR-015) — it is tenant-neutral by design.

Full claim sets:

**Human access token** (existing proprietary shape, unchanged; OAuth-issued shape is additive):
```json
{ "sub": "<security_user.id>", "tenant_id": "…", "organization_id": "… | null",
  "session_id": "…", "client_id": "<application.client_id> (OAuth-issued only)",
  "scope": "<space-delimited, OAuth-issued only>",
  "aud": "<application.client_id or product API identifier>",
  "iss": "<identity platform issuer URL>", "iat": …, "exp": …, "jti": "<uuid>" }
```

**Service access token** (Client Credentials):
```json
{ "sub": "<service_account.id>", "client_id": "<application.client_id>",
  "aud": "<resource API identifier>", "scope": "<space-delimited service scopes>",
  "iss": "…", "iat": …, "exp": …, "jti": "<uuid>" }
```

**ID token** (OIDC, ADR-014):
```json
{ "sub": "<security_user.id>", "aud": "<application.client_id>",
  "iss": "…", "iat": …, "exp": …, "auth_time": …, "nonce": "<from /authorize>" }
```
— never carries `scope`, never carries tenant/organization context, never accepted by any resource server as a bearer credential (see ADR-014).

`jti` (JWT ID) is newly introduced for every token type — needed for the (rarely used, high-security) introspection/revocation-by-id path (`docs/EXTERNAL_API_TRUST_BOUNDARY.md` §Revocation) and for audit correlation, without requiring the whole token to be logged.

## Rationale

Full membership/role/permission/entitlement expansion remains explicitly rejected (ADR-003's own rationale, reaffirmed): each of those changes on a timescale a token's short TTL doesn't need to track, and each is already cheaply re-derivable server-side (`resolveGrants()`, `ProductAccessService`). `scope` is new precisely because it answers a different question than a permission does (`docs/OAUTH_ARCHITECTURE.md` §Scopes vs `docs/AUTHORIZATION_ARCHITECTURE.md`) — "what may this application call" is client-scoped and genuinely appropriate to carry in a token the client itself requested, unlike "what may this user actually do," which stays server-side.

## Security implications

`aud` remains mandatory and per-`Application`/per-resource-API (ADR-003) — the single most important claim a resource server must validate, since it is what prevents a token issued for one product being replayed against another (`docs/PHASE_2D_THREAT_MODEL.md`, "cross-product token reuse"). `jti` enables selective, auditable revocation without requiring session-wide revocation for every high-security event.

## Operational implications

No change to the existing proprietary token's wire shape (still camelCase `tenantId`/`organizationId`/`sessionId`, per `docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md`'s already-shipped `AccessTokenClaims`) — this ADR's snake_case rendering above is the OAuth/OIDC-issued token's own convention (matching standard registered-claim naming), a distinct token issuance path, not a rename of the existing one. `jti` is additive to both.

## Consequences

Products that need a claim not listed here (e.g. a first-party admin console wanting the caller's display name in the token to avoid a lookup) must justify it against this ADR's "no unnecessary authorization/PII data in tokens" principle before it is added — the default answer is "look it up," not "add a claim."

## Deferred considerations

Whether a genuinely external (non-affiliated) third-party integration should receive a narrower claim set (e.g. no raw internal `tenant_id`, only an opaque per-integration reference) is deferred until such an integration is a real, named requirement — every current and near-term product (TravelOS, Healthcare, Gym) is operated by the same organization as the Identity Platform itself, so this distinction is not yet load-bearing.
