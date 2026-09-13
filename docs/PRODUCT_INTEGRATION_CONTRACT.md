# Product Integration Contract

Phase 2D.10 (`docs/PHASE_2D10.md`) — the stable contract between the Identity Platform and any product (TravelOS, Healthcare, Gym, or a future product) that consumes it. This document does not redesign anything — it names, in one place, which of this platform's ALREADY-SHIPPED pieces (Phase 2D.1-2D.9) together form "the contract," and draws the line a product must never cross into Identity-Platform-owned territory.

```text
Identity Platform
        │
   Stable external contract (this document)
        │
        ▼
TravelOS / Healthcare / Gym / future products
```

## 1. Ownership split (brief §4)

| Identity Platform owns | Product owns |
|---|---|
| Authentication, identity, sessions | Business-domain authorization |
| OAuth/OIDC, token issuance, token validation | Business roles/permissions |
| Tenant identity, organization identity/context | Business resources |
| Product entitlement (the fact, not the product's use of it) | Business policies/workflows |
| Service-account identity, cross-product trust | |
| Security audit | |

The Phase 2D.6 `ResourceAuthorizationPolicy` seam (`docs/RESOURCE_AUTHORIZATION_CONTRACT.md`) remains the ONE boundary a product crosses to plug its own decision in. Nothing in Phase 2D.10 moves any business-authorization logic into the Identity Platform, and nothing here gives the Identity Platform new awareness of any product's resources, actions, or permission names — every `productId`/`resource`/`action`/`requiredPermissions` value remains an opaque string this platform never interprets (unchanged from Phase 2D.6 §4).

## 2. The full pipeline (brief §7)

```text
Request
   │
   ▼
Bearer extraction ────────────── Identity Platform (ExternalBearerAuthGuard, Phase 2D.5)
   │
   ▼
JWT validation ─────────────────┐
Issuer validation                │
Signature validation             │  Identity Platform (ExternalAccessTokenValidator, Phase 2D.5)
Audience validation               │  — see docs/RESOURCE_SERVER_ARCHITECTURE.md §4
Temporal validation               │
Claim validation ────────────────┘
   │
   ▼
Principal construction ───────── Identity Platform (AuthenticatedExternalPrincipal, Phase 2D.5/2D.7)
   │
   ▼
Tenant assertion validation ───── Identity Platform (principal.tenantId is the only authoritative source, §4 below)
   │
   ▼
Scope evaluation ──────────────── Identity Platform (ResourceAuthorizationGuard Layer 5, Phase 2D.6)
   │
   ▼
Product entitlement ───────────── Identity Platform DATA + Product's OWN CHOICE to check it (ProductAccessService, Phase 2B.2 — available, never auto-invoked; §5 below)
   │
   ▼
Product-specific authorization ── PRODUCT, exclusively (ResourceAuthorizationPolicy, Phase 2D.6)
   │
   ▼
Business operation ────────────── PRODUCT, exclusively
```

This is exactly `docs/RESOURCE_AUTHORIZATION_CONTRACT.md` §2's seven layers, restated as the brief's own step list so the two documents are provably the same pipeline under two names. See that document for the full layer table, the `AuthorizationDecision` result contract, and the fail-closed rules (missing policy, thrown provider error, ambiguous decision — all denials, never an accidental allow).

## 3. Principal contract (brief §5, §6)

The stable principal shape is `AuthenticatedExternalPrincipal` (Phase 2D.5/2D.7, `src/modules/resource-server/interfaces/`), aliased for product-facing code as `IdentityPrincipal` (`src/contracts/identity-principal.contract.ts`):

```text
type            'USER' | 'SERVICE_ACCOUNT'   — from the token's own principal_type claim, NEVER inferred from sub's shape
subject          the verified sub claim
tenantId         server-validated at token issuance — the ONLY authoritative tenant (§4)
organizationId?  USER only — null (tenant-wide) or a validated organization id
clientId         the registered Application (OAuth client) this token was issued to
audience         the one resource-API audience this token was verified against
scopes[]         parsed from the scope claim — [] means no scopes, never "all scopes"
jti              correlation/logging only — never itself a trust decision
issuedAt/expiresAt/notBefore/issuer
```

Never exposed, in this or any principal-adjacent contract: password hashes, session internals, credential hashes (client secret / service-account secret hashes), security-event internals, private signing key material, or any raw database row. `AuthenticatedExternalPrincipal`'s own doc comment (`src/modules/resource-server/interfaces/authenticated-external-principal.interface.ts`) already states this; Phase 2D.10 adds no new field and removes none.

**ID Token is never a valid product API bearer credential.** Structurally impossible, not merely policy: an ID Token carries no `tenant_id`/`jti` (which `ExternalAccessTokenValidator` requires) and carries `token_use: 'id_token'`, which that validator explicitly rejects (Phase 2D.8, unchanged). See `docs/OIDC_ARCHITECTURE.md` §2.

## 4. Tenant and organization context (brief §9)

`principal.tenantId` — cryptographically validated at token issuance — is the ONLY authoritative tenant for any product decision. A product must never let a client-supplied header (`X-Tenant-Id`, `X-Organization-ID`) override it; the existing, unchanged contract (`assertRequestedTenantMatches`, Phase 2D.5, exercised by `ResourceServerDemoController#tenantBound`) is: if a caller supplies such a header, it must MATCH the validated principal or the request is rejected — it is never used to select a different tenant.

| Scenario | Behavior |
|---|---|
| No organization context | `principal.organizationId` is `undefined` (SERVICE_ACCOUNT) or `null` (USER, tenant-wide) — a product must treat both as "no organization scoping," never as an error |
| Valid organization context | `principal.organizationId` is a string, already validated server-side at authorization-code issuance (Phase 2D.7 §11) — usable as-is |
| Stale organization context | Not separately trackable by a bearer access token today — an access token carries the organization id valid AT ISSUANCE; if the user's organization membership changes mid-token-lifetime, the token remains valid until natural expiry (Phase 2D.6's own documented "TTL-bounded, local-first" semantics — the SAME limitation already accepted for tenant-grant revocation) |
| Wrong organization | A product's own policy denies based on its own business rule; the Identity Platform provides the validated fact only |
CACHE
| Cross-tenant request | Impossible to construct honestly — `principal.tenantId` is one value per token; a request "for" a different tenant is simply a request whose header a product must not honor over the token (see above) |
| Tenant header mismatch | Reject the request — never resolve the conflict by trusting the header |

## 5. Product entitlement vs. everything else (brief §10)

```text
Valid JWT
    │
    ▼
Tenant = T1                                  (Identity Platform — cryptographic fact)
    │
    ▼
Product = TravelOS
    │
    ▼
T1 has ACTIVE TravelOS entitlement            (Identity Platform DATA — ProductAccessService.canAccess, Phase 2B.2)
    │
    ▼
scope = travel.read                           (Identity Platform MECHANISM — OAuth scope, Phase 2D.6 Layer 5)
    │
    ▼
TravelOS IAM permission = booking.view        (PRODUCT — Phase 2D.6 Layer 6, exclusively)
    │
    ▼
ALLOW
```

A valid token alone never implies product access — each link above is independently necessary. `docs/PHASE_2D9.md`/`docs/OAUTH_OPERATIONAL_HARDENING.md`'s rate-limiting and this document's own entitlement layer are two entirely separate concerns (availability vs. authorization) that must never be conflated.

**Live, per-request entitlement checks today**: `ProductAccessService` is an Identity-Platform-internal, database-backed provider — it runs only inside this platform's own process (used today by `ResourceServerDemoController`'s own test/support routes, `tests/phase2d6-resource-authorization.e2e-spec.ts`, `tests/phase2d10-product-integration-contract.e2e-spec.ts`). A genuinely separate product process cannot import it. Today, the freshest cross-process entitlement signal a product has is the state checked automatically AT TOKEN ISSUANCE (`client_credentials`' own `OAuthApplicationPolicyService` eligibility check, Phase 2D.4) — re-requesting a token re-checks it. A dedicated, live, product-callable entitlement-check HTTP endpoint is a **FUTURE ARCHITECTURAL SEAM**, not built this phase (§9 below).

## 6. Service-to-service contract (brief §11)

Unchanged chain, restated as the product-facing sequence a machine integration must satisfy before a token is ever issued:

```text
Application (registered OAuth client)
    │
ServiceAccount (Phase 2D.3)
    │
ServiceAccountTenantGrant — ACTIVE (Phase 2D.3)
    │
TenantProductEntitlement — ACTIVE, Product — ACTIVE (Phase 2B.2)
    │
requested scope allowed for this Application (Phase 2D.2 ApplicationScopePolicy)
    │
requested audience allowed for this Application (Phase 2D.2 AudiencePolicy)
    │
── only then ──
    │
    ▼
Access token issued (Phase 2D.4 client_credentials)
```

Every one of these is already enforced (`OAuthApplicationPolicyService`, `docs/PHASE_2D4.md`) — Phase 2D.10 changes no step, adds no new one. A client credential alone (`client_id`/`client_secret`) has never been sufficient in this platform; this document simply names the existing chain as the product-facing contract.

## 7. Human application contract (brief §12)

Unchanged from Phase 2D.7/2D.8 — Authorization Code + PKCE (S256 only) + OIDC. See `docs/OAUTH_ARCHITECTURE.md` §2-§6 and `docs/OIDC_ARCHITECTURE.md` for the endpoint-by-endpoint contract (`authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, redirect URI/scope/nonce/state requirements). Phase 2D.10 introduces no second login protocol.

## 8. UserInfo contract (brief §14)

`GET /api/v1/oauth/userinfo` — access token only (never an ID Token — see §3), valid `identity-platform-userinfo` audience, `openid` scope, subject derived exclusively from the validated principal (never a query parameter), only scope-authorized claims (`docs/OIDC_ARCHITECTURE.md` §6, unchanged). Phase 2D.9 added rate limiting and durable audit events for this endpoint (`docs/OAUTH_OPERATIONAL_HARDENING.md`); Phase 2D.10 changes nothing about its authentication/claim-release logic.

## 9. Deferred / future architectural seams introduced or reaffirmed by this phase

- A live, product-callable, cross-process entitlement-check HTTP endpoint (§5) — NOT built; the existing "re-issue a token to re-check eligibility" pattern remains the only cross-process freshness mechanism today.
- A published, installable `@identity-platform/contracts` (or per-language SDK) package — NOT built; `src/contracts/` is its design source only (`docs/SDK_BOUNDARY.md`).
- Everything in `docs/PHASE_2D10.md` §Deferred Scope (MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization Grant, Token Exchange, Impersonation, advanced consent, pairwise subjects, ACR/AMR, refresh-token redesign, billing/metering/org-level subscriptions, product-specific IAM, full SDKs, TravelOS runtime integration).
