# API / Security Contract Freeze — Identity Platform v1

Phase 2D.12 — the final contract and release gate before Phase 2E product integration. This document freezes what external products (TravelOS, Healthcare, Gym, future products) may rely on, and states explicitly what remains outside the frozen surface. It introduces no new protocol behavior — every FROZEN item below was already implemented and tested by Phase 2D.1-2D.11; this phase's own contribution is the freeze declaration itself, the machine-readable artifacts in `docs/contracts/`, and the drift-guard tests that catch a future accidental break.

## 1. Contract domains

| Domain | Status | Detail |
|---|---|---|
| Authentication | **FROZEN** | §2 below |
| OAuth | **FROZEN** | `docs/OAUTH_ARCHITECTURE.md`, `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §3/§5/§6 |
| OIDC | **FROZEN** | `docs/OIDC_ARCHITECTURE.md`, `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §4 |
| Access Token claims | **FROZEN** | `docs/contracts/access-token-claims-v1.schema.json` |
| ID Token claims | **FROZEN** | `docs/contracts/id-token-claims-v1.schema.json` |
| JWKS | **FROZEN** | `docs/OAUTH_OPERATIONAL_HARDENING.md` §8, `docs/contracts/identity-api-v1.json` |
| Principal | **FROZEN** | `docs/contracts/principal-contract-v1.schema.json`, `src/contracts/identity-principal.contract.ts` |
| Tenant | **FROZEN** | §3 below |
| Organization | **FROZEN** | `docs/PRODUCT_INTEGRATION_CONTRACT.md` §4 |
| Product Entitlement | **FROZEN** | `docs/PRODUCT_INTEGRATION_CONTRACT.md` §5 |
| ServiceAccount | **FROZEN** | `docs/PRODUCT_INTEGRATION_CONTRACT.md` §6 |
| Resource Server | **FROZEN** | `docs/RESOURCE_SERVER_ARCHITECTURE.md` |
| Product Authorization | **FROZEN** | `docs/RESOURCE_AUTHORIZATION_CONTRACT.md` — the seam itself is frozen; a real product's own policy implementation is, and remains, **PRODUCT RESPONSIBILITY** |
| Errors | **FROZEN** | `docs/contracts/error-contract-v1.json` |
| Discovery | **FROZEN** | `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §2 |

**FROZEN** means: the shape, semantics, and error behavior described will not change within v1 without a major version bump (§8). **PRODUCT RESPONSIBILITY** means the Identity Platform ships the seam/contract only — no implementation, and none is planned. **IDENTITY PLATFORM RESPONSIBILITY** (used throughout the referenced documents) marks what this platform must keep correct on its own.

## 2. Authentication trust boundaries (frozen)

| Mechanism | Algorithm | Trust boundary | Frozen since |
|---|---|---|---|
| Legacy/internal (tenant login, refresh) | HS256, `JWT_ACCESS_SECRET` | In-process only — never validated by an external resource server | Phase 1 |
| Authorization Code + PKCE (human) | RS256, JWKS | External — any resource server | Phase 2D.7 |
| OIDC (layered on the above) | RS256, JWKS | External | Phase 2D.8 |
| Client Credentials (machine) | RS256, JWKS | External | Phase 2D.4 |
| Platform Operator | HS256, separate secret/claims, `PlatformJwtAuthGuard` | In-process only — structurally cannot reach product authorization (Threat #31) | Phase 2B.1 |

No mechanism ever falls back to another (verified by source review, Phase 2D.11 §C).

## 3. Tenant contract (frozen)

The validated access token's `tenant_id` is the ONLY authoritative tenant. A product MUST NOT accept `X-Tenant-ID`, a query parameter, or any other client-supplied value as an override — if supplied, it must be validated to MATCH the token's own claim, never substituted for it. See `docs/PRODUCT_INTEGRATION_CONTRACT.md` §4 for the full scenario table (missing/valid/stale/wrong organization, cross-tenant request, header mismatch).

## 4. Security invariants (frozen — changing any requires a security architecture review)

```text
Legacy token path            → HS256 only
External OAuth/OIDC path     → RS256 only
alg=none                     → always rejected
Unexpected algorithm          → always rejected
Explicit audience             → always required; wildcards prohibited
Explicit issuer                → always required
Validated token tenant_id      → always authoritative; never overridden by client input
ID Token                       → can never authorize an API call
Access Token                   → can never satisfy ID Token validation
PKCE                           → S256 mandatory; plain always rejected
openid scope                   → nonce always required
state                           → never conflated with nonce
Authorization code              → single-use, atomically consumed, expiration enforced
Service accounts                → an ACTIVE ServiceAccountTenantGrant always required
Entitlements                    → ACTIVE product + ACTIVE entitlement always both required
Platform Operator                → a separate security boundary; never a tenant-token bypass path
```

Every line above is independently test-verified — see `docs/PHASE_2D_THREAT_MODEL.md`'s per-threat "Detection"/test citations and the full regression count in §Tests below.

## 5. Forbidden contract changes (require a major architecture/security review — never a routine PATCH/MINOR change)

```text
Changing the token signing algorithm (HS256 legacy / RS256 external)
Changing token subject (sub) semantics
Changing tenant_id semantics or its authority
Allowing a wildcard or multi-value audience
Accepting an ID Token as an API bearer credential
Making Application != the OAuth Client concept (Application IS the Client — no third identity)
Introducing Token Exchange
Introducing Impersonation
Introducing token forwarding as a supported pattern
Changing ServiceAccount identity semantics
Moving product-specific IAM into the Identity Platform
Removing or weakening entitlement enforcement
Registering AllExceptionsFilter globally (would silently break the OAuth/OIDC wire contract — Phase 2D.11 finding)
```

## 6. Versioning policy

`/api/v1/*` is the current, and only, API version (`app.setGlobalPrefix('api/v1', ...)`, `.well-known/*` correctly exempt per protocol convention — `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §1). Compatibility rules (additive vs. breaking) are defined once, in `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §1 — not restated here to avoid two authoritative copies. No product is ever required to upgrade merely because another product, or this platform, adds a new optional field/scope/error code.

## 7. Change control after freeze

| Class | Definition | Example |
|---|---|---|
| PATCH | Bug fix, no contract change | Fixing a P2002 race (Phase 2D.11) |
| MINOR | Backward-compatible addition | A new optional claim, a new error code, a new scope |
| MAJOR | Breaking contract/security semantics | Anything in §5 above |
| SECURITY HOTFIX | Critical vulnerability remediation | May bypass normal release cadence, but must preserve every invariant in §4 |

## 8. Contract artifacts (authoritative)

```text
docs/contracts/identity-api-v1.json           — REAL OpenAPI 3 document, generated from the running
                                                 application (database/scripts/export-openapi-contract.ts),
                                                 never hand-maintained — cannot silently drift from the
                                                 actual routes/DTOs
docs/contracts/access-token-claims-v1.schema.json
docs/contracts/id-token-claims-v1.schema.json
docs/contracts/principal-contract-v1.schema.json
docs/contracts/error-contract-v1.json          — drift-guarded against the real HttpException classes by
                                                 src/contracts/contract-artifacts.spec.ts
```

One authoritative definition per contract — no duplicate/conflicting artifact exists.

## 9. Deferred (v1 explicitly excludes)

MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization Grant, Token Exchange, Impersonation, token forwarding, advanced consent management, pairwise subjects, ACR/AMR framework, refresh-token redesign, SDK implementations, billing, metering, organization-level product subscriptions, product-specific IAM, TravelOS runtime integration.

## 10. Tests

See `docs/PHASE_2D12.md` §Tests for exact counts. Contract tests: `src/contracts/contract-artifacts.spec.ts` (drift guard for the JSON artifacts) plus the full existing regression suite (Phase 2D.1-2D.11, unmodified), which already exercises every security invariant in §4.
