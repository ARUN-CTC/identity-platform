# Phase 2D.7 — OAuth Authorization Code + PKCE

## Objective

Add the human-user OAuth 2.1 Authorization Code grant with mandatory PKCE
(`GET /oauth/authorize`, `POST /oauth/token` with
`grant_type=authorization_code`) alongside the existing machine
`client_credentials` flow (Phase 2D.4), without redesigning any completed
architecture (2D.1-2D.6) and without introducing OIDC. See
`docs/OAUTH_AUTHORIZATION_CODE_PKCE.md` for the full design.

## What was implemented

- **`GET /oauth/authorize`** (`AuthorizeController`/`AuthorizeService`, new)
  — runs *behind* the platform's existing, unmodified, global `JwtAuthGuard`
  (never `@Public()`): the caller must already hold a valid platform
  session. Validates client + redirect_uri (exact match, reusing Phase
  2D.2's `RedirectUriPolicy`/`OAuthApplicationPolicyService` unchanged) —
  every failure up to that point is a direct JSON error, never a redirect.
  From there, response_type/PKCE (S256 only)/scope/audience are validated,
  organization context is independently revalidated live against the
  user's own Membership, tenant status and product entitlement are
  checked, and a single-use, PKCE-bound authorization code is issued and
  redirected back with `?code=&state=`.
- **`oauth_authorization_code`** (new table, new Prisma model, new DDL +
  migration) — TENANT-scoped (`apply_tenant_rls`), hash-only storage of a
  cryptographically random, tenant-prefixed opaque value (the same shape
  already used for refresh/password-reset/invitation tokens). Reached
  through exactly three repository methods
  (`AuthorizationCodesRepository`: `create`/`findByCodeHash`/`tryConsume`)
  — no tenant-facing CRUD endpoint of any kind.
- **`TokenService` extension** (`src/modules/jwt/services/token.service.ts`)
  — `generateAuthorizationCode`/`hashAuthorizationCode`/
  `parseAuthorizationCode`/`authorizationCodeTtlSeconds` (default 60s),
  reusing the exact opaque-value shape `generateRefreshToken` already
  established, under a distinct method name (brief §36 — separate
  lifecycle, same underlying pattern).
- **`POST /oauth/token` extension** (`TokenController`, modified) — now
  routes `grant_type=authorization_code` to the new
  `AuthorizationCodeGrantService`, *before* falling through to the
  completely unmodified `ClientCredentialsService.issueToken()` path for
  everything else. Atomically consumes the code
  (`AuthorizationCodesRepository.tryConsume`, a conditional `UPDATE`, the
  actual replay-protection gate) only after every binding check (client,
  redirect_uri, PKCE, expiry, already-consumed) passes, and signs the token
  only after that atomic consume succeeds.
- **Human/service principal distinction** — an explicit, optional
  `principal_type: 'USER' | 'SERVICE_ACCOUNT'` claim.
  `ExternalAccessTokenValidator` (Phase 2D.5) now branches on it;
  `AuthenticatedExternalPrincipal`/`ResourceAuthorizationContext` gained
  optional `userId`/`organizationId` fields (`serviceAccountId` relaxed to
  optional). **Absence of the claim still means `SERVICE_ACCOUNT`** —
  `ClientCredentialsService` is completely unmodified and never sets it, so
  every machine token validates identically to before this phase.
- **No OIDC, no ID token, no persistent consent, no refresh token, no
  product-specific IAM** — all explicitly deferred; see §22 of
  `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`.

## Security Results

Full representative threat matrix passes (`docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`
§18): unknown/inactive/misconfigured client and every redirect_uri attack
variant (unregistered/prefix/suffix/query-mutation/open-redirect) are
rejected as a **direct** error, never a redirect; every check after
redirect_uri validation (response_type, PKCE, scope, audience, organization
context, entitlement) is delivered as a redirect with `error`/
`error_description`/`state`; PKCE `plain` is rejected outright, only `S256`
is ever accepted; a wrong/malformed verifier, an expired code, a
client/redirect_uri-mismatched code, and a replayed code all collapse to
the identical `invalid_grant` at `/token`; 16 concurrent redemption
attempts of one code yield exactly 1 success and 15 failures; a
CONFIDENTIAL client cannot downgrade itself to public auth by omitting the
Basic header; an unauthenticated `/authorize` request is rejected before
any code is ever created; a tenant lacking product entitlement is denied
even after successful human authentication; a token issued by this phase
flows through the completely unmodified Phase 2D.5 resource-server guard
and is correctly reported as `type: 'USER'`, distinct from a
`SERVICE_ACCOUNT` principal, with `serviceAccountId` absent.

## Tests

```text
Unit:  210/210 PASS (190 pre-existing + 20 new: pkce.util.spec.ts)
E2E:   254/254 PASS (218 pre-existing + 36 new: tests/phase2d7-authorization-code-pkce.e2e-spec.ts)
```

New e2e coverage includes: full positive flow (confidential + public
client) with independent JWKS-based cryptographic verification of the
issued token's claims; single-use/replay protection (sequential and 16-way
concurrent); the complete client/redirect_uri-never-redirected matrix;
every post-redirect_uri-validation denial (response_type, PKCE variants,
scope, audience, organization context, product entitlement); every
`/token` denial (wrong/malformed verifier, redirect_uri mismatch, IDOR
cross-client redemption, expiry, malformed code, missing parameters); and
an explicit regression test proving `grant_type=client_credentials`
through the same, now-shared `/oauth/token` endpoint is unaffected.

One **pre-existing** Phase 2D.4 test
(`tests/phase2d4-client-credentials.e2e-spec.ts`, "unsupported grant type
is denied with unsupported_grant_type") asserted that `grant_type=
authorization_code` was rejected outright — an assumption this phase's own
brief requires invalidating (that grant is now supported, just at a
different code path with different required parameters). Updated to use a
grant type that remains genuinely unsupported platform-wide (`'password'`)
so the ORIGINAL intent of the test (an unknown/unsupported grant type is
rejected) is preserved and still verified, without asserting a behavior the
brief explicitly required changing.

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    PASS (new model generated; regenerated client verified against the applied migration)
Migration: PASS — applied to the live dev database (identity_platform_db) as the owner role; verified table/indexes/constraints/RLS policy directly via psql
```

## Database

```text
Tables: 1 new (oauth_authorization_code)   Columns: 14   Indexes: 3 (+1 unique, +1 PK)   Constraints: 1 CHECK + 4 FK   RLS: 1 new tenant_isolation policy   Migrations: 1 (20260914000000_oauth_authorization_code.sql, applied)
```

No existing table's shape changed. New back-relations only (Prisma-level,
no new columns) on `Application`/`SecurityUser`/`Tenant`/`Organization`.

## Regression

Phases 2A / 2B / 2B.1 / 2B.2 / 2C / 2C-stabilization / 2D.1 / 2D.2 / 2D.3 /
2D.4 / 2D.5 / 2D.6 all still green (218/218 pre-existing e2e, 190/190
pre-existing unit — both unedited except the single, documented,
necessary Phase 2D.4 test update above).

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0 (no commit made until the approved final commit, below)
```

## Known Issues

- **Low**: no refresh token is issued by the Authorization Code grant
  (deliberate, documented — §16 of `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`
  — the existing refresh-token system is not safely reusable for this
  token type without building a second, parallel implementation, which the
  brief explicitly forbids).
- **Low**: no rate limiting on `/authorize` or `/token` (pre-existing gap,
  carried from every prior OAuth phase) — documented as an operational
  requirement, never weakened by its absence (every comparison stays
  constant-time/atomic regardless of request volume).
- **Low**: per-request `/authorize`/`/token` denials are audited as
  `SecurityEvent` rows but no metrics backend is wired (structured
  `Logger` lines only) — same precedent as every prior 2D sub-phase.
- **Deferred**: no persistent, per-scope consent subsystem — first-party
  applications skip consent by design (already-approved
  `docs/OAUTH_ARCHITECTURE.md` §7); a genuine third-party consent flow
  remains a future, explicitly out-of-scope capability.

## Deferred Scope (explicitly confirmed NOT implemented)

OIDC (id_token/userinfo/nonce/discovery changes — Phase 2D.8), MFA,
Passkeys, SAML, Dynamic Client Registration, Device Authorization, Token
Exchange, Impersonation, token forwarding (ADR-021 preserved unchanged),
introspection as a normal request path, SDKs, refresh tokens for this
grant, persistent consent, any TravelOS integration, and — unchanged from
every prior 2D sub-phase — any product-specific IAM/permission/resource/
action implementation.

## Git

```text
Previous HEAD: 3254fd4e89e0d7b290eeb9dd90dd1118da18ea95
```

Commit created at the end of this phase containing only Phase 2D.7 files
— see the final report for the exact SHA.

## Final Decision

```text
PHASE 2D.7 — PASS
```
