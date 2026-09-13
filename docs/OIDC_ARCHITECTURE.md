# OpenID Connect Architecture

Detail document for ADR-014. Builds on `docs/OAUTH_ARCHITECTURE.md`'s authorization_code+PKCE flow — OIDC is additive to it, not a separate flow.

## 1. What OIDC adds

OAuth 2.1 alone proves "this access token was legitimately issued for this client, with these scopes" — it says nothing standardized about *who authenticated* in a form any generic relying-party library understands. OIDC adds exactly that: an **ID Token** (a second, distinct JWT), a `/userinfo` endpoint, and a discovery document, on top of the unchanged OAuth flow.

## 2. ID Token vs. Access Token — never conflated

| | Access Token | ID Token |
|---|---|---|
| Purpose | Present to a resource server, per-request | Consumed once, by the requesting client itself |
| Audience (`aud`) | The resource API's own identifier | The requesting client's own `client_id` |
| Sent to a resource server? | Yes, always | **Never** — a resource server that accepts an ID token as a bearer credential is a known confusion-attack class (`docs/PHASE_2D_THREAT_MODEL.md`) |
| Contains `scope`? | Yes | No |
| Contains tenant/organization context? | Yes (human tokens) | No |
| Contains `nonce`/`auth_time`? | No | Yes |
| Lifetime | Short (same as today's access token TTL) | Short — meant to be consumed immediately after issuance, not stored/reused |

## 3. `openid` scope and standard claims

Requesting the `openid` scope at `/authorize` is what triggers ID Token issuance at all — omitting it means a pure OAuth flow with no ID Token, exactly as it works today. Standard scopes and the claims they unlock in the ID Token / `/userinfo` response:

| Scope | Claims |
|---|---|
| `openid` | `sub`, `iss`, `aud`, `exp`, `iat`, `auth_time`, `nonce` (required for any OIDC request) |
| `profile` | `name`, `given_name`, `family_name`, `preferred_username` (from `security_user.firstName`/`lastName`/`username`) |
| `email` | `email`, `email_verified` (from `security_user.email`/`emailVerifiedAt`) |

No product-specific or IAM-authorization data (roles, permissions, tenant/organization context) is ever placed in the ID Token or `/userinfo` response — those remain the access token's and the resource server's own concern (`docs/TOKEN_AND_SCOPE_ARCHITECTURE.md`).

## 4. `nonce`

The client generates a `nonce` and includes it in the `/authorize` request; the Identity Platform echoes it, unmodified, into the resulting ID Token. The client verifies the ID Token's `nonce` matches what it sent — this is what binds the ID Token to *this specific* authentication attempt and prevents a captured, still-valid ID Token from a different session being replayed into this one.

## 5. `auth_time` and `amr`

`auth_time` records when the user actually authenticated (may predate token issuance, if an existing session was reused via SSO). `amr` (Authentication Methods Reference) would name which methods were used (`pwd` today; `otp`, `webauthn` if/when MFA/Passkeys are ever built — explicitly out of scope for this phase, per the brief). Designed for additively but not populated with anything beyond `["pwd"]` until a real multi-factor mechanism exists.

## 6. `/userinfo`

A bearer-token-protected endpoint (the **access** token, not the ID Token, is presented here — this is the one place an access token issued for the Identity Platform's own `aud` is used against the Identity Platform itself rather than a product resource server) returning the claims corresponding to the granted scopes, always fresh (a live read, never itself cached server-side) — this is the standard OIDC mechanism for a client to re-fetch current profile facts without waiting for the next token refresh.

## 7. Discovery document

`GET /.well-known/openid-configuration` — a static (rarely-changing) JSON document naming every other endpoint (`authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, `issuer`, supported `scopes_supported`/`response_types_supported`/`grant_types_supported`/`code_challenge_methods_supported`), letting any generic OIDC relying-party library configure itself from one URL rather than hardcoding each endpoint. See `docs/EXTERNAL_API_TRUST_BOUNDARY.md` §API Surface for its full security profile (this endpoint itself requires no authentication — it is public configuration, not a secret).

## 8. Relationship to the existing `/v1/auth/me`

`/v1/auth/me` remains the proprietary API's own identity endpoint, unaffected — it is not renamed to `/userinfo` and not replaced by it. A client using the proprietary bearer-token flow keeps using `/auth/me`; an OIDC relying party uses `/userinfo`. Both ultimately read from the same `security_user` row; there is no second identity store to keep in sync.

## 9. What is explicitly NOT built by this document

No ID Token is minted, no `/userinfo`/discovery endpoint exists, no `openid`/`profile`/`email` scope is registered anywhere today. Sequenced at `docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap 2D.6–2D.7, gated on ADR-007's own enterprise-SSO trigger.

## 10. Implementation status (Phase 2D.8, `docs/PHASE_2D8.md`, `docs/OIDC_PROVIDER.md`)

§§1-4, 6-8 are now implemented largely as designed here, with two deliberate, documented departures:

- **§5 (`auth_time`/`amr`) is NOT implemented as this section originally suggested.** This platform does not currently capture the underlying session's own original authentication timestamp on the authorization code; rather than invent a proxy (e.g. the authorization-request moment itself, which is not the same fact as "when did the user last actually authenticate"), the claim is omitted entirely — the later, more specific Phase 2D.8 brief explicitly permits this ("otherwise do not fabricate it") and explicitly directs against fabricating `acr`/`amr` values at all in this phase (they remain deferred, alongside a real MFA mechanism, to a future phase). This supersedes this section's own earlier suggestion of populating `amr: ["pwd"]`.
- **Subject scheme confirmed as designed**: `sub = SecurityUser.id`, public (non-pairwise) — the SAME value the Access Token's own `sub` already carries (Phase 2D.7). No pairwise-per-client subject identifiers.

Everything else — the `openid` scope trigger, `nonce` mechanics, ID Token vs. Access Token separation (`aud` semantics in particular), `/userinfo` using the access token never the ID token, and the discovery document — is implemented exactly as this document describes. See `docs/OIDC_PROVIDER.md` for the full implementation detail.

## 11. Implementation status (Phase 2D.9, `docs/PHASE_2D9.md`, `docs/OAUTH_OPERATIONAL_HARDENING.md`)

`/userinfo` is now rate-limited and, closing a Phase 2D.8 gap, now records a durable audit event on both success (`OIDC_USERINFO_ACCESSED`) and denial (`OIDC_USERINFO_DENIED`) — no change to §6's own authentication/claim-release logic. See `docs/OAUTH_OPERATIONAL_HARDENING.md` for the full detail.

## 12. Implementation status (Phase 2D.10, `docs/PHASE_2D10.md`, `docs/PRODUCT_INTEGRATION_CONTRACT.md`, `docs/IDENTITY_EXTERNAL_API_CONTRACT.md`)

No change to this document's own design. §2 (ID Token vs. Access Token) and §6 (`/userinfo`) are now restated, unchanged, as the product-facing wire contract (`docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §3-4, §7) and the OIDC portion of the human application contract (`docs/PRODUCT_INTEGRATION_CONTRACT.md` §7-§8). §7 (Discovery document) is now also the documented versioning anchor — every advertised endpoint stays at its spec-fixed or `/api/v1`-prefixed path per `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §1/§2.
