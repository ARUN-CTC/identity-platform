# OAuth Authorization Code + PKCE (Phase 2D.7)

Implementation detail document for the human-user OAuth Authorization Code
grant. Builds on, and does not redesign, `docs/OAUTH_ARCHITECTURE.md`
(design), `docs/EXTERNAL_API_TRUST_BOUNDARY.md` (trust boundary),
`docs/RESOURCE_SERVER_ARCHITECTURE.md` (Phase 2D.5, principal/validation),
and `docs/RESOURCE_AUTHORIZATION_CONTRACT.md` (Phase 2D.6, product
authorization). See `docs/PHASE_2D7.md` for the phase completion report.

## 1. Flow

```text
User                Product App           Identity Platform
 │                       │                        │
 │  wants to sign in     │                        │
 ├──────────────────────>│                        │
 │                       │  generate code_verifier,│
 │                       │  code_challenge = S256  │
 │                       │  (code_verifier), state │
 │                       │  GET /oauth/authorize   │
 │                       │  Authorization: Bearer  │
 │                       │   <existing session>    │
 │                       ├───────────────────────>│
 │                       │                         │  client + redirect_uri
 │                       │                         │  (exact match) validated
 │                       │                         │  response_type/PKCE/
 │                       │                         │  scope/audience validated
 │                       │                         │  organization context
 │                       │                         │  revalidated live
 │                       │                         │  product entitlement
 │                       │                         │  checked
 │                       │                         │  issue single-use code
 │                       │  302 redirect ?code=&    │
 │                       │   state=                │
 │                       │<───────────────────────┤
 │                       │  verify state matches    │
 │                       │  POST /oauth/token       │
 │                       │  grant_type=             │
 │                       │   authorization_code     │
 │                       │  {code, code_verifier,   │
 │                       │   redirect_uri}          │
 │                       ├───────────────────────>│
 │                       │                         │  atomic single-use
 │                       │                         │  consume + PKCE verify
 │                       │  {access_token, ...}     │  -> RS256 human token
 │                       │<───────────────────────┤
```

No consent screen, no ID token, no refresh token — see §7/§16/§Known
limitations.

## 2. PKCE

`S256` only. `code_verifier` (RFC 7636 §4.1: 43-128 unreserved characters)
→ `code_challenge = BASE64URL(SHA256(code_verifier))`, presented at
`/authorize` and re-derived at `/token` for comparison
(`src/modules/oauth/utils/pkce.util.ts`). `plain` is rejected outright — the
only accepted `code_challenge_method` value is the literal string `S256`.
Comparison is `crypto.timingSafeEqual` over equal-length buffers (a length
mismatch is resolved to `false` directly, never thrown).

## 3. Public vs. confidential clients

Reuses Phase 2D.2's `TokenEndpointAuthMethodPolicy` unchanged:
`CONFIDENTIAL` → `client_secret_basic` (HTTP Basic, mandatory at `/token`);
`PUBLIC` → `none` (no secret; PKCE is its only proof of possession). PKCE is
mandatory for **every** client type, not only PUBLIC ones (OAuth 2.1,
already-approved ADR-013). `AuthorizationCodeGrantService` resolves the
calling Application in one of two mutually exclusive ways:

- an `Authorization: Basic` header present → authenticate as a
  CONFIDENTIAL client (`tokenEndpointAuthMethod === 'client_secret_basic'`
  required — a CONFIDENTIAL Application can never downgrade itself to
  `none` merely by omitting the header, which would let a stolen
  `client_id` alone pass as a public client).
- no Basic header → require a `client_id` in the request body, and require
  `tokenEndpointAuthMethod === 'none'`.

## 4. Redirect URI — exact match, never trusted before validated

Reuses Phase 2D.2's `RedirectUriPolicy.isRedirectUriAllowed()` unchanged —
exact string match, no normalization. The single most security-critical
ordering rule in `AuthorizeService`: `client_id` and `redirect_uri` are
validated **together, first**, via
`OAuthApplicationPolicyService.checkEligibility()`. Any failure up to and
including that point — unknown/inactive client, application not configured
for `authorization_code`, or an unregistered `redirect_uri` — is returned as
a **direct** `{error, error_description}` JSON response (never a redirect).
Only once `redirect_uri` is a confirmed, exactly-registered value does every
subsequent failure become an HTTP 302 redirect carrying
`error`/`error_description`/`state` — this is what makes an attacker-
supplied unregistered `redirect_uri` structurally incapable of ever
receiving a redirect at all, closing the open-redirect / prefix / suffix /
query-manipulation attack class outright.

## 5. Authorization code lifecycle

```text
ACTIVE ──consume (atomic)──> CONSUMED
ACTIVE ──ttl elapses────────> (treated as EXPIRED at redemption time)
```

- **Storage**: `oauth_authorization_code` (new table, Phase 2D.7) — see §6.
- **Shape**: a cryptographically random, tenant-prefixed opaque value —
  `TokenService.generateAuthorizationCode()` reuses the exact
  `base64url(tenantId).secret` + SHA-256-hash-only-storage shape already
  established for refresh/password-reset/invitation tokens (a distinctly
  named method, not a silently-reused one — §6 below). Never a JWT, never a
  UUID alone, never sequential/timestamp-based.
- **Lifetime**: `OAUTH_AUTHORIZATION_CODE_TTL_SECONDS`, default 60.
- **Binding**: `application_id`, `user_id`, `tenant_id`, `organization_id`
  (nullable), `redirect_uri`, `audience`, `scopes`, `code_challenge`,
  `code_challenge_method`. Every one of these is fixed at issuance and
  re-checked byte-for-byte at redemption; none is re-derived or re-trusted
  from the `/token` request itself (`redirect_uri`/`code_verifier` are
  re-*presented* by the client and *compared* against the stored value,
  never used to look anything up).
- **Single-use**: `AuthorizationCodesRepository.tryConsume()` — an atomic
  conditional `UPDATE ... WHERE code_hash = ? AND consumed_at IS NULL AND
  expires_at > now()`, `count() === 1` is the only proof of a win. See §8.

## 6. Why a dedicated table, not `SecurityRefreshToken`/a JWT

An authorization code is a fundamentally different artifact from a refresh
token: single exchange, seconds-scale lifetime, no rotation/reuse-detection
chain, no `SecuritySession` binding of its own (§9 — the human session that
issued it long outlives it). Overloading `SecuritySession`/`Application`/
`ServiceAccount`/`SecurityRefreshToken` with this state, as the brief
explicitly warns against, would blur that boundary. `oauth_authorization_code`
is its own table, TENANT-scoped (ordinary `apply_tenant_rls`, same
convention as `service_account_tenant_grant`), reached through exactly
three repository methods (`create`/`findByCodeHash`/`tryConsume`) and no
tenant-facing CRUD endpoint of any kind.

The acting tenant is never a caller-suppliable parameter at `/token` — it is
parsed from the code's own opaque prefix (`TokenService.parseAuthorizationCode`)
*before* the repository is ever called, exactly mirroring how
`RefreshTokensRepository`/`PasswordResetTokensRepository` resolve tenant
context for a pre-authentication flow. This makes "use tenant A's code
against tenant B" structurally unrepresentable, not merely denied by a
runtime check.

## 7. Consent

No persistent consent subsystem is built in this phase. Requested scopes
== approved scopes == issued scopes — `AuthorizeService` never silently
expands or narrows what the client requested, and never issues a scope the
Application itself isn't allowed to request
(`ApplicationScopePolicy.validateRequestedScopes`, reused unchanged from
Phase 2D.2). This matches `docs/OAUTH_ARCHITECTURE.md` §7's own
already-approved design: first-party trusted applications (every
Application registered on this platform today) skip an explicit consent
screen. A genuine third-party consent-management subsystem remains
deferred until a real third-party application is a named requirement.

## 8. State

Treated as opaque client data throughout — never parsed, never persisted
into a durable security event (brief §44), preserved byte-for-byte and
echoed on both the success redirect and every denial redirect that happens
after `redirect_uri` is validated. Never present at all on a
pre-`redirect_uri`-validation direct-JSON error (there is nowhere safe to
put it — no redirect happens).

## 9. User binding

The code binds to `SecurityUser.id` — via `RequestContextService.userId`,
itself populated by the platform's own existing, unmodified `JwtAuthGuard`
from an already-verified session. Never `email`, never `Application.id`,
never `ServiceAccount.id`. `GET /oauth/authorize` is deliberately **not**
`@Public()` — it is the one new endpoint in this phase that runs *behind*
the platform's global human-authentication guard, not in front of or
instead of it. No new login page/mechanism is introduced: an unauthenticated
request is rejected by `JwtAuthGuard` itself, before `AuthorizeService` is
ever called.

## 10. Tenant

Server-derived from the SAME authenticated session (`RequestContextService.tenantId`)
that resolved `userId` — never a request parameter, never independently
re-derived. `AuthorizeService` additionally re-checks the tenant's own
`status === 'ACTIVE'` as defense in depth (mirrors the entitlement check
Phase 2D.4's `ClientCredentialsService` already performs at issuance for the
machine flow).

## 11. Organization context

A requested `organization_id` (or, if omitted, the session's own ambient
selection) is **never** trusted on its own — it is independently
revalidated, every time, against the authenticated user's own **live**
`Membership` (`ACTIVE`) and the target `Organization`'s own `ACTIVE` status,
exactly mirroring `AuthenticationService`'s own refresh()-time
revalidation (Phase 2C). A stale/foreign/no-longer-valid selection is
denied (`access_denied`) rather than silently downgraded to tenant-wide —
the caller must re-authorize with a valid context, never be surprised by a
silently narrower one. The *resolved* `organization_id` (or `null` for
tenant-wide) is bound into the authorization code and carried, unchanged,
into the issued token — a `/token` request has no `organization_id`
parameter of its own to override it with.

## 12. Scope validation

Reuses `ApplicationScopePolicy` (Phase 2D.2) unchanged — no second scope
registry, no new namespace rule.

## 13. Audience

Required, explicit, validated against the Application's own `audiences`
allow-list (`ApplicationAudiencePolicy`, Phase 2D.2, reused unchanged) —
"one token, one audience," matching the Client Credentials flow's own
model. Bound into the code at issuance; **never** re-requested or
re-validated at `/token` — the code's own stored `audience` is what the
issued token is signed for, unconditionally.

## 14. Token issuance

Reuses `ExternalTokenService.sign()`/`SigningKeyService` completely
unchanged (Phase 2D.1) — same RS256/`kid`/JWKS signing path as the Client
Credentials flow. Conceptual claim set:

```json
{
  "iss": "<issuer>",
  "sub": "<SecurityUser.id>",
  "aud": "<the code's own bound audience>",
  "client_id": "<Application.clientId>",
  "tenant_id": "<the code's own bound tenantId>",
  "organization_id": "<the code's own bound organizationId, if any>",
  "scope": "<the code's own bound, space-delimited scopes>",
  "principal_type": "USER",
  "iat": 0, "exp": 0, "jti": "<unique>"
}
```

## 15. Human vs. service principal — `principal_type`

An explicit, optional claim — `'USER'` or `'SERVICE_ACCOUNT'` — read by
`ExternalAccessTokenValidator` (Phase 2D.5) to construct
`AuthenticatedExternalPrincipal.type`. **Absence means `SERVICE_ACCOUNT`**:
`ClientCredentialsService` (Phase 2D.4) is completely unmodified by this
phase and still never sets this claim, so every machine token — issued
before or after this phase shipped — validates identically. Never inferred
from the shape of `sub` (brief's own explicit prohibition) — a
`SecurityUser.id` and a `ServiceAccount.id` are both UUIDs, structurally
indistinguishable by format alone; the claim is the only discriminator.
`AuthenticatedExternalPrincipal.serviceAccountId`/`.userId` are each
populated only for the type they name (`undefined` otherwise) — checked via
`.type`, never guessed. See `docs/RESOURCE_SERVER_ARCHITECTURE.md`'s own
updated principal section.

## 16. Refresh tokens — deliberately not issued (deferred)

The existing `SecurityRefreshToken` system is tightly bound to the legacy
HS256 `SecuritySession` model (rotation/reuse-detection keyed on
`session_id`) and has no analog for an RS256 external OAuth token, which has
no `SecuritySession` of its own. Building a second, parallel refresh-token
implementation for this flow is exactly what the brief prohibits ("do not
create a second refresh-token implementation"). The Authorization Code
grant therefore issues an access token only (`expires_in` bounded, short —
same TTL as Client Credentials), no `refresh_token` field in the response.
A client must re-run the full `/authorize` → `/token` round trip once the
access token expires. This is a deliberate, documented limitation, not an
oversight — see Known limitations in `docs/PHASE_2D7.md`.

## 17. Error semantics

`/authorize`: pre-`redirect_uri`-validation → direct JSON, `invalid_request`
(400) or `unauthorized_client` (400); post-validation → HTTP 302 redirect
with `error`/`error_description`/`state` (`invalid_request` /
`unsupported_response_type` / `invalid_scope` / `invalid_target` /
`access_denied`). `/token`: `invalid_client` (401, `WWW-Authenticate:
Basic`), `invalid_request` (400), `unauthorized_client` (400),
`invalid_grant` (400 — every code-related failure: not found, expired,
already consumed, client/redirect_uri mismatch, bad PKCE verifier — all
collapsed into this ONE code, the specific reason recorded only in
non-client-visible audit metadata). No response, ever, reveals whether a
`client_id`/authorization code/user/tenant/organization *exists* to a caller
not authorized to know that.

## 18. Security threats — representative matrix (full list in the brief; `tests/phase2d7-authorization-code-pkce.e2e-spec.ts` covers each reachable one directly)

| # | Threat | Outcome |
|---|---|---|
| 1-3 | Unknown / inactive / not-authorization_code-configured client | Direct 400/`unauthorized_client`, never redirected |
| 6-12 | Missing `client_id`, missing/unregistered/prefix/suffix/query-mutated/open-redirect `redirect_uri` | Direct 400, never redirected |
| 4-5 | Missing/unsupported `response_type` | Redirect, `invalid_request`/`unsupported_response_type` |
| 13-16 | Missing PKCE / `plain` method / malformed challenge / wrong or malformed verifier | `invalid_request` at `/authorize`, `invalid_grant` at `/token` |
| 17-20,23 | Replay, expiry, client/redirect_uri mismatch, substitution | `invalid_grant`, generic |
| 24 | 16 concurrent redemptions of one code | Exactly 1 success, 15 `invalid_grant` |
| 25-26 | Escalated/unknown scope | `invalid_scope` |
| 30 | Unauthenticated `/authorize` request | 401, before any code exists |
| 31-33 | User/ServiceAccount/Application confusion | Structurally impossible — `sub` is one or the other, `principal_type` explicit |
| 35-36 | Wrong audience / issuer | Rejected by the SAME `ExternalAccessTokenValidator` as any other external token |
| 37-39 | Tenant/organization override, cross-tenant authorization | Server-derived tenant + independently-revalidated organization — no caller-controlled override channel exists |
| 40 | `/token` grant confusion | `client_credentials` behavior fully regression-tested unchanged |
| 45-46 | Token leaked via URL / parameter pollution | No token in any URL, ever; duplicate query params rejected pre-validation by the global `ValidationPipe` |
| 48-49 | Concurrent `/authorize` requests, CLS contamination | Each request's own CLS store, same guarantee as every prior phase |
| 50 | Ambiguous/erroring path | Fails closed throughout — no `try/catch → allow` anywhere in this phase's code |

## 19. Concurrency

`tests/phase2d7-authorization-code-pkce.e2e-spec.ts` fires 16 concurrent
`/token` requests presenting the identical code; exactly one receives `200`,
the other 15 receive `400 invalid_grant`. The guarantee is
`AuthorizationCodesRepository.tryConsume()`'s single atomic conditional
`UPDATE`, never an application-level pre-check.

## 20. Audit

`OAUTH_AUTHORIZATION_CODE_ISSUED` / `OAUTH_AUTHORIZATION_DENIED` (at
`/authorize`), `OAUTH_AUTHORIZATION_CODE_REDEEMED` / `_DENIED` / `_REPLAYED`
(at `/token`) — tenant-scoped events via the existing
`SecurityEventsService`, or a `PLATFORM`-scope event for the handful of
`/token` denials that happen before any tenant is even known (a malformed
code, missing parameters). Never logs the authorization code itself, the
`code_verifier`, a client secret, an access token, or the client-controlled
`state` value.

## 21. Rate limiting (operational requirement, not built this phase)

No reusable rate-limiting subsystem exists in this codebase yet (same gap
carried from every prior OAuth phase). `/authorize` and, especially,
`/token`'s authorization-code-redemption and PKCE-verifier-comparison paths
are natural targets for brute-force/enumeration attempts and should be
rate-limited at the infrastructure layer (reverse proxy / API gateway) until
a first-party rate-limiting capability exists. Documented here as an
operational requirement per the brief; not weakened by its absence — every
comparison in this phase is still constant-time/atomic/fail-closed
regardless of request volume.

## 22. Explicitly deferred

OIDC (`id_token`, `openid` scope semantics, `/userinfo`, `nonce`, discovery
changes) — Phase 2D.8. TravelOS integration — no TravelOS file, dependency,
config, or database was touched by this phase; TravelOS remains a future
integration target only. Product-specific IAM — this phase adds zero
product-specific permission/resource/action code; `ResourceAuthorizationGuard`/
`ResourceAuthorizationPolicy` (Phase 2D.6) are unmodified and apply to a
human-issued token identically to a machine-issued one.
