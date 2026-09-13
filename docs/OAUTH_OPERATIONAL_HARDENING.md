# OAuth/OIDC Operational Hardening (Phase 2D.9)

Implementation detail document for production operational behavior layered
on the now-complete OAuth/OIDC surface (Phase 2D.1-2D.8). See
`docs/PHASE_2D9.md` for the phase completion report. Every item below is
explicitly labeled **IMPLEMENTED**, **DEFERRED**, **OPERATIONAL
REQUIREMENT**, or **FUTURE ARCHITECTURAL SEAM** (brief §18).

## 1. Rate limiting — IMPLEMENTED

A reusable, provider-neutral abstraction (`src/common/rate-limit/`):

```text
RateLimitStore (interface)  →  InMemoryRateLimitStore (default, in-process)
RateLimitService            →  the one injectable surface application code depends on
RateLimitPolicy              →  {name, windowMs, maxRequests}
RateLimitGuard               →  generic NestJS guard, reads @RateLimited(policyName)
```

Nothing outside `in-memory-rate-limit-store.ts` knows the store is
in-process — a production, multi-instance deployment needing a shared
counter provides a different `RateLimitStore` implementation bound to the
same `RATE_LIMIT_STORE` DI token (`rate-limit.module.ts`); no other file
changes. Redis was deliberately NOT hard-coded (brief §4) — the existing
architecture has no pre-existing Redis dependency to build on, and adding
one merely for this phase would be exactly the kind of scope expansion the
brief warns against.

Applied to all three routes the brief names:

| Route | Policy name | Default | Env override |
|---|---|---|---|
| `GET /oauth/authorize` | `oauth_authorize` | 300 req / 60s | `OAUTH_AUTHORIZE_RATE_LIMIT_MAX` / `_WINDOW_MS` |
| `POST /oauth/token` | `oauth_token` | 300 req / 60s | `OAUTH_TOKEN_RATE_LIMIT_MAX` / `_WINDOW_MS` |
| `GET /oauth/userinfo` | `oidc_userinfo` | 300 req / 60s | `OIDC_USERINFO_RATE_LIMIT_MAX` / `_WINDOW_MS` |

Defaults are deliberately generous — high enough that a legitimate client's
own retry/polling behavior, and this codebase's own pre-existing e2e
suites (which routinely fire dozens of requests per file with no rate
limiting in mind), are never disrupted. An operator tightens these via
environment for a real deployment's own risk tolerance.

**Key strategy** (`rate-limit-key.util.ts`): `client_id` (read from the
request's own query/body, never Basic-auth-derived) + a SHA-256-hashed,
16-hex-char-truncated source identifier. Neither is the raw request as a
whole — changing `state`/`nonce`/`scope`/`redirect_uri`/anything else can
never reset or evade the limit (brief §4, tested directly in
`tests/phase2d9-oauth-operational-hardening.e2e-spec.ts`). The raw source
IP is never logged or stored — only its one-way hash, used purely for
key-equality comparison, the same "opaque bounded correlation fact"
discipline already applied to trace IDs.

**Denial response**: a single, protocol-agnostic `RateLimitExceededException`
(429, `{error: 'temporarily_unavailable', error_description}`, `Retry-After`
header) — the identical envelope shape `OAuthTokenError`/
`ResourceServerAuthError` already produce (a plain `HttpException` with a
plain-object body; no global exception filter exists in this codebase, so
this needs no new filter either). Never reveals whether a `client_id`,
credential, ServiceAccount, or tenant exists (brief §4) — the SAME 429 body
is returned whether the rate-limited request named a real or entirely
fabricated client.

**Confidential clients at `/token`** (Basic auth, no body `client_id`) fall
back to a hashed-source-only key — a documented, deliberate simplification;
the cryptographic integrity of the flow itself (PKCE, redirect_uri
exact-match, atomic code consumption) never depends on rate-limit
granularity.

## 2. Resource consumption limits — IMPLEMENTED

`src/common/constants/size-limits.constants.ts` (`OAUTH_INPUT_MAX_LENGTHS`)
— explicit, generous, `@MaxLength`-enforced bounds on every OAuth/OIDC
input field (`AuthorizeQueryDto`, `TokenRequestDto`). A violation is a
deterministic 400 via the SAME global `ValidationPipe` every other DTO
constraint already uses — never a silent truncation (brief §5). The bearer
token itself is bounded too (`MAX_BEARER_TOKEN_LENGTH` = 8192,
`extractBearerToken`) — rejected BEFORE the JWT-shape regex even runs, so a
pathologically large header value is never handed to the regex engine or
`jwt.verify()` at all.

`TokenRequestDto`'s own pre-existing doc comment explains why MISSING/
invalid-SHAPE fields are validated inside the service layer, not
`ValidationPipe` (to keep client/credential-existence enumeration-resistant
— a generic 400 from a size violation doesn't carry that same risk, since
oversized-ness is not itself a signal about any client/credential/tenant's
existence).

## 3. Request correlation — IMPLEMENTED (reused, not rebuilt)

A correlation/trace-id mechanism ALREADY existed platform-wide
(`JwtAuthGuard.readTraceId()` + `RequestContextService.traceId`,
`x-request-id` accepted in, `x-trace-id` echoed out) — set unconditionally,
even on `@Public()` routes, since `JwtAuthGuard` establishes it BEFORE
checking the `isPublic` flag. This phase's own contribution is wiring it
into every OAuth/OIDC audit event that didn't already carry it
(`AuthorizeService`, `AuthorizationCodeGrantService`,
`ClientCredentialsService`, the new `UserInfoController` audit calls) via
`SecurityEvent.correlationId` (a column that already existed, unused by
these flows until now).

Never an authentication credential, never influences an authorization
decision (verified directly — a denied request stays denied regardless of
which correlation id was supplied), and a client-supplied `x-request-id` is
honored only as an opaque label, bounded implicitly by the same header
size limits Express/Node already apply.

## 4. Security observability — IMPLEMENTED (additive vocabulary + audit gap closed)

**New**: `GET /oauth/userinfo` previously recorded NO audit trail at all
(a genuine gap from Phase 2D.8) — now records `OIDC_USERINFO_ACCESSED`
(success) / `OIDC_USERINFO_DENIED` (failure, with a stable internal
reason code), both correlation-tagged.

**Reason-code vocabulary**: `src/common/constants/oauth-reason-codes.constants.ts`
(`OAuthReasonCodes`) — the stable, `SCREAMING_SNAKE`, brief-matching names
(`OAUTH_RATE_LIMITED`, `OAUTH_INVALID_CLIENT`, `OAUTH_INVALID_REDIRECT_URI`,
`OAUTH_INVALID_PKCE`, `OIDC_NONCE_INVALID`, `OIDC_USERINFO_SCOPE_REQUIRED`,
`RESOURCE_TOKEN_INVALID`, `RESOURCE_TOKEN_WRONG_AUDIENCE`). This is a NEW,
additive layer — NOT a rename of the existing internal `reasonCode` strings
already scattered through `AuthorizeService`/`AuthorizationCodeGrantService`/
`ExternalAccessTokenValidator` (e.g. `'missing_nonce'`,
`'code_already_consumed'`, `'unsupported_algorithm'`), which are already
stable, already tested across ~500 passing assertions, and would be pure
risk to rename for zero security benefit. Crosswalk:

| Canonical constant | Existing internal reason(s) |
|---|---|
| `OAUTH_RATE_LIMITED` | (new — `RateLimitExceededException`, no prior internal string) |
| `OAUTH_INVALID_CLIENT` | `client_not_found`, `invalid_client_secret`, `client_auth_method_not_supported`, `application_inactive` |
| `OAUTH_INVALID_REDIRECT_URI` | `redirect_uri_not_allowed`, `code_redirect_uri_mismatch` |
| `OAUTH_INVALID_PKCE` | `missing_pkce`, `unsupported_pkce_method`, `malformed_code_challenge`, `pkce_verification_failed`, `malformed_code_verifier` |
| `OIDC_NONCE_INVALID` | `missing_nonce` |
| `OIDC_USERINFO_SCOPE_REQUIRED` | `insufficient_scope` (RFC 6750, via `requireScope`) |
| `RESOURCE_TOKEN_INVALID` | every `ResourceServerErrorReason` mapping to `invalid_token` (Phase 2D.5) |
| `RESOURCE_TOKEN_WRONG_AUDIENCE` | `invalid_audience` |

**Never logged, at any log level, in any of this phase's own new code**:
`client_secret`, `service_account_secret`, the authorization code itself,
the access/ID token, the `nonce` value, the PKCE verifier, or a raw
`Authorization` header — unchanged from every prior phase's own discipline,
verified directly (`tests/phase2d9-oauth-operational-hardening.e2e-spec.ts`,
"Telemetry safety").

## 5. Metrics abstraction — IMPLEMENTED

`IdentityMetrics` (`src/common/metrics/`) — `@Global()`, in-process counters
+ bounded duration samples. Forces no concrete monitoring vendor (brief
§8) — a production deployment wires a real exporter behind the SAME
`increment()`/`recordDuration()` surface; nothing else in this codebase
changes. Counter names are a fixed, enumerable set
(`IdentityMetricNames`) — `increment()`'s own signature (a single `name:
string`, no label map) makes a high-cardinality label structurally
impossible to introduce by accident (brief §8: no `user_id`, `email`,
`access_token`, `authorization_code`, `nonce`, or raw IP as a label, ever).

Wired into: `AuthorizeService` (requests/denied/code-issued),
`AuthorizationCodeGrantService` (token-issued/denied, code-redeemed/
replayed, ID-token-issued), `ClientCredentialsService` (token-issued/
denied — a pure additive enrichment, brief §53's regression requirement
unaffected), `UserInfoController` (requests/denied), `RateLimitGuard`
(rate-limited, recorded by `RateLimitExceededException` being thrown — see
below). No `/metrics` HTTP endpoint is exposed — not requested by the
brief, and doing so would be a new, unauthenticated data-exposure surface
this phase's own threat-reduction mandate argues against introducing
without a named requirement.

## 6. Authorization transaction lifecycle — IMPLEMENTED (hardening + cleanup)

Reviewed against the brief's own checklist:

- **issued → pending redemption → atomically consumed → replay denied**:
  unchanged from Phase 2D.7 — `AuthorizationCodesRepository.tryConsume()`'s
  conditional `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`
  remains the sole replay-protection gate, re-verified this phase
  (16-concurrent-redemption test, unmodified).
- **Expired codes never redeemable**: unchanged — `tryConsume` and the
  pre-consume binding checks both independently verify `expiresAt`.
- **Cleanup strategy — NEW**: `AuthorizationCodesRepository.deleteExpiredForTenant()`
  (RLS-scoped, per-tenant, deletes `expiresAt <= now()` rows regardless of
  `consumedAt` — an expired code is equally worthless whether or not it was
  ever redeemed) plus a standalone, cross-tenant maintenance script
  (`database/scripts/cleanup-expired-authorization-codes.ts`, §9 below).
  **Never deletes an unexpired row, consumed or not** (brief §9 — verified
  directly).
- **Index requirements**: `idx_oauth_authorization_code_expires_at`
  already existed (Phase 2D.7) — exactly the index a `WHERE expires_at <=
  ?` cleanup query needs; no new index was required.
- **Concurrent redemption**: unchanged, re-verified.

## 7. Consent boundary — FUTURE ARCHITECTURAL SEAM (deliberately inert)

`ConsentPolicy`/`ConsentContext`/`ConsentDecision`
(`src/modules/oauth/interfaces/consent-policy.interface.ts`) — interfaces
only. **Nothing in this codebase constructs, registers, or calls a
`ConsentPolicy` implementation** — no registry exists for it (unlike
`ResourceAuthorizationPolicyRegistry`, Phase 2D.6, which IS wired into a
real guard). `AuthorizeService` is completely unmodified by this section.
Today's actual, unchanged behavior: first-party applications (every
Application registered today) skip consent entirely
(`docs/OAUTH_ARCHITECTURE.md` §7). The interface exists purely so a FUTURE
phase, once a real third-party application is a named requirement, has a
clean seam to implement against — never a fake persistent consent record
created merely to satisfy this document (brief §10's own explicit
prohibition).

## 8. Key/JWKS operational hardening — REVIEWED, already IMPLEMENTED (Phase 2D.1/2D.5)

Every item on the brief's own checklist, verified against the existing
`JwksClientService`/`SigningKeyService`/`ExternalAccessTokenValidator`
(no code change was needed — all pre-existing):

| Item | Status |
|---|---|
| Algorithm pinning mandatory | ✅ `alg !== 'RS256'` rejected before any signature check, both signing sides |
| `kid` mandatory | ✅ `!header.kid` rejected outright |
| Unknown-`kid` fail-closed | ✅ `getPublicKeyForKid` returns `null`, never throws, caller denies |
| Cached JWKS survives a temporary outage | ✅ `configureJwksUri` deliberately never clears the cache (Phase 2D.5 finding) |
| Refresh amplification bounded | ✅ `minRefreshIntervalMs` cooldown (default 60s), one refresh attempt per unknown-`kid` burst |
| In-flight requests deduplicated | ✅ `this.refreshing` — concurrent callers await the SAME promise, never trigger parallel fetches |
| Atomic cache replacement | ✅ `this.cache = next` — a single reference swap, never a partially-merged view |
| Malformed JWKS cannot poison the cache | ✅ per-entry `try/catch`, a bad entry is skipped, a bad whole-response keeps the OLD cache |
| Private keys never exposed via JWKS | ✅ structural — `SigningKeyService.getJwks()` builds every entry from a `KeyObject` derived from the PUBLIC key PEM alone |
| Key material never logged | ✅ no log line in either service ever includes key material, only `kid`/counts |

**Automatic key rotation is NOT implemented** (brief §11 — "do not
implement automatic key rotation unless the existing configuration
architecture can safely support it" — it does not: rotation requires
coordinated multi-key JWKS publication + a retirement window, which exists
as a MECHANISM (`OAUTH_RETIRED_PUBLIC_KEYS`, Phase 2D.1) but not an
AUTOMATED procedure). **Operational procedure (manual)**:

1. Generate a new RSA keypair; choose a new, unique `kid`.
2. Add the CURRENT `OAUTH_PRIVATE_KEY`'s public half to
   `OAUTH_RETIRED_PUBLIC_KEYS` (still valid for VERIFICATION of
   already-issued, not-yet-expired tokens).
3. Set `OAUTH_PRIVATE_KEY`/`OAUTH_KEY_ID` to the new key/`kid`; redeploy.
4. Any resource server's own `JwksClientService`-equivalent cache picks up
   the new key on its own next scheduled refresh (bounded by its own
   `minRefreshIntervalMs`) — no coordinated "cut-over instant" is required,
   since both old and new keys are simultaneously valid for verification
   during the retirement window.
5. After every token signed with the OLD key has expired (bounded by the
   Access/ID Token TTL), remove it from `OAUTH_RETIRED_PUBLIC_KEYS`.

## 9. Configuration validation — IMPLEMENTED

`src/config/production-config.validation.ts` (`validateProductionConfig`),
wired into `ConfigModule.forRoot({ validate })` (`app.module.ts`) — runs
synchronously BEFORE any module is instantiated. A plain function, not a
class coupling business logic to `process.env` directly (brief §13) —
every other piece of code still reads configuration exclusively through
`ConfigService`, unchanged.

Fails closed on:

- Any of the numeric OAuth/rate-limit env vars (`OAUTH_CLOCK_SKEW_SECONDS`,
  `OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS`,
  `OAUTH_AUTHORIZATION_CODE_TTL_SECONDS`, both rate-limit vars per policy),
  if SET, not being a valid positive number — regardless of environment (a
  malformed number is never valid, in any environment).
- In `APP_ENV=production` specifically: `OAUTH_ISSUER` missing OR left as
  the `.env.example` placeholder value; `OAUTH_PRIVATE_KEY` missing.

This is DEFENSE IN DEPTH, not a replacement for `SigningKeyService`'s own
pre-existing production check (same `OAUTH_PRIVATE_KEY` requirement,
unchanged) — this one simply runs strictly earlier, and additionally
covers values `SigningKeyService` has no reason to know about.

## 10. Error handling — REVIEWED, unchanged (already correct)

Every enumeration-resistance pair the brief lists (unknown vs. inactive
client, wrong secret, unknown service account, wrong tenant, missing/
revoked grant, wrong audience, expired token, unknown `kid`, bad PKCE, bad
nonce, invalid redirect URI) was ALREADY collapsed to the same generic,
non-distinguishing external response by Phase 2D.4/2D.5/2D.7/2D.8 — this
phase adds nothing here except the rate-limit response's OWN
non-distinguishing body (§1 above), verified not to introduce a new
enumeration channel.

## 11. Deferred (explicitly, per brief §19)

MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization
Grant, Token Exchange, Impersonation, token forwarding, advanced consent
management (beyond the inert seam, §7), pairwise subjects, ACR/AMR
framework, refresh-token redesign, SDKs, product-specific IAM, billing,
metering, organization-level product subscriptions, TravelOS integration.

## 12. TravelOS

Zero TravelOS files, dependencies, configuration, database, or Git history
were touched by this phase.
