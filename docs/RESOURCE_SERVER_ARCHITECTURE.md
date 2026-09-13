# Resource Server Architecture

Phase 2D.5 (`docs/PHASE_2D5.md`) — the reusable Resource Server validation boundary for externally-issued (Phase 2D.4, OAuth Client Credentials) access tokens. Builds on, and never modifies, `docs/EXTERNAL_API_TRUST_BOUNDARY.md` (ADR-020's resource-server pipeline design) and `docs/PHASE_2D1.md` (RS256/JWKS foundation) — this document describes what is now actually implemented for steps 1–7 of that pipeline, and the boundary at which product-specific authorization (steps 8–11) begins.

## 1. Trust model

Two structurally separate token trust boundaries exist in this codebase, unchanged by this phase (`docs/EXTERNAL_API_TRUST_BOUNDARY.md` §0):

| | Legacy internal token | External (Resource Server) token |
|---|---|---|
| Algorithm | HS256, `JWT_ACCESS_SECRET` | RS256, JWKS |
| Verified by | `JwtAuthGuard`, inside this platform's own process only | `ExternalBearerAuthGuard` (this phase), any resource server |
| Key material source | In-process shared secret | Public keys fetched over HTTP from a configured JWKS URI |

`ExternalBearerAuthGuard` never accepts an HS256 token, never negotiates algorithm from the token's own header, and is never registered as the global `APP_GUARD` — a route opts into it explicitly (`@UseGuards(ExternalBearerAuthGuard)`), the opposite default posture from the legacy, globally-applied `JwtAuthGuard`.

## 2. Why a second validator, not a reused one (the "resource server models a genuinely separate process" decision)

`ExternalTokenService.verify()` (Phase 2D.1) already validates RS256/issuer/audience/expiry — but it is wired to `SigningKeyService`, the SAME in-process object that also holds this platform's own PRIVATE signing key. That coupling is appropriate for the Identity Platform's own internal round-trip tests (Phase 2D.1's own suite): the issuer verifying its own freshly-signed token. It is the WRONG model for a Resource Server, which in reality is a separate process/deployment (TravelOS, or any future product) with no access to the Identity Platform's private key at all.

`ExternalAccessTokenValidator` (this phase, `src/modules/resource-server/services/`) is therefore a second, correctly-scoped wiring of the identical cryptographic shape (algorithm pin → `kid` → signature → issuer → audience → temporal → required claims), built against `JwksClientService` — a class that fetches public keys over HTTP and never imports `SigningKeyService` at all. This is a structural guarantee, not a convention: a class with no import of `SigningKeyService` cannot leak private key material into the Resource Server boundary even by a future accidental edit.

## 3. JWKS resolution

`JwksClientService` (`src/modules/resource-server/services/jwks-client.service.ts`):

- Fetches from a fixed, operator-configured URI (`OAUTH_JWKS_URI`) — **never** derived from a token's own `iss`/`jku` claim (deriving a key-fetch target from attacker-controlled token content is itself a known SSRF/key-confusion vector).
- Caches every currently-published key in memory, keyed by `kid` — supports as many simultaneously active keys as the JWKS response lists (multi-key rotation overlap, unchanged from Phase 2D.1's own `OAUTH_RETIRED_PUBLIC_KEYS` model).
- Never fetches on every request — only on a cache miss (`kid` not yet known).
- An unknown `kid` triggers at most one refresh attempt per cooldown window (`OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS`, default 60s) — repeated presentation of tokens with fabricated/unknown `kid` values cannot force unbounded outbound fetches (anti-amplification). Concurrent callers during an in-flight refresh share one promise, never one fetch each.
- A refresh failure (network error, non-2xx, malformed body) leaves the existing cache untouched and never throws — an already-cached key continues to verify tokens through a JWKS endpoint's own temporary outage; an unresolvable `kid` during that outage fails closed (`null`, never guessed).
- A single malformed/malicious key entry in an otherwise-valid JWKS response is skipped, never poisoning the rest of the set or failing the whole refresh.

## 4. Signature, issuer, audience, temporal validation

`ExternalAccessTokenValidator.validate(token, expectedAudience)`:

1. Decodes the header only, first — `alg` is compared to the constant `'RS256'` and rejected for anything else (never used to select a verification algorithm — closes the "algorithm confusion"/`alg=none` class of attack structurally, not by convention).
2. Requires a `kid`, resolves its public key via `JwksClientService` — an unresolvable `kid` is rejected before any attempt to interpret the token's own signature.
3. `jsonwebtoken.verify()` performs signature, issuer (`OAUTH_ISSUER`), audience (the caller's own `expectedAudience`, mandatory — never defaulted), and temporal (`exp`/`nbf`, with a small configurable clock-skew tolerance, `OAUTH_CLOCK_SKEW_SECONDS`, default 30s) validation together, in one call — never split into a "check signature" step that could be satisfied independently of the others.
4. Required claims (`sub`, `client_id`, `tenant_id`, `jti`) are then validated for presence AND type (`iat`/`exp` for numeric shape too) — a token that passes cryptographic verification but is missing or malforms one of these is still rejected. `scope` is the one CONDITIONALLY required claim — see §6 below for why.

Every failure produces one of exactly three RFC 6750-shaped codes (`invalid_request`, `invalid_token`, `insufficient_scope`) with an identical, generic description externally — the SPECIFIC internal reason (`unknown_kid`, `invalid_issuer`, `expired_token`, …) is logged (`external_auth_denied reason=...`) but never returned to the caller, closing the "does ServiceAccount/Tenant/Application/Grant exist" enumeration class of leak.

## 5. Required claims vs. the Phase 2D.5 brief's own list — one resolved discrepancy

This phase's own brief (§13) lists `scope` among the CLIENT CREDENTIALS token's required claims. The actual, already-approved and already-tested Phase 2D.4 issuance contract (`docs/PHASE_2D4.md`) omits the `scope` claim entirely when no scope was requested ("omitting scope issues a token with no scope claim — never silently granting one," a real, passing test) — and this phase's own instructions (§2/§39) explicitly forbid modifying Phase 2D.4's issuance behavior "unless required for correctness." Resolving in favor of the already-approved, already-shipped behavior: `scope` is validated as **conditionally required** — if present it must be a string (else rejected), if absent the principal's `scopes` is `[]` ("no scopes granted," the safe, fail-closed reading of absence — never "all scopes"). This is documented here transparently rather than silently reconciled.

## 6. ServiceAccount principal construction

`sub` on a Client Credentials token is always `ServiceAccount.id` (Phase 2D.4, unchanged) — never `Application.id`, never `security_user.id`. `AuthenticatedExternalPrincipal` (`src/modules/resource-server/interfaces/`) is constructed directly from the validated claims:

```typescript
{
  type: 'SERVICE_ACCOUNT',
  subject, serviceAccountId,   // both = the token's own sub, verbatim
  clientId, tenantId, audience,
  scopes: string[],            // parsed via the shared parseScopeClaim() util (also used by Phase 2D.4's own issuance side)
  jti, issuedAt, expiresAt, notBefore?, issuer,
}
```

No database lookup is performed to construct this — the validated token's own claims ARE the principal (a genuine `ServiceAccount`/`Application`/`Tenant` row is never re-fetched merely to validate a request). `ExternalPrincipalType` is a union of exactly one member today (`'SERVICE_ACCOUNT'`) — declared as a union, not a bare literal, so a future human/OIDC-issued token type extends this type rather than silently reinterpreting the same shape for a structurally different principal.

## 7. Tenant context — trusted only because the token is valid

`principal.tenantId` is trusted **only** because it comes from a token this platform itself signed and the validator has cryptographically verified — never because a request header/parameter claims it. A product accepting an explicit tenant request parameter/header (e.g. `X-Tenant-Id`) MUST validate it against `principal.tenantId` and deny on any mismatch — `assertRequestedTenantMatches()` (`src/modules/resource-server/utils/assert-tenant-match.util.ts`) is the reference implementation of that contract, demonstrated by `ResourceServerDemoController`'s `tenant-bound` route and its own e2e tests. A mismatch is a **product-layer authorization** decision (`ForbiddenException`, 403) — not an RFC 6750 Bearer-token-validity failure, since the token itself is perfectly valid; the caller is simply asking to act outside what it authenticates for.

## 8. Organization context — deliberately absent

No `organization_id` exists on a Client Credentials token (Phase 2D.4, unchanged), and this phase introduces no organization concept for a ServiceAccount. `AuthenticatedExternalPrincipal` has no `organizationId` field at all — a ServiceAccount is not a human user and does not inherit Membership/organization semantics; if a future architecture decision ever extends service-identity semantics to include organization context, it is an explicit, separate decision, not something this phase invents by omission.

## 9. Scope handling and the Scope-vs-IAM boundary

`scopes: string[]` on the principal is parsed (space-delimited, via the shared `parseScopeClaim()` — the same function Phase 2D.4's own `ClientCredentialsService` uses to parse a token *request*'s scope parameter, extracted into `src/common/utils/oauth-scope.util.ts` specifically so issuance and validation can never drift on what counts as a valid delimiter) and exposed as-is. **No code anywhere in this module maps a scope string to an IAM permission code.** `requireScope()` (`src/modules/resource-server/utils/require-scope.util.ts`) is an OPTIONAL reference helper a product MAY call (`principal.scopes.includes(x)`) — it is not invoked by `ExternalBearerAuthGuard` itself, and its use is demonstrated only on the test/support `ResourceServerDemoController`, never centralized as a generic authorization mechanism.

## 10. Product entitlement / IAM permission boundary — deliberately NOT built here

This module answers exactly one question: *is this a validly-signed, currently-valid, correctly-audienced token, and who/what does it represent?* It does **not** decide "can this ServiceAccount call this Product," "does this Tenant have an active entitlement," or "does this scope satisfy that IAM permission." Those remain:

```text
Authenticated Principal (this phase)
        ↓
Tenant Context (this phase — principal.tenantId)
        ↓
Product Access / Entitlement   ← ProductAccessService (Phase 2B.2), unchanged, NOT called by this module
        ↓
OAuth Scope Policy              ← the product's own decision (§9 above)
        ↓
Product IAM Permission          ← ADR-004, product-owned, unchanged, NOT called by this module
        ↓
Resource Authorization
```

`ResourceAuthorizationContext` (`src/modules/resource-server/interfaces/resource-authorization-context.interface.ts`) is the safe, flat, inert view a downstream guard/service/product composes this pipeline from — it carries zero product-specific logic and is a straight copy of the principal's own fields, never independently re-derived.

## 11. Revocation semantics

Access tokens are short-lived (`docs/PHASE_2D4.md`'s configured TTL, 900s by default). **A token already issued before a `ServiceAccountTenantGrant`/`TenantProductEntitlement` revocation remains cryptographically valid — and this validator continues to accept it — until it naturally expires**, unless introspection or another explicit revocation mechanism is introduced (neither is built by this phase). This is a deliberate trade-off, not a defect: it is the same local-first validation model `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §3/§4 and `docs/AVAILABILITY_MODEL.md` already establish for every other token type in this architecture, bounded by the token's own short TTL rather than requiring a live database check on every single request.

## 12. Introspection — remains the explicit exception, not the default

This phase introduces **no** mandatory introspection path. Normal validation is exactly `JWT + JWKS + local verification`, with zero live Identity Platform dependency once a key is cached (`docs/EXTERNAL_API_TRUST_BOUNDARY.md` §3, reaffirmed, unchanged). A future caller with a genuinely tighter revocation-latency requirement than a short access-token TTL already provides is where `/introspect` (still unbuilt, `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §2) would apply — not this module.

## 13. Token forwarding / confused deputy

`ExternalBearerAuthGuard` authenticates the caller presenting the token to **this** request; it never accepts an already-validated principal as proof that a DIFFERENT downstream call is authorized, and this codebase introduces no mechanism for one service to forward its incoming bearer token to another as a substitute credential. Every service hop authenticates independently, with its own credential — ADR-021's prohibition (Phase 2D architecture) is preserved exactly, not reopened by this phase. No Token Exchange, no impersonation, no `on_behalf_of`/subject-override parameter exists anywhere in this module.

## 14. Error model

RFC 6750 §3 shape (`{error, error_description}`), via `ResourceServerAuthError`/`ResourceServerErrorFilter` — scoped to routes using `ExternalBearerAuthGuard` only, mirroring Phase 2D.4's own `OAuthTokenError`/`OAuthTokenErrorFilter` scoping discipline (neither is registered globally; this platform's other controllers' error shapes are untouched).

| Code | HTTP | `WWW-Authenticate` | When |
|---|---|---|---|
| `invalid_token` | 401 | `Bearer error="invalid_token"` | Missing/malformed/ambiguous bearer, any cryptographic/claim validation failure — all indistinguishable externally |
| `insufficient_scope` | 403 | `Bearer error="insufficient_scope", scope="insufficient"` | A product's own `requireScope()` check fails |
| (server misconfiguration — a route applied the guard without `@ExpectedAudience`) | 500 | — | Not a caller-triggerable condition; fails closed rather than defaulting to any audience |

A tenant-header mismatch (`assertRequestedTenantMatches`) is a plain `ForbiddenException` (403), deliberately outside this RFC 6750 shape — see §7.

## 15. Observability

No metrics/Prometheus library exists anywhere in this codebase yet — rather than introduce one, this phase uses the same `Logger`-based structured lines `SigningKeyService` already established: `external_auth_success client_id=... tenant_id=... jti=... kid=... aud=...` and `external_auth_denied reason=... {...safe fields...}`. Neither line, nor any exception, ever contains the token itself, a client secret, a ServiceAccount credential, or a private key. Wiring these into a real metrics backend (the `external_auth_*` counters the brief names) is a future operational integration, not built here.

**Security audit**: per-request bearer-validation failures are deliberately **not** written to `SecurityEventsService`/`security_event` — that table's own established convention in this codebase is for durably significant, comparatively low-frequency actions (issuance, admin lifecycle changes), not routine, potentially attacker-triggerable per-request authentication outcomes; writing one row per invalid bearer attempt would itself be a log-flooding/amplification vector on a hot path no existing guard in this codebase accepts either (the legacy `JwtAuthGuard` does not audit a bad-bearer-token rejection per request; only login attempts are separately, durably audited). The structured `Logger` lines above are the here-and-now safe substitute; a durable per-failure audit trail, if a future requirement demands one, is a deliberate, separate addition — not silently assumed.

## 16. Operational requirements

- **`OAUTH_JWKS_URI`** must be set to the Identity Platform's actual reachable JWKS URL for any real, separately-deployed Resource Server. The local-development default (this same process's own endpoint) is not appropriate for any real deployment.
- **`OAUTH_ISSUER`** must match exactly (this is already a Phase 2D.1 operational requirement, reaffirmed unchanged).
- **`OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS`** (default 60000) and **`OAUTH_CLOCK_SKEW_SECONDS`** (default 30) are tunable, but neither should be set to a value that reintroduces the amplification/large-validity-window risks they exist to bound.
- No rate limiting exists on any endpoint using `ExternalBearerAuthGuard` today (same pre-existing gap as `docs/PHASE_2D4.md`'s own Known Issues) — a production deployment should sit behind a per-client/per-IP rate limit.

## 17. Integration contract for a future, genuinely separate product

A real Resource Server (TravelOS, or any future product) integrating against this boundary needs only:

1. This platform's `OAUTH_ISSUER` and its own registered `aud` value (its `Application.audiences` entry, Phase 2D.2).
2. The Identity Platform's actual JWKS URL.
3. Its own copy (or a published SDK, not built by this phase) of the validation shape in §4 — algorithm-pin RS256, resolve `kid` via its own cached JWKS fetch, verify signature+issuer+audience+temporal, validate required claims, construct a principal.
4. Its own product-specific composition of §10's remaining pipeline (entitlement, scope policy, IAM permission) — none of which this platform provides or should provide centrally.

## 18. TravelOS remains unmodified

This entire phase is implemented inside `E:\wrkspc\identity-platform` only. TravelOS is referenced above only as the illustrative "a future real Resource Server" example, exactly as every prior Phase 2D document already does — no TravelOS file, dependency, configuration, or database was read, modified, or referenced by any code in this phase.

## 19. What this document does NOT cover (explicitly deferred, unchanged from `docs/PHASE_2D_ARCHITECTURE.md`)

Authorization Code, PKCE, OIDC login, `/userinfo`, MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization, Token Exchange, Impersonation, introspection as a normal request path, SDKs, and any TravelOS integration work.

## 20. Implementation status (Phase 2D.6, `docs/PHASE_2D6.md`, `docs/RESOURCE_AUTHORIZATION_CONTRACT.md`)

**§10's remaining pipeline (product entitlement, scope policy, IAM permission) is now a real, typed, reusable CONTRACT** — `ResourceAuthorizationPolicy`/`ResourceAuthorizationPolicyRegistry`/`ResourceAuthorizationGuard` (`src/modules/resource-server/authorization/`) — layered on top of `ResourceAuthorizationContext` (now also exposing `jti`) without changing anything this document already describes. `ExternalBearerAuthGuard` remains exactly as designed here — unmodified, first in the guard chain, the sole authority for Layers 1-2. The new `ResourceAuthorizationGuard` is a genuinely separate second guard for Layers 5-7, never merged with the first (`docs/RESOURCE_AUTHORIZATION_CONTRACT.md` §1). Identity Platform still ships no product-specific authorization logic — see that document's own §4/§19 for why.

## 21. Implementation status (Phase 2D.7, `docs/PHASE_2D7.md`, `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`)

**`ExternalPrincipalType`/`AuthenticatedExternalPrincipal` are extended from a union of one (`SERVICE_ACCOUNT`) to a union of two (`SERVICE_ACCOUNT` | `USER`)** — the human, Authorization-Code-issued principal this document's own §Principal construction anticipated as a future extension point. The discriminator is an explicit, optional `principal_type` JWT claim, never inferred from the shape of `sub` (a `security_user.id` and a `ServiceAccount.id` are both UUIDs, structurally indistinguishable by format alone). **Absence of the claim still means `SERVICE_ACCOUNT`** — `ClientCredentialsService` (Phase 2D.4) is completely unmodified by Phase 2D.7 and never sets it, so every machine token — issued before or after this extension shipped — validates identically, with zero behavior change. `serviceAccountId` is relaxed from required to optional (populated only for a SERVICE_ACCOUNT principal); new optional `userId`/`organizationId` fields are populated only for a USER principal. `ResourceAuthorizationContext` gained the same two optional fields, mirrored through `toResourceAuthorizationContext()`. `ExternalBearerAuthGuard`, `ResourceAuthorizationGuard`, `requireScope`/`requireScopes`/`requireAnyScope`, and `assertRequestedTenantMatches` are all completely unmodified by this phase — every one of them operates on the common fields (`tenantId`/`scopes`/`subject`/`jti`) present on both principal types uniformly, requiring no per-type branching anywhere in the existing trust-boundary or authorization-contract code. Verified directly: a Phase 2D.7-issued human token, presented to the existing (Phase 2D.5) `whoami` demo route, is correctly reported as `type: 'USER'` with `serviceAccountId` absent.

## 22. Implementation status (Phase 2D.8, `docs/PHASE_2D8.md`, `docs/OIDC_PROVIDER.md`)

**`ExternalAccessTokenValidator` gains one more rejection, checked FIRST, before any other claim is even read**: a token carrying `token_use: 'id_token'` (the OIDC ID Token's own explicit discriminator, `IdTokenService`) is rejected outright as `invalid_token` (reason `id_token_not_accepted`) — never accepted as a bearer access token by any route in this codebase, including `/userinfo` itself (Phase 2D.8's own new endpoint, which authenticates with this SAME unmodified validator/guard). This is on top of, not instead of, the ID Token's own structural lack of `tenant_id`/`jti` (both already required by `requireStringClaim` since Phase 2D.4/2D.5) — defense in depth, never relying on claim shape alone. `ExternalTokenClaims` gains a matching optional `token_use?: 'access_token' | 'id_token'` field: `ClientCredentialsService` (Phase 2D.4) remains completely unmodified and never sets it (absence still means `'access_token'`, zero behavior change for any pre-existing machine token); `AuthorizationCodeGrantService` (Phase 2D.7) now explicitly sets `'access_token'` on the Access Token it signs, alongside the unmodified `principal_type: 'USER'` claim. No other file in this module (`ExternalBearerAuthGuard`, `ResourceAuthorizationGuard`, the scope-evaluator utilities, `assertRequestedTenantMatches`) required any change — the rejection is entirely contained within `ExternalAccessTokenValidator.constructPrincipal()`. Verified directly: an ID Token issued in the SAME transaction as an Access Token audienced for the demo resource-server route is still rejected there, proving the rejection is enforced via the explicit claim, not an audience-string coincidence.
