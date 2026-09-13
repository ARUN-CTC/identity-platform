# OIDC Provider (Phase 2D.8)

Implementation detail document for the OpenID Connect Provider capability
layered on Phase 2D.7's OAuth Authorization Code + PKCE flow. Builds on,
and does not redesign, `docs/OIDC_ARCHITECTURE.md` (original design),
`docs/OAUTH_AUTHORIZATION_CODE_PKCE.md` (Phase 2D.7),
`docs/RESOURCE_SERVER_ARCHITECTURE.md` (Phase 2D.5/2D.7/2D.8's principal
extension). See `docs/PHASE_2D8.md` for the phase completion report.

## 1. OIDC architecture — additive, not a second flow

```text
User
 │
 ▼
GET /oauth/authorize  (SAME endpoint as OAuth-only, Phase 2D.7)
 │  scope includes "openid"?
 │  ├─ no  → ordinary OAuth Authorization Code (Phase 2D.7, unchanged)
 │  └─ yes → OIDC transaction: nonce mandatory, ID Token issued at /token
 ▼
Authorization Code (oauth_authorization_code — same table, one new
                     nullable `nonce` column, Phase 2D.7's own row shape
                     otherwise unchanged)
 │
 ▼
POST /oauth/token, grant_type=authorization_code  (SAME endpoint/grant)
 │
 ├─ Access Token   (RS256, aud = resource API)         — always
 └─ ID Token       (RS256, aud = OIDC client_id)        — only if openid was requested
```

No second `/authorize`/`/token` endpoint, no second `Client`/`Application`
entity, no second scope registry, no second signing-key system. OIDC is a
mode of the SAME OAuth Authorization Code transaction, entered by
requesting the `openid` scope — exactly `docs/OIDC_ARCHITECTURE.md` §1's
own already-approved framing.

## 2. OAuth vs OIDC — the two artifacts, never conflated

| | Access Token | ID Token |
|---|---|---|
| Purpose | Resource Server authorization | OIDC Client authentication |
| `aud` | The resource API's own identifier | The requesting `Application.clientId` |
| Presented to a resource server? | Yes, always | **Never** |
| Contains `scope`/`tenant_id`/`jti`/`client_id`? | Yes | No |
| Contains `nonce`? | No | Yes, mandatory |
| `token_use` claim | `'access_token'` (Client Credentials: absent) | `'id_token'`, always |
| Issued when? | Every successful `/token` exchange | Only if the original `/authorize` request included `openid` |

`ID Token != Access Token` (Invariant 1) is enforced structurally, not by
convention: `IdTokenService` (issuance) and `ExternalAccessTokenValidator`
(consumption, Phase 2D.5) are separate classes with separate claim
contracts; the explicit `token_use` claim (§15 below) is the
resource-server-checkable discriminator.

## 3. `openid` scope — the trigger, never a permission

Reuses `ApplicationScopePolicy` (Phase 2D.2) completely unchanged — `openid`
is one of the three scopes exempt from the per-product namespace
requirement (already true since Phase 2D.2; not new to this phase). No
parallel scope registry exists. `AuthorizeService` checks
`requestedScopes.includes('openid')` — the ONLY signal that makes a request
an OIDC transaction; `openid` is never treated as an IAM permission or an
API permission anywhere in this codebase.

`profile`/`email` unlock additional ID-Token/UserInfo claims (§9) but never
imply `openid` and are never automatically granted merely because `openid`
was requested, or vice versa — each must be independently present in
`scope` AND in the Application's own `allowedScopes` allow-list.

## 4. Nonce

Mandatory whenever `openid` is requested (`AuthorizeService`, checked
immediately after scope validation) — a request with `scope=openid` and no
`nonce` is denied `invalid_request` before any code is ever issued. The
client's own value is stored verbatim on the authorization code row
(`oauth_authorization_code.nonce`, nullable — populated only for an OIDC
transaction) and copied, unmodified, into the ID Token at `/token` — never
regenerated, never substituted, never derived from `state`/`tenant_id`/
`user_id`/`session_id` (Invariant 6/7). Two independent authorization
transactions never share, or risk cross-contaminating, their nonces — each
is bound to its own row, looked up by its own unique `code_hash`.

## 5. `state` vs `nonce` — never conflated

`state` (Phase 2D.7, unchanged) is CSRF/authorization-request correlation,
opaque to this platform, echoed on both success and (post-redirect_uri
-validation) denial. `nonce` is OIDC authentication-response replay
correlation, echoed only into the ID Token. Neither is ever derived from,
or substituted for, the other (Invariant 8) — they are stored, validated,
and echoed through entirely separate code paths (`request.state` vs
`request.nonce` in `AuthorizeService`; `state` never reaches the
authorization code row at all, `nonce` never reaches the redirect's own
query string).

## 6. ID Token

A distinct token artifact (`IdTokenService`, `src/modules/oauth/services/id-token.service.ts`)
— RS256, signed with the SAME `SigningKeyService` key material and `kid`
as every other external token (Phase 2D.1, no duplicated key management),
but with its OWN claim shape (`IdTokenClaims`, never a copy of
`ExternalTokenClaims`). No `verify()` method exists in this codebase — an
ID Token is consumed by the requesting OIDC Client (external to this
platform, which is the OP, not an RP); verifiability is proven
independently in `tests/phase2d8-oidc-provider.e2e-spec.ts` via a live JWKS
fetch + `jsonwebtoken.verify()`, exactly the same pattern already
established for Access Tokens (Phase 2D.4/2D.7).

Issued only when `oauth_authorization_code.scopes` includes `openid` AND
`.nonce` is non-null (both checked, defense in depth) — `AuthorizationCodeGrantService`
signs it immediately after the Access Token, in the SAME `/token` response,
never via a separate call.

## 7. ID Token claims

```json
{
  "iss": "<OAUTH_ISSUER>",
  "sub": "<SecurityUser.id>",
  "aud": "<Application.clientId>",
  "exp": 0, "iat": 0,
  "nonce": "<the client's own nonce, verbatim>",
  "token_use": "id_token"
}
```

Plus, scope-gated (§9): `name`, `given_name`, `family_name`,
`preferred_username`, `email`, `email_verified`. Never `scope`,
`tenant_id`, `client_id`-as-a-claim, `jti`, `organization_id` — none of
these are Access-Token claims blindly copied over (brief §12/§13's own
explicit prohibition).

## 8. ID Token audience and client binding — the single most critical rule

```text
ID Token.aud     = Application.clientId   (the OIDC Client)
Access Token.aud = the resource API's own audience
```

`AuthorizationCodeGrantService` passes `aud: application.clientId` (the
Application resolved from the SAME atomically-consumed authorization code
— never a caller-suppliable value) to `IdTokenService.sign()`. A code
issued for one client can never produce an ID Token audienced for another —
the client is resolved once, from the code's own `applicationId`, and used
identically for both the Access Token's issuer-side bookkeeping and the ID
Token's `aud`.

## 9. Subject semantics — stable, global, never fabricated

`sub = SecurityUser.id`, the SAME value the Access Token's own `sub`
already carries (Phase 2D.7) — a UUID primary key, never reassigned, never
reused, immutable for the life of the row. Changing email, name,
organization, role, or tenant membership never changes `sub` — none of
those fields participate in its derivation at all. A **public** (not
pairwise) subject scheme: the identical `sub` value is presented to every
OIDC client for the same user, matching `subject_types_supported: ["public"]`
in discovery. Pairwise per-client subject identifiers are NOT implemented
— not decided by any existing architecture document, and the brief
explicitly directs against inventing that complexity in this phase.

## 10. Claims — scope-gated, explicitly mapped, never a raw entity dump

`mapOidcUserClaims()` (`src/modules/oauth/utils/oidc-claims.util.ts`) is
the ONE mapping function shared by ID-Token issuance and `/userinfo` — a
pure function, no database access, no signing, kept deliberately separate
from `IdTokenService` (brief §46). Never returns `SecurityUser` itself or
spreads it — every claim is named explicitly, so a future new
`SecurityUser` column requires a deliberate edit here before it could ever
leak into an OIDC response (brief §47).

Release rules: `openid` → `sub` only. `profile` → `name` (derived from
`firstName`+`lastName` when either is present), `given_name`,
`family_name`, `preferred_username` (from `username`). `email` → `email`,
`email_verified`. `email_verified` is derived EXCLUSIVELY from
`emailVerifiedAt !== null` — never hardcoded `true`, never inferred from
"an email address exists" (Invariant 13). No claim is ever released merely
because the user happens to have the underlying data — each requires its
OWN scope, present on the actual token/authorization transaction.

## 11. UserInfo

`GET /oauth/userinfo` — authenticates with the SAME, completely unmodified
Phase 2D.5 mechanism (`ExternalBearerAuthGuard`/`ExternalAccessTokenValidator`)
every other protected resource-server route uses (Invariant 9) — never an
ID Token (structurally impossible: an ID Token lacks `tenant_id`/`jti`,
which the validator requires, and carries `token_use: 'id_token'`, which
the validator now explicitly rejects, §15). Requires a dedicated resource
audience (`identity-platform-userinfo`, `OIDC_USERINFO_AUDIENCE`) the
client must have requested at `/authorize` — an arbitrary
Identity-Platform-issued access token is never accepted merely because it
is otherwise valid (brief §22) — AND the `openid` scope on the token itself
(`requireScope`, reused unchanged from Phase 2D.5/2D.6).

The subject is derived exclusively from the validated principal
(`principal.userId`) — never from a query parameter, header, or body; a
`?user_id=<someone-else>` query parameter is simply never read by any code
path here (brief §24, Invariant 9 extended). A `SERVICE_ACCOUNT` principal
is rejected outright (`invalid_token`) — it has no human identity to
describe, a type mismatch rather than a mere scope shortfall.

Claims are filtered by the TOKEN's own granted scopes (`principal.scopes`),
using the identical `mapOidcUserClaims()` ID-Token issuance already uses —
requesting `openid` alone at `/authorize` yields `{sub}` only from
`/userinfo` too; `profile`/`email` unlock the same additional claims in
both places, never independently.

## 12. Discovery

`GET /.well-known/openid-configuration` — public, unauthenticated, excluded
from the versioned `/api/v1` prefix (`main.ts`), same posture as
`.well-known/jwks.json`. Every URL is derived from the ONE canonical
`OAUTH_ISSUER` value — the same one `ExternalTokenService`/`IdTokenService`/
`ExternalAccessTokenValidator` already use as `iss` (brief §38/§39, never
independently re-derived, never hardcoding `localhost`/a production
hostname). Advertises ONLY implemented capabilities: `response_types_supported:
["code"]` (no `token`/`id_token`/hybrid), `code_challenge_methods_supported:
["S256"]` (no `plain`), `grant_types_supported: ["authorization_code",
"client_credentials"]` (no `implicit`/`refresh_token`), `token_endpoint_auth_methods_supported:
["client_secret_basic", "none"]` — no `registration_endpoint` (no Dynamic
Client Registration), no `revocation_endpoint`/`introspection_endpoint`
(neither built).

## 13. JWKS

Unchanged — `jwks_uri` in discovery points at the SAME, already-existing
`/.well-known/jwks.json` (Phase 2D.1). No second key-discovery mechanism.
Public-key-only by construction (Invariant 15) — unchanged from Phase 2D.1's
own structural guarantee (a JWKS entry is built from a `KeyObject`
constructed from the public key PEM alone, which cannot carry private
fields).

## 14. Token purpose (`token_use`)

An explicit, optional claim (`ExternalTokenClaims.token_use?: 'access_token'
| 'id_token'`) — the resource-server-checkable discriminator brief §28
calls for, never inferred from `sub`/`aud`/scope-presence alone.
`ClientCredentialsService` (Phase 2D.4) remains completely unmodified and
never sets it — absence means `'access_token'`, preserving 100% backward
compatibility with every machine token issued before this claim existed.
`AuthorizationCodeGrantService`'s own Access Token now explicitly sets
`token_use: 'access_token'`; `IdTokenService` always sets
`token_use: 'id_token'`. `ExternalAccessTokenValidator` (Phase 2D.5,
extended) rejects any token carrying `token_use: 'id_token'` outright,
checked FIRST, before any other claim is even read — this is on top of,
not instead of, the structural rejection an ID Token already suffers from
lacking `tenant_id`/`jti` (defense in depth, never relying on claim shape
alone per brief §27).

## 15. Client binding

The ID Token's `aud` is set from the SAME `Application` the authorization
code itself resolved to at issuance and re-verified at exchange (Phase
2D.7's own `code_client_mismatch` check, unchanged) — there is no
independent "which client is this ID Token for" decision that could drift
from "which client redeemed this code."

## 16. Security threats — representative matrix (full list in the brief; `tests/phase2d8-oidc-provider.e2e-spec.ts` covers each reachable one directly)

| # | Threat | Outcome |
|---|---|---|
| 1-2 | Missing `openid` / OIDC request without nonce | `invalid_request`, before any code is issued |
| 3-5 | Nonce modification/substitution/replay | Structurally bound to one authorization-code row; two transactions' nonces never cross-contaminate |
| 6 | State/nonce confusion | Distinct fields throughout; neither ever echoed as the other |
| 7-14 | ID Token wrong issuer/audience/nonce/expired/invalid signature/unknown kid/`alg=none`/HS256 | Rejected by the SAME `jwt.verify()` discipline (Phase 2D.1/2D.5) an independent verifier would apply |
| 15-16 | Access Token accepted as ID Token / ID Token accepted as Access Token | Both structurally rejected — `token_use` mismatch, plus (for #16) missing `tenant_id`/`jti` |
| 17-18 | ID Token issued to/accepted for the wrong client/user | `aud` bound to the code's own resolved Application; `sub` bound to the code's own resolved user |
| 19-24 | UserInfo without bearer / with an ID Token / wrong audience / user override / tenant override / cross-user access | All rejected — no code path reads an identity-bearing query parameter; subject comes only from the validated principal |
| 28-29 | `email_verified`/subject instability fabrication | `email_verified` derived from `emailVerifiedAt` only; `sub` is a UUID primary key, immutable |
| 30-31 | Authorization-code replay / concurrent redemption | Unchanged Phase 2D.7 atomic `tryConsume` mechanism, re-verified for an OIDC code specifically |
| 37-38 | Tenant/organization override / cross-resource-audience misuse | Server-derived tenant, independently-revalidated organization (Phase 2D.7, unchanged); ID Token's own `aud` is never a resource audience at all |
| 39-40 | Forged ID/Access Token | Rejected by signature verification against the real JWKS public key |
| 41-43 | Discovery/JWKS issuer mismatch, private-key leakage | One canonical `OAUTH_ISSUER`; JWKS structurally public-key-only |

## 17. Known limitations (deliberate, documented)

- **No refresh token** for the OIDC/Authorization-Code flow — unchanged
  from Phase 2D.7's own decision (§16 there); OIDC does not alter that.
- **No persistent consent** — first-party applications skip an explicit
  consent screen (`docs/OAUTH_ARCHITECTURE.md` §7, unchanged); a genuine
  third-party consent flow remains out of scope.
- **No `auth_time`** — this platform does not currently capture the
  underlying session's own original authentication timestamp on the
  authorization code; rather than fabricate a proxy value (e.g. the
  authorization moment itself, which is NOT the same thing as "when did
  the user last actually authenticate"), the claim is simply omitted, per
  the brief's own explicit allowance ("otherwise do not fabricate it").
- **No `acr`/`amr`** — deferred; no reliable authentication-method-reference
  data exists yet (only password login is implemented), and the brief
  explicitly directs against fabricating these.
- **No pairwise subject identifiers** — a public (non-pairwise) `sub`
  scheme only; not decided by any existing architecture document, and the
  brief explicitly directs against inventing it in this phase.

## 18. TravelOS

Zero TravelOS files, dependencies, configuration, database, or Git history
were touched by this phase.
