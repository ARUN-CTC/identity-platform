# External API Trust Boundary

Detail document for ADR-020. Covers the resource-server validation pipeline, the future OAuth/OIDC API surface, revocation/introspection strategy, multi-product isolation, and Identity Platform availability.

## 0. Legacy proprietary token vs. OAuth/OIDC token — trust boundary (Architecture Gate, Gate 2)

Two structurally distinct token types coexist permanently (ADR-017, as amended — no migration of one into the other):

| | Legacy proprietary token | OAuth/OIDC token |
|---|---|---|
| Algorithm | HS256, `JWT_ACCESS_SECRET` | RS256, per `docs/KEY_MANAGEMENT_ARCHITECTURE.md` |
| Verified by | Only `JwtAuthGuard`, inside the Identity Platform's own process | Any external resource server, via cached JWKS |
| `aud` | None, or a reserved self-referential value | Always present, a real resource-API identifier (mandatory, ADR-016) |
| `kid` | None (no key selection needed — one shared secret) | Always present |
| Used for | `/auth/login`, `/auth/refresh`, `/auth/context/*`, `/me/*` — this platform's own first-party surfaces | `/authorize`+`/token`-issued tokens, presented to product resource servers |

**A resource server built against this architecture is never given `JWT_ACCESS_SECRET` and therefore cannot verify a legacy token even if one were somehow presented to it** — this is a structural fact of key distribution, not a policy a resource server could misconfigure its way around. Symmetrically, `JwtAuthGuard` is configured to verify only HS256 and never receives RS256 key material, so an OAuth-issued token presented to it fails verification outright. Each side's implementation must still **pin its expected algorithm explicitly** rather than trusting the token header's own `alg` claim — accepting whatever algorithm a token claims to use is the "algorithm confusion" attack (`docs/PHASE_2D_THREAT_MODEL.md` #7) and would defeat this structural separation. **No deprecation strategy exists for the legacy path, because it is not being deprecated** — see ADR-017's Gate Review Amendment for the full reasoning.

**Implemented (Phase 2D.1, `docs/PHASE_2D1.md`)**: `ExternalTokenService`/`SigningKeyService` (`src/modules/oauth/`) sign and verify the new RS256 token; `TokenService.verifyAccessToken()`/`verifyPlatformAccessToken()` (`src/modules/jwt/services/token.service.ts`) now explicitly pin `algorithms: ['HS256']`, closing any reliance on an implicit library default. Both directions of cross-verifier rejection (HS256→external verifier, RS256→legacy verifier) are verified directly against real tokens, not simulated — `tests/phase2d1-external-token-trust-boundary.e2e-spec.ts`.

## 1. Resource Server Architecture

Every product API validates a token it receives through the pipeline decided in ADR-020:

```text
Product API
 │
 1. Verify signature           (local — cached JWKS, docs/KEY_MANAGEMENT_ARCHITECTURE.md)
 2. Verify issuer (iss)        (local)
 3. Verify audience (aud)      (local — MANDATORY, this product/API's own identifier only)
 4. Verify kid resolves         (local — refresh JWKS cache once on an unrecognized kid, then reject)
 5. Verify expiry (exp/nbf)    (local)
 6. Verify scope covers the
    operation attempted        (local — string-set membership against the token's `scope`)
 7. Resolve principal           (local — sub: human security_user.id or service ServiceAccount.id)
 8. Resolve context             (local, human tokens only — tenant_id/organization_id from the token)
 9. IAM-permission authorization (LOCAL, product-owned — namespaced permission codes, ADR-004;
    NEVER delegated to the Identity Platform)
10. Product entitlement check   (product's choice: live call to the Identity Platform, or a
    short-TTL local cache of ProductAccessService.canAccess() — never skipped, never assumed
    valid from token-issuance time alone — ADR-011, ADR-020 step 9)
11. Tenant-scoped data access   (the PRODUCT'S OWN database's own RLS/isolation, using the
    tenant_id resolved in step 8 — this platform's RLS pattern is a model to follow, each
    product owns and enforces its own data isolation, docs/DATA_OWNERSHIP.md)
 ▼
Request authorized
```

Steps 1–8 require **zero** live call to the Identity Platform (local JWT validation, per ADR-003/`docs/AVAILABILITY_MODEL.md`). Step 9 is always local and always product-owned. Step 10 is the one step a product may choose to make live or cached — it is the one authorization fact this architecture explicitly allows to be "fresher than the token" without requiring every single request to depend on the Identity Platform's availability.

**Implementation status (Phase 2D.2, `docs/PHASE_2D2.md`)**: step 6's rule (`scope ⊆ application.allowedScopes`) and the equivalent checks for grant type, audience, and redirect URI are now implemented as reusable policy classes (`ApplicationScopePolicy`, `ApplicationGrantPolicy`, `ApplicationAudiencePolicy`, `RedirectUriPolicy` — `src/modules/applications/policies/`), composed into one `OAuthApplicationPolicyService.checkEligibility()` call — see `docs/APPLICATION_AUTHORIZATION.md` §7. No resource server or `/token` endpoint calls this pipeline yet; it is exercised today only by this phase's own tests, ready for a future `/authorize`/`/token` implementation (steps 1–5, 7–11 remain entirely unimplemented, per Phase 2D.1's narrower scope).

## 2. API Surface

Only endpoints actually justified by this phase's architecture are listed — no speculative surface. **`GET /.well-known/jwks.json` is now implemented** (Phase 2D.1, `docs/PHASE_2D1.md`) — every other row below remains design-only, not built.

| Endpoint | Purpose | Caller | Auth | Authz | Request | Response | Security controls | Rate limit | Audit |
|---|---|---|---|---|---|---|---|---|---|
| `GET /.well-known/openid-configuration` | OIDC discovery document | Any relying-party library | None (public config) | None | — | Static JSON (endpoint URLs, supported capabilities) | No secrets ever in this document; served over HTTPS only | Generous (cacheable, low-cost) | Not audited (no security-relevant action) |
| **`GET /.well-known/jwks.json`** — **IMPLEMENTED** (Phase 2D.1) | Publish current + overlap-window public keys | Every resource server | None (public keys) | None | — | JWK Set | Never contains private material — verified structurally (`tests/phase2d1-external-token-trust-boundary.e2e-spec.ts`), not just by convention | Generous | Not audited |
| `GET /authorize` | Human authentication + authorization entry point | Browser, redirected by a product's Application | Existing session cookie or fresh login (existing mechanism) | Client validity, redirect_uri match, requested scope allow-listed for the client, organization-context validation (ADR-019) | `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`, optional `organization_id` hint, optional `nonce` | 302 redirect with `code`+`state`, or an error redirect | Exact redirect-URI match; PKCE mandatory; single-use, short-lived code; full org-context re-validation, never trusting the hint | Standard per-IP/per-session throttling (this is a human-facing, browser-driven endpoint) | `AUTHORIZATION_CODE_ISSUED` |
| `POST /token` | Exchange a code (or refresh token, or client credentials) for tokens | Product's confidential/public client (code exchange); any authorized client (refresh); a service (client_credentials) | `client_secret_basic`/`_post` (confidential) or none (public, PKCE substitutes); `client_id`+`client_secret` (client_credentials) | Code/PKCE/redirect_uri binding validated (authorization_code); refresh-token rotation/reuse-detection (existing mechanism, reused); client scope allow-list (client_credentials) | grant-type-dependent (`code`+`code_verifier`; `refresh_token`; `client_id`+`client_secret`+`scope`) | Access Token (+ ID Token if `openid` was granted, + Refresh Token where applicable) | Single-use code enforcement; PKCE verification; reused-refresh-token theft detection (existing, reused as-is); no long-lived static credentials ever accepted | Per-client throttling (this is a machine-to-machine endpoint, higher ceiling than `/authorize` but still capped) | `TOKEN_ISSUED` (differentiated by grant type), `AUTHORIZATION_CODE_REUSE_DETECTED`, `REFRESH_TOKEN_REUSE_DETECTED` (existing event, reused) |
| `GET /userinfo` | Fetch current identity claims for the granted scopes | The client holding a valid **access** token with `openid` scope | Bearer access token (`aud` = Identity Platform itself) | Scope-gated claim disclosure | — | JSON claims per §OIDC_ARCHITECTURE.md §3 | Always a live read (never stale); standard bearer-token validation | Standard per-token throttling | Not separately audited (a read of the caller's own data) |
| `POST /revoke` | Explicitly invalidate a refresh token or, where supported, an access token by `jti` | The client that holds the token, or a Platform Operator (administrative revocation) | Client authentication (for its own token) or Platform Operator auth (administrative) | The token belongs to the caller, or the caller is an authorized Platform Operator | `token`, `token_type_hint` | 200 (always, per RFC 7009 — never reveals whether the token existed) | No information disclosure about token validity; administrative revocation audited distinctly from self-revocation | Standard | `TOKEN_REVOKED` |
| `POST /introspect` | High-security callers verify current validity/claims of an opaque or short-lived-sensitive token, live | A resource server with an unusually high revocation-latency requirement (the exception path, not the default — ADR-020 §Decision) | Confidential-client or resource-server credential (never an unauthenticated caller — introspection responses can reveal token metadata) | Caller must be a registered resource server for that token's `aud`, or a Platform Operator | `token` | `{active: bool, ...claims if active}` | Only ever called by a trusted resource server, never a public client; rate-limited more aggressively than local validation to reflect its real (Identity-Platform-availability-coupling) cost | Tightly capped — this is the one endpoint explicitly discouraged as a default per-request dependency (ADR-020) | `TOKEN_INTROSPECTED` |

Endpoints explicitly **not** included because nothing in this phase's architecture justifies them yet: a dynamic client registration endpoint (`/register` — clients remain Platform-Operator-registered, ADR-010's boundary unchanged), a device-authorization-grant endpoint (no named requirement), a pushed-authorization-request endpoint (an OAuth 2.1 *option*, not required — deferred until a concrete need for pre-registering authorization requests appears).

## 3. Revocation/Introspection strategy

**Local JWT validation is the default** for the overwhelming majority of resource-server requests (ADR-020) — this is what keeps every product's request latency and availability decoupled from the Identity Platform's own, per `docs/AVAILABILITY_MODEL.md`'s existing, reaffirmed commitment. **Introspection is the exception**, reserved for callers with a genuine, named requirement for tighter revocation latency than a short access-token TTL already provides (e.g. a payment-adjacent operation where even a two-minute window of "already-revoked-but-still-locally-valid" is unacceptable) — not a default every product must adopt.

## 4. Identity Platform availability

**A previously issued, valid, correctly-audienced, unexpired access token remains fully verifiable by a resource server with zero live dependency on the Identity Platform**, per the pipeline in §1 (steps 1–9 are entirely local). If the Identity Platform is unavailable:
- **Continues working**: every already-issued access token's validation and IAM-permission authorization (product-local).
- **Affected**: new token issuance (`/token`, `/authorize`), refresh (a client cannot obtain a new access token once its current one expires), `/userinfo` (always a live read), and any product's *choice* to make its entitlement check (step 10) live rather than cached.
- **The trade-off, made explicit**: dynamic, fast-changing authorization facts (product entitlement, if a product chooses live-checking it) are only as available as the Identity Platform itself — a product that wants entitlement checks to survive a brief Identity Platform outage should cache them with a short TTL rather than checking live on every request, exactly the same choice `docs/AVAILABILITY_MODEL.md` already documents for IAM-permission-adjacent decisions.

## 5. Multi-Product Isolation

```text
Identity Platform
      │
      ├── TravelOS Web        (Application, aud = travelos-api)
      ├── TravelOS API        (resource server, validates aud = travelos-api)
      │
      ├── Healthcare Web      (Application, aud = healthcare-api)
      ├── Healthcare API      (resource server, validates aud = healthcare-api)
      │
      ├── Gym Web             (Application, aud = gym-api)
      ├── Gym API             (resource server, validates aud = gym-api)
      │
      └── Future Product APIs (each: own Application(s), own aud, own resource server)
```

A token minted for `travelos-api` is cryptographically valid (correct signature, correct issuer) but **structurally rejected** by `healthcare-api` or `gym-api`'s own mandatory `aud` check (ADR-020 step 3) — this is the entire mechanism that prevents cross-product token reuse, and it requires no cooperation from the issuing side beyond correctly setting `aud` at issuance time; the enforcement is entirely the resource server's own, independent responsibility (reaffirming why step 3 is called out as the single most important validation step).

## 6. Non-Negotiable Principles — where each is enforced

| Principle | Enforced by |
|---|---|
| Client never directly selects tenant authorization | ADR-019 (`/authorize`'s org hint is validated, never trusted) |
| JWT claims never override server-side authorization | `docs/ORGANIZATION_CONTEXT_SECURITY.md` §2 (unchanged), reaffirmed for OAuth |
| Membership remains proof of organization access | ADR-019, unchanged Phase 2C mechanism |
| Organization context remains session/request security context | ADR-016, ADR-019 |
| Product entitlement separate from authorization | ADR-011 (unchanged), ADR-020 step 9 |
| OAuth scope separate from IAM permission | `docs/APPLICATION_AUTHORIZATION.md` §1 |
| Application identity separate from human identity | ADR-015, ADR-018 |
| Platform Operator separate from organization membership | ADR-010 (unchanged), `docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md` §7 |
| RLS is isolation, not primary authorization | ADR-020 step 11 — each product's own RLS, modeled on but independent of this platform's |
| Valid client credential ≠ universal tenant access | ADR-015 |
| Token for Product A ≠ authorization for Product B | §5 above, ADR-016/ADR-020 mandatory `aud` |
| Secrets never stored in plaintext where avoidable | Unchanged existing mechanism (`clientSecretHash`), `docs/APPLICATION_AUTHORIZATION.md` §6 |
| Private signing keys never leave the Identity Platform | `docs/KEY_MANAGEMENT_ARCHITECTURE.md` §5 |
| Short-lived access tokens preferred | ADR-003 (unchanged), reaffirmed throughout |
| Refresh tokens remain protected and revocable | §21/existing mechanism, unchanged |
| Cross-tenant access fails closed | ADR-015 (no grant = no access, ever) |

## 7. What is explicitly NOT built by this document

Of §2's endpoint list, only `GET /.well-known/jwks.json` exists today (Phase 2D.1) — `/authorize`, `/token`, `/userinfo`, `/revoke`, `/introspect`, and `/.well-known/openid-configuration` do not. The resource-server pipeline in §1 is fully specified but has no reference implementation yet (Phase 2D.1 built only the signing/publication side — §0's structural legacy/external isolation — not a consuming resource server). Sequenced per `docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap.

## 8. Implementation status (Phase 2D.3, `docs/PHASE_2D3.md`)

"Cross-tenant access fails closed" (§6's table, `ServiceAccountTenantGrant` row) is now backed by a real table, not only the ADR-015 decision: `ServiceAccountTenantGrant` (`database/ddl/009_service_account.sql`) is deny-by-default (no row = no access), enforces `UNIQUE(service_account_id, tenant_id)` at the database level, and its lifecycle (`ACTIVE`/`SUSPENDED`/`REVOKED`, with `REVOKED → ACTIVE` reachable only via a dedicated reactivate action) is fully implemented and tested — see `docs/PHASE_2D3.md`. `ServiceAccount` itself (`Application 1───N ServiceAccount`) is also implemented. Neither is consulted by any endpoint in §2's list yet — no `/token` flow exists to populate a service access token's claims from a real `ServiceAccountTenantGrant` lookup, so the trust boundary described in §0–§5 for a service token remains design-only in practice, even though its two supporting tables now exist.

## 9. Implementation status (Phase 2D.4, `docs/PHASE_2D4.md`)

**§2's `POST /token` row is now implemented, for the `client_credentials` grant only.** `client_id`+`client_secret` (`client_secret_basic`, HTTP Basic) is exactly as that row specifies; `scope` likewise. Two request fields not named in that row's original illustrative shape are now required in practice: `tenant_id` (the explicit tenant assertion ADR-015 requires) and `audience` (the resource-indicator this platform's own vocabulary already uses everywhere as `aud`) — plus `service_account_id`/`service_account_secret`, the second credential a Phase 2D.3-shaped `ServiceAccount` (its own `credential_hash`) requires (see `docs/PHASE_2D4.md`'s "Architecture decisions resolved this phase" for why). §1's pipeline is now real for a service token specifically: steps 1–5/7 (signature/issuer/audience/kid/expiry/principal) are exactly what `tests/phase2d4-client-credentials.e2e-spec.ts` independently verifies via a live JWKS fetch; step 9 (product entitlement) is satisfied by the unchanged `ProductAccessService.canAccess()` at *issuance* time — a resource server receiving this token must still independently perform its own steps 1–11 exactly as specified (issuance-time entitlement validation does not substitute for a resource server's own check, which may reasonably re-verify or trust the token's short TTL per its own risk posture). §6's "cross-tenant access fails closed" row is now exercised by real HTTP requests, not only by `ServiceAccountTenantGrantsService`'s own unit-adjacent e2e coverage from Phase 2D.3.

## 10. Implementation status (Phase 2D.5, `docs/PHASE_2D5.md`, `docs/RESOURCE_SERVER_ARCHITECTURE.md`)

**§1's resource-server pipeline now has a reference implementation for steps 1-7** — `ExternalAccessTokenValidator` (`src/modules/resource-server/`) performs signature verification, `iss`/`aud`/`kid`/`exp`/`nbf` validation, and principal resolution (`sub` → `ServiceAccount`), all locally, with zero live Identity Platform dependency once a JWKS key is cached — exactly the "steps 1-8 require zero live call" claim this section already made, now something a live e2e suite (`tests/phase2d5-resource-server.e2e-spec.ts`) actually exercises end to end, over a real TCP socket, rather than merely a design claim. Step 6 (scope-covers-the-operation) is available via the optional `requireScope()` helper — never enforced automatically. Steps 9-11 (IAM permission, product entitlement, tenant-scoped data access) remain entirely unimplemented here, by design (§19 of the Phase 2D.5 brief) — this platform provides the trust boundary, never a product's own authorization decision.

**§0's structural legacy/external separation is now extended one layer further**: `ExternalBearerAuthGuard` (the new, consuming-side guard) is structurally independent of `JwtAuthGuard` — no shared code path, no shared CLS store shape (a dedicated `ExternalPrincipalClsStore`, never `AppClsStore`), never registered as the global `APP_GUARD`. And the new validator itself is structurally independent of `SigningKeyService` (which holds this platform's own private key) — it resolves public keys only via an HTTP-fetched, cached JWKS client (`JwksClientService`), modeling exactly what a genuinely separate resource-server process would do, never reaching into the issuer's own in-process key material.
