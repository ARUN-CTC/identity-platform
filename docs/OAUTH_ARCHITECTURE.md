# OAuth 2.1 Architecture

Detail document for ADR-013. See `docs/EXTERNAL_AUTH_ARCHITECTURE.md` for the principal/trust model this builds on.

## 1. Why OAuth 2.1, not bare OAuth 2.0

OAuth 2.1 is the consolidated, security-hardened profile of OAuth 2.0's accumulated best practice: PKCE is mandatory for every `authorization_code` exchange (not just public clients), the implicit grant is removed entirely (tokens are never returned in a URL fragment), the resource-owner-password-credentials grant is removed (a client never collects a user's password directly), and redirect URIs require exact string matching. Adopting 2.1 as the baseline means every future client this platform ever registers is safe by construction, rather than safe only if it happens to follow the optional hardening OAuth 2.0 merely permitted.

## 2. Human authentication — Authorization Code + PKCE

```text
User                Product App           Identity Platform
 │                       │                        │
 │  wants to sign in     │                        │
 ├──────────────────────>│                        │
 │                       │  generate code_verifier,│
 │                       │  code_challenge = S256  │
 │                       │  (code_verifier),       │
 │                       │  state, redirect        │
 │                       │  to /authorize          │
 │                       ├───────────────────────>│
 │                       │                         │  Authenticate (existing
 │                       │                         │  login mechanism, or an
 │                       │                         │  existing session cookie)
 │                       │                         │  → Organization Context hint
 │                       │                         │    validated (ADR-019)
 │                       │                         │  → Authorization (is this
 │                       │                         │    client allowed to request
 │                       │                         │    these scopes at all)
 │                       │                         │  → issue single-use
 │                       │                         │    Authorization Code
 │                       │  <redirect with code,   │
 │                       │   state>                │
 │                       │<───────────────────────┤
 │                       │  verify state matches    │
 │                       │  POST /token             │
 │                       │  {code, code_verifier,   │
 │                       │   client_id, redirect_uri}│
 │                       ├───────────────────────>│
 │                       │                         │  verify code (single-use,
 │                       │                         │  unexpired, matching
 │                       │                         │  redirect_uri) + verify
 │                       │                         │  SHA256(code_verifier) ==
 │                       │                         │  stored code_challenge
 │                       │  ID Token (if `openid`   │
 │                       │  requested) + Access     │
 │                       │  Token + Refresh Token   │
 │                       │<───────────────────────┤
```

## 3. PKCE — mandatory, always

Every client, public or confidential, generates a `code_verifier` (a high-entropy random string) and sends `code_challenge = BASE64URL(SHA256(code_verifier))` with `code_challenge_method=S256` at `/authorize`; the raw `code_verifier` is presented at `/token` and checked against the stored challenge. `plain` challenge method is not supported — only `S256`. This closes authorization-code-interception attacks even for a confidential client whose `client_secret` might also leak, and removes any need to special-case public vs. confidential clients in this one respect (OAuth 2.1's own simplification).

## 4. Redirect URI security

- **Exact string matching only** — no wildcard, no prefix, no partial-path matching. A registered `https://app.travelos.com/callback` never matches `https://app.travelos.com/callback/evil` or `https://evil.com?redirect=https://app.travelos.com/callback`.
- **HTTPS required** for every registered redirect URI, with one controlled exception: `http://localhost:<port>/...` (or `http://127.0.0.1:<port>/...`) for local development only — never a non-localhost `http://` origin, ever.
- **Mobile custom schemes** (`com.travelos.app://callback`) and **app/universal links** (`https://app.travelos.com/.well-known/apple-app-site-association`-verified links) are both supported as registered redirect URIs, subject to the same exact-match rule — a custom scheme is registered per-Application, not shared across Applications, precisely because custom URI schemes are not exclusively claimable on every OS (another app could attempt to register the same scheme) — PKCE is what actually protects against that risk, not the scheme's obscurity.
- **SPA redirect URIs** are always treated as public-client redirects (no secret ever accompanies the code exchange) regardless of what origin they're served from.
- **Multiple environments** (dev/staging/prod) register **distinct** `Application` rows (distinct `client_id`s) with their own redirect URI sets — never one Application with redirect URIs spanning environments, which would let a compromised staging redirect target production's token issuance.

## 5. Authorization code properties

- **Lifetime**: short (target: ≤60 seconds) — long enough for the redirect+POST round-trip, short enough to bound replay-attempt windows.
- **Single-use**: enforced at the database level (a code row is marked consumed atomically with its first successful exchange — the same state-machine-guarded-UPDATE pattern already used elsewhere in this platform, e.g. `docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md`'s conditional transitions) — a second exchange attempt of an already-consumed code is treated as theft evidence, not a benign retry, and revokes any token already issued from it (mirroring the existing refresh-token reuse-detection philosophy, `docs/AUTHENTICATION_ARCHITECTURE.md`).
- **Bound to**: the exact `client_id`, `redirect_uri`, and PKCE `code_challenge` presented when it was issued — a `/token` exchange presenting a different value for any of these is rejected.

## 6. Client authentication at `/token`

- **Confidential client**: `client_secret_basic` (HTTP Basic) or `client_secret_post` (in the request body) — either accepted, `client_secret_basic` preferred (avoids the secret appearing in a form body that some logging middleware might capture).
- **Public client**: no client authentication — PKCE is the only proof required, by design (a public client has no secret to present).

## 7. Consent

- **First-party trusted applications** (every Application this platform's own operators register for TravelOS/Healthcare/Gym today — same-organization products) **skip an explicit consent screen** — the organization operating the Identity Platform and the organization operating the product are the same, so a consent prompt would ask a user to "consent" to their own employer's product using their own employer's identity system, which is not a meaningful security boundary. This mirrors how Phase 1–2C's own login flow never asked for consent.
- **Third-party applications** (none registered as of Phase 2D; a future, deferred capability) require an explicit, scope-specific consent screen naming exactly what is being requested, and consent must be revocable by the user independently of revoking the application's own credentials.
- **Consent is scope-specific**: granting `travelos.read` consent does not imply `travelos.write` consent — each requested scope is individually listed.
- **Consent is organization-aware**: a third-party application's consent is scoped to the organization context active when consent was granted (ADR-019) — switching organizations later does not silently extend a prior consent's scope to the new organization; a genuine per-organization re-consent model is deferred until third-party applications are a real, named requirement (out of scope, `docs/PHASE_2D_ARCHITECTURE.md` §7).

## 8. Implementation status

**§4 (Redirect URI security) is now implemented** (Phase 2D.2, `docs/PHASE_2D2.md`) — `RedirectUriPolicy`/`OriginPolicy` (`src/modules/applications/policies/`) enforce exact-match-only redirect URIs and origins, HTTPS-required-except-loopback, no wildcards, no fragments, custom mobile schemes permitted — verified directly against the full attack matrix (`tests/phase2d2-application-oauth-client.e2e-spec.ts`: prefix/suffix/subdomain/fragment/wildcard attacks all denied). §6 (client authentication method) is likewise implemented — `TokenEndpointAuthMethodPolicy` derives `client_secret_basic`/`none` strictly from `clientType`.

No `/authorize`, `/token`, consent-UI, or authorization-code storage exists yet — this document remains the design those future endpoints must conform to, per `docs/PHASE_2D_ARCHITECTURE.md` §Implementation Roadmap (2D.3–2D.5), gated on ADR-007's own trigger. §5 (authorization code properties) and §7 (consent) remain entirely unimplemented.

## 9. Implementation status (Phase 2D.4, `docs/PHASE_2D4.md`)

**§6 (Client authentication at `/token`) is now implemented for the `client_credentials` grant**: `POST /oauth/token` requires `client_secret_basic` (HTTP Basic) exactly as this section specifies — `client_secret_post` and public-client PKCE-substitution remain unbuilt (there is no `/authorize`/authorization_code exchange yet for either to apply to). Client secret verification (`verifyClientSecret`, `src/common/utils/client-credential.util.ts`) is a new, timing-safe comparison — the first call site in this codebase that actually verifies a secret rather than only generating/hashing one. `/authorize`, PKCE, authorization-code storage, and consent (§2–§5, §7) remain entirely unbuilt.

## 10. Implementation status (Phase 2D.7, `docs/PHASE_2D7.md`, `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`)

**§2/§3/§4/§5/§6 are now fully implemented** exactly as designed here: `GET /oauth/authorize` + `POST /oauth/token` (`grant_type=authorization_code`), PKCE mandatory for every client (`S256` only, `plain` rejected outright), the exact-match `RedirectUriPolicy` (unchanged since Phase 2D.2) exercised by a real endpoint for the first time, single-use/short-lived (`≤60s` default) authorization codes bound to client/redirect_uri/PKCE/user/tenant/organization/audience, and `client_secret_basic` (confidential) / no-auth-plus-PKCE (public) client authentication at `/token`, exactly per this document's own §6. **§7 (Consent) remains implemented exactly as designed**: no explicit consent screen for first-party applications (every Application registered on this platform today) — requested scopes are approved implicitly, subject to the Application's own `allowedScopes` allow-list; a genuine third-party consent flow remains deferred, unbuilt, as this section always anticipated. `client_secret_post` (an alternative to `client_secret_basic`) remains unbuilt — only `client_secret_basic` is implemented, matching `TokenEndpointAuthMethodPolicy`'s existing, unchanged derivation. See `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md` for the full implementation detail.

## 11. Implementation status (Phase 2D.8, `docs/PHASE_2D8.md`, `docs/OIDC_PROVIDER.md`, `docs/OIDC_ARCHITECTURE.md`)

OIDC is now layered additively on this document's own §2 flow, exactly as anticipated: `openid` in the requested `scope` (still validated by the SAME `ApplicationScopePolicy` this document's §6/§7 already describe) is the sole trigger; nonce, ID Token issuance, `/userinfo`, and discovery are all new, but the Authorization Code + PKCE mechanics themselves — redirect URI exact-match, mandatory `S256` PKCE, single-use atomic code consumption, client authentication — are entirely unmodified. See `docs/OIDC_ARCHITECTURE.md` for the OIDC-specific design and `docs/OIDC_PROVIDER.md` for the full implementation detail.

## 12. Implementation status (Phase 2D.9, `docs/PHASE_2D9.md`, `docs/OAUTH_OPERATIONAL_HARDENING.md`)

Purely operational hardening — no change to this document's own flow, redirect-URI policy, PKCE requirement, or client authentication. `/authorize` and `/token` are now rate-limited (`RateLimitGuard`, provider-neutral, in-process by default) and every field bounded (`@MaxLength`), both enforced BEFORE this document's own validation logic ever runs. See `docs/OAUTH_OPERATIONAL_HARDENING.md` for the full detail.

## 13. Implementation status (Phase 2D.10, `docs/PHASE_2D10.md`, `docs/PRODUCT_INTEGRATION_CONTRACT.md`)

No change to this document's own flow. §6 (client authentication)/§7 (consent) are now additionally named, unchanged, as part of the product-facing service-to-service and human-application contracts (`docs/PRODUCT_INTEGRATION_CONTRACT.md` §6-§7). `IdentityTokenEndpointErrorCode` (`src/contracts/identity-error.contract.ts`) re-exports this platform's existing `OAuthTokenErrorCode` union as the stable, product-facing name for this endpoint's own error vocabulary — no new code, no rename.
