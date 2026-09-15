# Phase 2D.4 — OAuth 2.0 Client Credentials Flow

## Objective

Implement `POST /oauth/token` (`grant_type=client_credentials`) — the first endpoint that actually issues an externally-verifiable, RS256-signed access token. Authenticates a CONFIDENTIAL `Application`, authenticates the specific `ServiceAccount` acting through it, validates an explicit tenant assertion against `ServiceAccountTenantGrant`, validates `TenantProductEntitlement`+`Product` status, validates scope/audience, and signs a token via the existing (Phase 2D.1) `ExternalTokenService`. See `docs/PHASE_2D_ARCHITECTURE.md`, `docs/adr/ADR-006-service-authentication.md`, `docs/adr/ADR-015-service-tenant-authorization.md`, `docs/adr/ADR-016-token-and-scope-model.md`.

## What was implemented

- **`POST /api/v1/oauth/token`** (`src/modules/oauth/controllers/token.controller.ts`) — `application/x-www-form-urlencoded` only (explicit `Content-Type` check, not merely accepted by accident because Express registers both body parsers globally); `@Public()`, no platform/tenant JWT guard — its own authentication is the OAuth `client_secret_basic` header, parsed and verified entirely inside `ClientCredentialsService`.
- **`ClientCredentialsService`** (`src/modules/oauth/services/client-credentials.service.ts`) — the sole orchestrator, reusing every existing, already-reviewed service rather than reimplementing any rule:
  ```text
  Application (client_secret_basic, verifyClientSecret)
    → OAuthApplicationPolicyService.checkEligibility()   (grant type, product active, scope, audience — Phase 2D.2, reused)
    → ServiceAccount (its own credential, verifyClientSecret, must belong to the authenticated Application)
    → ServiceAccountTenantGrantsService.isGrantActive()  (Phase 2D.3, reused)
    → TenantsService.findById() (ACTIVE)
    → ProductAccessService.canAccess()                   (Phase 2B.2, reused — entitlement ACTIVE + product ACTIVE, composed)
    → ExternalTokenService.sign()                        (Phase 2D.1, reused)
  ```
  No step creates, activates, or mutates any `Application`/`ServiceAccount`/`ServiceAccountTenantGrant`/`TenantProductEntitlement`/`Tenant` row — issuance only ever reads.
- **`verifyClientSecret()`** (`src/common/utils/client-credential.util.ts`) — the first call site in this codebase that actually *verifies* a client/service secret against its stored hash (every prior phase only ever generated/hashed one). `timingSafeEqual` on the digest bytes, not `===` — defense in depth against a comparison-timing side channel. Returns `false` (never throws) for a `null` stored hash (a PUBLIC application) or a length mismatch.
- **`parseBasicAuthHeader()`** (`src/modules/oauth/utils/basic-auth.util.ts`) — RFC 7617 HTTP Basic parsing, returns `null` (never a distinguishing error) for anything malformed.
- **`OAuthTokenError`/`OAuthTokenErrorFilter`** (`src/modules/oauth/errors/`, `src/modules/oauth/filters/`) — every response from this one endpoint is exactly `{error, error_description}` (RFC 6749 §5.2), scoped to `TokenController` only via `@UseFilters` — no other controller's error shape is touched. `AllExceptionsFilter` (this codebase's own envelope) is not globally registered anywhere, so `HttpException`'s own default response body is what actually reaches the client — this class relies on that pre-existing fact rather than fighting it.
- **`ExternalTokenService.getDefaultTtlSeconds()`** — a one-line addition exposing the existing, already-fixed TTL constant, so the response's `expires_in` and the signed token's actual expiry are provably the same number, never a second, independently-maintained value.
- **Tests**: 13 new unit tests (`verifyClientSecret`, `parseBasicAuthHeader`) + 33 new e2e tests (`tests/phase2d4-client-credentials.e2e-spec.ts`), additive to every prior phase's suite.

## Architecture decisions resolved this phase

1. **ServiceAccount authenticates with its own credential, in addition to the Application's.** `docs/adr/ADR-006-service-authentication.md`/`docs/PRODUCT_REGISTRATION.md` §2.4/ADR-018's restored decision describe a ServiceAccount as authenticating "using that Application's own `client_id`/`client_secret`" with no credential of its own. The **actual, already-built, already-PASSED** Phase 2D.3 schema (`docs/PHASE_2D3.md`) gives `ServiceAccount` a mandatory, hashed, one-time-reveal `credential_hash` column — a real, provisioned secret, not a leftover or speculative field. Per this phase's own brief ("Inspect the actual repository first... do not trust documentation blindly. Verify actual runtime behavior") and its explicit instruction ("If the architecture requires an explicit ServiceAccount identifier/credential in addition to the Application client authentication, implement exactly that approved mechanism"), this phase follows the running schema: the token request presents **both** the Application's `client_secret` (proves which client surface is calling) **and** the ServiceAccount's own `service_account_secret` (proves which specific machine identity, among potentially many under that Application, is acting) — two independent credentials, never combined or derived from one another. This is documented here as a transparent resolution of an existing textual/implementation inconsistency, not a silent rewrite of history — the affected ADR/doc text is left as originally written; only an implementation-status note is added (see below).
2. **Product resolution from the requested audience.** `docs/TOKEN_AND_SCOPE_ARCHITECTURE.md` §Audience registration flagged "each Product registers its own resource-API identifier(s)... not built in Phase 2D" as an open gap. Rather than adding a new `Product.resourceAudience` column (a new, separate naming convention to invent and keep consistent), this phase resolves Product directly from the fact that already exists and cannot drift: **the authenticated Application already belongs to exactly one Product** (`application.productId`, Phase 2B, unchanged). The requested `audience` is validated against `Application.audiences` (Phase 2D.2's own `ApplicationAudiencePolicy`, unchanged) — once that passes, the Product for entitlement/status purposes is simply `application.productId`. Zero new columns, zero new tables, no naming convention to invent or later contradict — the Simplification Rule applied to a genuinely open question rather than deferred again.
3. **Request parameters `tenant_id`, `audience`, `service_account_id`, `service_account_secret`** — not present in any prior ADR's illustrative request shape (`docs/EXTERNAL_API_TRUST_BOUNDARY.md` §2's table row predates this phase's own detailed design). Necessary, minimal additions to the standard `grant_type=client_credentials` request body: `tenant_id` is the explicit tenant assertion ADR-015 already requires ("a request parameter, mirroring how a human client states `organizationId`"); `audience` is the standard resource-indicator parameter this platform's own vocabulary already uses everywhere else (`aud`); `service_account_id`/`service_account_secret` are the second credential pair from decision 1 above.
4. **Service token now carries a `tenant_id` claim.** ADR-015's original text says the service token is "tenant-neutral... never carries a `tenant_id`/`organization_id` claim." This phase's own brief (§26/§28) explicitly requires including `tenant_id` ("contextual information... NOT itself authorization authority") when applicable — the same convenience-claim treatment ADR-016 already gives a human token's `tenant_id`. This phase follows the current, explicit brief: `tenant_id` is included, always the server-validated, explicitly-authorized tenant (never a client-supplied value taken on faith), and is never itself consulted for authorization by any code in this platform. `organization_id` is never included — no organization context ever applies to a ServiceAccount (brief §29), consistent with every prior phase's own design.

## Error taxonomy (RFC 6749 §5.2)

| Code | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Wrong `Content-Type`; missing `grant_type`/`tenant_id`/`audience`/`service_account_id`/`service_account_secret` |
| `invalid_client` | 401 (+`WWW-Authenticate: Basic`) | Missing/malformed Basic header; unknown `client_id`; wrong `client_secret`; Application not `CONFIDENTIAL`/`client_secret_basic`; Application not `ACTIVE` — all indistinguishable externally |
| `unauthorized_client` | 400 | Application authenticated successfully but `grantTypes` does not include `client_credentials` |
| `unsupported_grant_type` | 400 | `grant_type` present but not `client_credentials` |
| `invalid_scope` | 400 | Requested scope(s) not a subset of `Application.allowedScopes` |
| `invalid_target` | 400 | Requested audience not in `Application.audiences`, or a wildcard value |
| `access_denied` | 403 | Every downstream-of-authentication denial: ServiceAccount not found/inactive/wrong secret/cross-application, no/suspended/revoked grant, tenant not found/inactive, no/suspended entitlement, inactive product — all collapsed into one generic response (brief §36: never reveal which specific link in the chain broke) |

Every denial (including every `access_denied` sub-case) is recorded as an `OAUTH_TOKEN_DENIED` audit event with a specific, non-public `reasonCode` in `metadata` — the taxonomy above is what the *caller* sees; the full specific reason is always what the *audit trail* records.

## Token claims (actual, verified)

```json
{ "iss": "<OAUTH_ISSUER>", "sub": "<ServiceAccount.id>", "aud": "<requested, authorized audience>",
  "client_id": "<Application.clientId>", "tenant_id": "<validated, authorized Tenant.id>",
  "scope": "<space-delimited, exactly as requested — never silently reduced or expanded>",
  "iat": …, "exp": …, "jti": "<random uuid>" }
```

`kid` is in the token **header**, not the payload (per `ExternalTokenService.sign()`, unchanged from Phase 2D.1). No `organization_id` — never applicable to a ServiceAccount. No `refresh_token` in the response (brief §51 — Client Credentials is machine-to-machine, re-request instead of refresh).

## Security Tests

```text
Full attack matrix (brief §44), all DENY as required: missing grant_type, unsupported grant type,
PUBLIC client, suspended Application, disabled Application, invalid secret, missing credentials,
wrong secret, application not configured for client_credentials, inactive ServiceAccount, wrong
ServiceAccount secret, no grant, suspended grant, revoked grant (indistinguishable from "never
granted"), wrong tenant assertion, inactive tenant (grant left unmutated), no entitlement, suspended
entitlement, suspended product, unauthorized scope, unauthorized audience, wildcard audience (*/all/any),
cross-application ServiceAccount selection, "valid Application credential alone never grants access to
an arbitrary tenant" (the non-negotiable invariant, its own dedicated test).
Positive path: full ACTIVE chain issues a token independently verified via the real JWKS endpoint —
fetched over HTTP, public key reconstructed via crypto.createPublicKey({format:'jwk'}), jwt.verify()
performed for real (never merely jwt.decode()) — confirming sub/aud/iss/client_id/tenant_id/scope/jti/kid.
```

## Concurrency

```text
5 simultaneous valid requests for the same client+tenant: all 200, all distinct jti (no shared/cached
  token reused across concurrent callers).
4+4 concurrent requests for the same ServiceAccount against two different tenants (one granted, one
  not): fully isolated — every granted-tenant response's own tenant_id claim matches its own request,
  the ungranted tenant's requests all 403, zero CLS/context bleed between them.
A grant revocation racing with an in-flight token request: whichever order the race resolves in, a
  request made AFTER both have settled is deterministically denied — no path to a stale-but-still-
  valid authorization decision survives the request that revoked it.
```

## Audit

```text
OAUTH_TOKEN_ISSUED (success) — recorded only AFTER signing actually succeeds (never before).
OAUTH_TOKEN_DENIED (every denial) — reasonCode + applicationId/serviceAccountId/tenantId/productId/
  audience/requestedScopes in metadata, verified directly (by string-search over the stored JSONB) to
  never contain a client_secret, service_account credential, access_token, or private key.
Both use recordPlatformEvent (scope='PLATFORM') — actor_user_id has an FK to security_user(id), which
  neither an Application nor a ServiceAccount is a row in, so their identity is carried in metadata/
  resourceId (resourceType='ServiceAccount'), the same discipline Phase 2D.3 already established for
  entities the audit schema's own actor column cannot represent.
```

## Database

```text
Tables:      0 new
Columns:     0 new
Indexes:     0 new
Constraints: 0 new
RLS:         0 changes
Migrations:  none — this phase is read-only against the existing schema (Product resolved via the
             already-existing Application.productId relationship — see decision 2 above)
```

## Regression

```text
Phase 2A / 2B / 2B.1 / 2B.2 / 2C / 2C-stabilization / 2D.1 / 2D.2 / 2D.3: all still green, unedited.
```

## Tests

```text
Unit:        119/119 PASS (106 pre-existing + 13 new — verifyClientSecret, parseBasicAuthHeader)
E2E:         177/177 PASS (144 pre-existing + 33 new, tests/phase2d4-client-credentials.e2e-spec.ts)
Security:    embedded within the E2E count above (the "Security attack matrix" + "Cross-tenant
             protection" describe blocks, 20 tests) — not a separate suite
Concurrency: embedded within the E2E count above (the "Concurrency" describe block, 3 tests)
```

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    N/A this phase — no schema change
```

## TravelOS Isolation

```text
Files: 0
Dependencies: 0
DB: 0
Migrations: 0
Git history: 0 (no commit made)
```

## Deferred Scope (explicitly confirmed NOT implemented)

Authorization Code, PKCE, OIDC, ID Token, UserInfo, Refresh Tokens (for this grant), Token Exchange, Impersonation, Device Flow, Dynamic Client Registration, MFA, SAML, SCIM, SDKs, Developer Portal, Billing, Subscriptions, Metering, `/revoke`, `/introspect`, `/.well-known/openid-configuration`.

## Known Issues

- **Low**: no rate limiting/abuse protection on `POST /oauth/token` — no reusable rate-limit mechanism exists anywhere in this codebase yet (`@nestjs/throttler` or equivalent is not a dependency). Per brief §37, this is documented as an operational requirement rather than met by introducing a new, unrelated subsystem in this phase: a production deployment of this endpoint should sit behind a per-client and per-IP rate limit (credential brute force, client/tenant enumeration, high-rate token minting are all in scope for that control) before being exposed publicly.
- **Low**: `WWW-Authenticate: Basic` is a static string (`realm="oauth"`) — sufficient for RFC 7617 compliance, not parameterized per-environment; no functional impact.
- **Low**: the e2e test harness (`Test.createTestingModule`) still does not register `main.ts`'s global `ValidationPipe` — the same repo-wide, pre-existing gap noted in every prior phase's own report. This phase's own request validation does not depend on it at all (`TokenRequestDto`'s fields are deliberately all `@IsOptional()`; every real check is manual, inside `ClientCredentialsService`, so behavior is identical with or without the pipe).
- **Low**: `ClientCredentialsService` performs its authorization-chain reads as a sequence of independent queries (Application, then eligibility, then ServiceAccount, then Tenant, then grant, then entitlement) rather than one composed query — consistent with brief §60 ("correct authorization is more important than minimizing queries... optimize only after correctness is established").

## Final Decision

```text
PHASE 2D.4 PASS — READY FOR PHASE 2D.5
```
