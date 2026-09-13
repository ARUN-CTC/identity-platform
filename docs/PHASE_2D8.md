# Phase 2D.8 — OIDC Provider

## Objective

Extend Phase 2D.7's OAuth Authorization Code + PKCE flow with OpenID
Connect Provider capabilities — `openid` scope, mandatory nonce, ID Token
issuance, `/userinfo`, and OIDC discovery — without redesigning any
completed architecture (2D.1-2D.7), without introducing a second Client
entity, and without letting an ID Token ever substitute for an Access
Token or vice versa. See `docs/OIDC_PROVIDER.md` for the full design.

## What was implemented

- **`openid` scope trigger** (`AuthorizeService`, extended) — `scope`
  including `openid` is the ONLY signal that turns an ordinary OAuth
  Authorization Code request into an OIDC one; omitting it leaves Phase
  2D.7's flow completely unchanged. Reuses `ApplicationScopePolicy` (Phase
  2D.2) unchanged — no parallel scope registry.
- **Mandatory nonce** — required whenever `openid` is requested, denied
  `invalid_request` before any code is issued if absent; bound to the
  authorization code row (new nullable `nonce` column,
  `oauth_authorization_code`) and carried, unmodified, into the ID Token.
- **`IdTokenService`** (new, issuance-only) — reuses `SigningKeyService`'s
  key material and `kid`/RS256 infrastructure (Phase 2D.1, no duplicated
  key management), with its OWN claim shape (`IdTokenClaims`) — `aud =
  Application.clientId`, never a resource-API audience.
- **`mapOidcUserClaims()`** (new, pure function,
  `src/modules/oauth/utils/oidc-claims.util.ts`) — the one, explicit,
  scope-gated mapping from `SecurityUser` to OIDC claims, shared by ID
  Token issuance and `/userinfo`. `email_verified` derived exclusively from
  `emailVerifiedAt !== null` — never fabricated.
- **`AuthorizationCodeGrantService` extension** — after the existing
  atomic-consume-then-sign-Access-Token flow (Phase 2D.7, unchanged),
  issues an ID Token in the SAME `/token` response, ONLY when the
  authorization code's own stored scopes include `openid` and it carries a
  nonce (both checked — the original `/authorize` request, not the token
  request, is authoritative for whether this is an OIDC transaction).
- **`token_use` claim** — an explicit, optional discriminator
  (`'access_token'` | `'id_token'`) added to `ExternalTokenClaims`.
  `ClientCredentialsService` (Phase 2D.4) remains completely unmodified and
  never sets it — absence still means `'access_token'`.
  `ExternalAccessTokenValidator` (Phase 2D.5, extended) rejects any token
  carrying `token_use: 'id_token'` outright, checked first.
- **`GET /oauth/userinfo`** (new) — authenticates with the completely
  unmodified Phase 2D.5 `ExternalBearerAuthGuard`/`ExternalAccessTokenValidator`
  mechanism; requires a dedicated `identity-platform-userinfo` audience and
  the `openid` scope on the token; subject derived exclusively from the
  validated principal, never a query parameter.
- **`GET /.well-known/openid-configuration`** (new) — public,
  unauthenticated, advertises only implemented capabilities; every URL
  derived from the one canonical `OAUTH_ISSUER`.
- **No OIDC-specific redirect/PKCE/client validation** — every existing
  Phase 2D.2/2D.7 control (exact-match redirect URI, mandatory PKCE
  `S256`, confidential/public client authentication) applies to an OIDC
  request identically, unmodified.

## Security Results

Full representative matrix passes (`docs/OIDC_PROVIDER.md` §16): `openid`
without nonce is denied before any code exists; the ID Token's nonce
exactly equals the client's own, verbatim, and two independent OIDC
transactions never cross-contaminate nonces; `state`/`nonce` are never
conflated; ID Token `aud` is always the OIDC client's own `clientId`, never
a resource audience, and never carries `tenant_id`/`jti`/`scope`/`client_id`;
`profile`/`email` claims are released only per-scope, never merely because
the user exists; `email_verified` reflects `emailVerifiedAt` only; an ID
Token is rejected outright at both `/userinfo` and the existing
resource-server demo route (via the explicit `token_use` claim, verified
even where the ID Token's own transaction ALSO produced an Access Token
carrying the target resource's audience); `/userinfo` rejects a missing
bearer, the wrong audience, a token lacking the `openid` scope, and any
attempt to select another user via a query parameter; discovery advertises
only implemented capabilities (no `implicit`/`plain`/`refresh_token`/
registration/revocation/introspection); 16 concurrent redemptions of one
OIDC code yield exactly 1 success; Client Credentials and OAuth-only
Authorization Code both remain fully unaffected.

## Tests

```text
Unit:  223/223 PASS (210 pre-existing + 13 new: id-token.service.spec.ts (5) + oidc-claims.util.spec.ts (8))
E2E:   288/288 PASS (254 pre-existing + 34 new: tests/phase2d8-oidc-provider.e2e-spec.ts)
```

Two pre-existing Phase 2D.7 tests used `scope=openid` incidentally (as a
convenient, always-registerable standard scope, chosen before nonce
enforcement existed) — updated to either supply the now-mandatory `nonce`
or use a plain product-scoped alternative, preserving each test's own
original intent (resource-server compatibility; product-entitlement
denial) rather than asserting a behavior this phase's own brief requires
changing.

## Build

```text
Typecheck: PASS
Build:     PASS
Prisma:    PASS (nonce column added to the existing model; client regenerated)
Migration: PASS — applied to the live dev database as the owner role; verified column directly via psql
```

## Database

```text
DB changes: 1 nullable column added (oauth_authorization_code.nonce)
Migration: 20260914060000_oidc_nonce.sql (applied)
```

No new table. `oidc_user`/`oidc_client`/`oidc_session`/`oidc_permission`
were explicitly NOT created (brief §50) — `oauth_authorization_code`
(Phase 2D.7) already carries every OIDC-transaction fact this phase needs.

## Regression

Phases 2A / 2B / 2B.1 / 2B.2 / 2C / 2C-stabilization / 2D.1 / 2D.2 / 2D.3 /
2D.4 / 2D.5 / 2D.6 / 2D.7 all still green (254/254 pre-existing e2e,
210/210 pre-existing unit — both unedited except the two documented Phase
2D.7 test updates above).

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0 (no commit made until the approved final commit, below)
```

## Known Issues

- **Low**: no `auth_time` claim — this platform does not currently capture
  the underlying session's own original authentication timestamp on the
  authorization code; deliberately not fabricated (a proxy value would be
  semantically wrong), per the brief's own explicit allowance.
- **Low**: no `acr`/`amr` claims — deferred; only password authentication
  exists today, and the brief explicitly directs against fabricating these.
- **Low**: no rate limiting on `/authorize`/`/token`/`/userinfo` (pre-existing
  gap, carried from every prior OAuth phase).
- **Deferred**: no persistent, per-scope consent subsystem (unchanged from
  Phase 2D.7 — first-party applications skip consent by existing design).
- **Deferred**: no pairwise subject identifiers — a public (non-pairwise)
  `sub` scheme only, matching what the brief allows without inventing new
  complexity.

## Deferred Scope

```text
MFA, Passkeys, SAML: deferred
Dynamic Client Registration: deferred (OIDC clients are existing OAuth Applications)
Device Authorization, Token Exchange, Impersonation: deferred
Normal-path Introspection: deferred
Advanced consent management: deferred
Refresh-token redesign: deferred (unchanged from Phase 2D.7)
SDKs: deferred
TravelOS integration: deferred (0 changes)
Product-specific IAM: deferred (0 product-specific code)
Pairwise subject identifiers: deferred
ACR/AMR/MFA claim framework: deferred
```

## Git

```text
Previous HEAD: 5935e48 (feat(identity): implement OAuth authorization code with PKCE)
```

Commit created at the end of this phase containing only Phase 2D.8 files
— see the final report for the exact SHA.

## Final Decision

```text
PHASE 2D.8 — PASS
```
