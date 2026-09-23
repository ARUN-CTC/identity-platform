# OAuth Browser Session & Authorization Completion Architecture

Phase 2UI.5A. Closes the gap identified and documented in `docs/IDENTITY_AUTHENTICATION_UX.md` §5/§7 and `docs/PHASE_2UI5.md` §16/§24: `GET /oauth/authorize` requires `Authorization: Bearer <token>` (`JwtAuthGuard`), which a genuine top-level browser navigation — the only mechanism that can land the user's visible tab on a product's own callback page — structurally cannot carry. Builds on, and does not redesign, `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`, `docs/OIDC_PROVIDER.md`, `docs/AUTHENTICATION_ARCHITECTURE.md`, `docs/PHASE_2D_THREAT_MODEL.md`.

## 1. The problem, precisely

Confirmed by direct code read, not assumed:

- `JwtAuthGuard.readBearerToken()` (`src/modules/authentication/guards/jwt-auth.guard.ts`) reads `Authorization: Bearer <jwt>` **only** — no cookie fallback exists anywhere in this codebase today.
- `AuthorizeController`'s `GET /oauth/authorize` is deliberately **not** `@Public()` — it runs behind this same guard, by original design (its own doc comment: *"No new login mechanism is built here... an unauthenticated request never reaches this class at all"*).
- A top-level browser navigation (the only way an OAuth redirect can visibly land the user on the product's callback) cannot attach a custom header. A raw navigation to `/oauth/authorize` therefore **always** 401s today, regardless of whether the user is "logged in" in some other tab.
- No CSRF protection, no cookie-parsing middleware, and no `credentials: true` CORS configuration exist anywhere in this codebase — confirmed by exhaustive search. `main.ts` carries an explicit comment justifying this absence *because* no cookie is ever used for authentication. That invariant is what this phase deliberately, narrowly breaks — and re-justifies below.

## 2. Options evaluated

**Option D (Bearer-header navigation)** — rejected outright, per the brief's own instruction and the finding above: no browser mechanism exists (or could exist without inventing new browser behavior) to attach a custom header to a top-level navigation.

**Option A (a general Identity browser session cookie)** — rejected. This would mean the SAME cookie authenticating (potentially) every endpoint, exactly the "second independent authentication authority" the brief prohibits, and would require a full CSRF-token program (double-submit cookie or equivalent) for every state-changing endpoint the cookie could now reach. Unjustifiably broad for the one narrow gap being closed.

**Option B (a dedicated short-lived OAuth authorization session)** — the closest fit, refined below (§3) into the actual selected design: a purpose-built credential whose *only* job is identifying the already-existing `SecuritySession` to the one route that needs it, never a replacement for the access token.

**Option C (reuse the existing session mechanism)** — partially adopted: the cookie is not a new session concept (§6) — it is a new, narrowly-scoped *credential* that resolves to the exact same `SecuritySession` row login already creates. This is the "reuse where possible" half of the decision; §3 covers why a genuinely new artifact (not the existing access or refresh token) is still required.

## 3. Selected design

**A new, opaque, single-purpose "browser session secret," stored hash-only on the existing `SecuritySession` row, delivered as an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, read by exactly one new guard, used on exactly one route (`GET /oauth/authorize` and its new sibling `GET /oauth/authorize/resume`).**

Why not put the existing access token in the cookie (the simplest possible option): brief §5 explicitly prohibits it (*"Do not place access tokens or ID tokens into the browser authentication cookie"*), and it's the right call independently — an access token is usable against the entire authenticated API surface; putting it in a browser-navigable cookie multiplies its exposure surface (Referer leakage, browser history, any future misconfigured logging) for a benefit (identifying the browser to one route) that doesn't need that much power. Why not the existing refresh token: it can mint arbitrary new access tokens — strictly more powerful than what this problem needs, and already has its own tightly-scoped rotation/reuse-detection contract this phase must not touch. The new secret is deliberately **weaker** than both: it identifies a session for exactly one purpose (resolving who's asking at `/oauth/authorize`) and is checked only by the guard this phase adds.

**Self-identifying shape, reusing an established pattern verbatim**: `TokenService` already generates every other bearer-ish secret (refresh tokens, password-reset tokens, invitation tokens, authorization codes) as `base64url(tenantId).secret`, hash-only stored, parsed by splitting on `.` before any database lookup. The new browser-session secret uses the **exact same shape** (`generateBrowserSessionSecret(tenantId)` / `parseBrowserSessionSecret(plain)`), which means the lookup is a normal, tenant-scoped, RLS-respecting query (`findById`-style) — **no RLS policy needs to change**, because the tenant is parsed out of the cookie value itself before the database is ever touched, exactly like every other pre-authentication token this platform already issues.

## 4. Cookie properties

```text
Name:      identity_browser_session
Value:     base64url(tenantId).<32-byte random secret, base64url>
HttpOnly:  true   — never exposed to JavaScript; XSS cannot read it
Secure:    true in every non-local environment (see §14 for the documented,
           narrow local-dev exception)
SameSite:  Lax    — NOT None. The only use of this cookie is a top-level GET
           navigation (a real browser redirect), which SameSite=Lax already
           permits cross-site by design (this is precisely the carve-out
           SameSite=Lax exists for). SameSite=None would additionally allow
           the cookie on cross-site subresource/fetch/XHR requests — a
           strictly larger, unnecessary attack surface this design does not
           need and deliberately does not take.
Path:      /api/v1/oauth   — host-scoped (no Domain attribute at all, so it
           is never sent to any other host, subdomain, or product), and
           path-scoped so it is never attached to any other route on this
           same API — not /api/v1/auth, not /api/v1/users, nothing else.
Max-Age:   Mirrors the underlying SecuritySession's own refresh-token TTL
           (rememberMe-dependent, same values AuthenticationService already
           uses) — the cookie's usefulness cannot outlive the session it
           identifies, and re-authenticating naturally re-issues it.
```

`Path` scoping is the second half (alongside the dedicated guard) of "narrowest valid scope" (brief §5): even if some future route were accidentally wired to read cookies, this one is structurally invisible outside `/api/v1/oauth/*`.

## 5. Session binding (brief §6)

```text
Browser cookie (identity_browser_session)
      ↓ parse tenantId, hash secret
SecuritySession (existing row — 2 new nullable columns:
                 browserSessionSecretHash, browserSessionSecretExpiresAt)
      ↓ FK (existing)
SecurityUser
      ↓ existing Membership resolution
Tenant / Organization Context
```

No new session table, no duplicate identity model. The two new columns are set alongside the *existing* token-issuing paths (`login()`, `refresh()`, both branches of `switchOrganizationContext()`) — every place that already creates or touches a `SecuritySession` row also (re)issues the cookie secret for it, keeping the two artifacts' lifecycles identical by construction rather than by a separate reconciliation job.

## 6. The new guard

`OAuthBrowserSessionGuard` (new, `src/modules/oauth/guards/`) — used **only** on `GET /oauth/authorize` and `GET /oauth/authorize/resume`, replacing the plain `JwtAuthGuard` those routes used before. `JwtAuthGuard` itself is **not modified** — zero risk to every other route in the API.

```text
Request arrives
  ├── Authorization: Bearer present?
  │     └── Verify exactly as JwtAuthGuard already does (same TokenService
  │         call, same live SecuritySession.revokedAt check) — preserves
  │         the one existing caller shape (an already-authenticated SPA
  │         calling this endpoint via fetch, as Phase 2UI.5 did) unchanged.
  ├── else, identity_browser_session cookie present?
  │     └── Parse tenantId, hash secret, look up SecuritySession by
  │         (tenantId, browserSessionSecretHash) — reject if not found,
  │         expired, or revokedAt is set (the SAME live revocation check
  │         JwtAuthGuard already performs, applied to the same table).
  └── Neither present/valid → context stays unauthenticated; the
      CONTROLLER (not the guard) decides what happens next (§8) — a guard
      returning false would only ever produce a flat 401, exactly the
      status quo this phase exists to fix.
```

On a successful resolution via either path, the guard calls the exact same `RequestContextService` setters (`setTenantId`, `setUserId`, `setSessionId`, `setOrganizationId`) `JwtAuthGuard` already calls — confirmed directly in code that `RequestContextService` has zero dependency on which guard populated it, and that a second guard populating the same four fields for a different route is already an established pattern (`PlatformJwtAuthGuard` populating `operatorId`/`isPlatformOperator` instead, never co-populated with tenant fields on the same request). Everything downstream of authentication — `AuthorizeService.handle()`, entirely unchanged — cannot tell which guard authenticated the request.

**Verified interaction with the global `TenantStatusGuard`**: `OAuthBrowserSessionGuard` is a route-scoped guard (`@UseGuards` on the controller), which NestJS always runs *after* every global guard (`JwtAuthGuard`, `TenantStatusGuard` — both `APP_GUARD`s, see `app.module.ts`'s own comment on why `AuthenticationModule` is imported before `RequestContextModule`). Because `/oauth/authorize` is now `@Public()`, the global `JwtAuthGuard` no longer sets `tenantId` for this route, so the global `TenantStatusGuard` sees no `tenantId` yet and takes its existing early-return path (`if (!tenantId) return true`) — it no longer catches a suspended/cancelled tenant on this route the way it does on every other authenticated route. This does **not** reopen the tenant-status check: `AuthorizeService.handle()` already independently re-validates `tenant.status === 'ACTIVE'` at its own step 9, explicitly documented in that file as "defense in depth — tenantId itself is already server-derived/trusted" — written in Phase 2D.7, before this phase existed, precisely as a second, self-sufficient layer. A suspended tenant's user is still denied (`access_denied` / `tenant_inactive`), just by the service layer instead of the global guard layer; covered by an explicit regression test (§Test matrix).

## 7. Pending authorization transaction

New table, `oauth_pending_authorization` (new repository, `src/modules/oauth/repositories/pending-authorizations.repository.ts`):

```text
id             uuid, pk
referenceHash  text, unique     — SHA-256 hash of the opaque reference value
                                  handed to the browser; plain value never stored
responseType   text
clientId       text
redirectUri    text
scope          text, nullable
state          text, nullable
codeChallenge  text, nullable
codeChallengeMethod text, nullable
audience       text, nullable
organizationId uuid, nullable   — the ORIGINAL request's own organization
                                  hint, if any; still independently
                                  revalidated live by the unchanged
                                  AuthorizeService once resumed — never
                                  trusted merely for having been stored
nonce          text, nullable
createdAt      timestamptz
expiresAt      timestamptz      — short TTL, OAUTH_PENDING_AUTHORIZATION_TTL_SECONDS,
                                  default 600 (10 minutes — long enough for a
                                  real human to type credentials, unlike the
                                  60-second authorization-code TTL)
consumedAt     timestamptz, nullable
```

**No tenant column, no RLS.** This row is created from a request with no tenant context whatsoever (an unauthenticated hit — the whole reason it exists) and is never itself a credential for anything beyond "resume this one specific, already-validated OAuth request" — it stores no identity, no session, no user. This mirrors the platform's own existing treatment of genuinely tenant-less pre-authentication state (matching how `Tenant` itself and other global reference tables are already documented as intentionally RLS-free).

**Single-use, atomic, replay-protected**: consumed via the identical `tryConsume`-style conditional `UPDATE ... WHERE reference_hash = ? AND consumed_at IS NULL AND expires_at > now()` pattern `AuthorizationCodesRepository` already uses — `count() === 1` is the only proof of a win, closing the same TOCTOU window the existing authorization-code table already closes.

**What it deliberately does NOT store**: no user identity (none exists yet), no `organizationId` trusted as authoritative (re-validated on resume, §13), nothing from `localStorage`/`sessionStorage`/an unvalidated `returnUrl` (brief §9's explicit prohibition) — every field is either a raw OAuth request parameter or server-generated lifecycle metadata.

## 8. Full flow

```text
Product's browser navigation
        ↓
GET /oauth/authorize?client_id=...&redirect_uri=...&...
        ↓
[NEW] Validate client_id + redirect_uri FIRST, unauthenticated-safe —
      reuses OAuthApplicationPolicyService.checkEligibility() unchanged,
      the SAME call AuthorizeService.handle() already makes as its own
      first real step. Invalid → the SAME direct-JSON error response as
      today (never a redirect) — this phase does not change that behavior
      at all, only WHEN it's checked relative to authentication.
        ↓ (valid)
[NEW] OAuthBrowserSessionGuard resolves Bearer-or-cookie
        │
        ├── Authenticated → AuthorizeService.handle() — completely
        │   unchanged code, unchanged validation order (§10), unchanged
        │   success/denial redirect logic. This is the exact path Phase
        │   2UI.5's fetch-based caller already exercised; still works
        │   identically for that caller shape.
        │
        └── Not authenticated →
              [NEW] create oauth_pending_authorization row
              [NEW] 302 to <frontend origin>/login?authorize_request=<ref>
                      ↓
              Existing LoginPage/LoginForm, UNCHANGED sign-in UI —
              only the POST-success routing gains one new branch (§9)
                      ↓ (login succeeds — cookie now set on this response)
              One or more organizations ambiguous?
                ├── No → real top-level navigation to
                │        GET /oauth/authorize/resume?ref=<ref>
                └── Yes → existing ChooseOrganizationPage, UNCHANGED UI,
                          same branch added → real top-level navigation to
                          GET /oauth/authorize/resume?ref=<ref>
                      ↓
              [NEW] GET /oauth/authorize/resume — OAuthBrowserSessionGuard
                    resolves the NOW-set cookie → authenticated. Looks up
                    the pending row by hashed ref, atomically consumes it,
                    reconstructs the original AuthorizeRequest, calls
                    AuthorizeService.handle() — unchanged code, unchanged
                    validation order, unchanged redirect logic.
                      ↓
              302 to the product's own validated redirect_uri, ?code=&state=
                      ↓
              Product callback → POST /oauth/token — completely unchanged
              (AuthorizationCodeGrantService, PKCE verification, client
              authentication: none of this phase touches any of it)
```

## 9. Frontend changes (minimal, additive only)

`LoginPage.tsx`/`ChooseOrganizationPage.tsx` (both from Phase 2UI.5, otherwise unchanged): read an optional `authorize_request` value (query param on `/login`, carried through router `state` to `/choose-organization` exactly like the existing `from` value already is). When present, the post-success action is a **real** `window.location.href` navigation to the backend's `/oauth/authorize/resume?ref=...` instead of the existing in-app `navigate()` call — everything else (the login form itself, the organization picker itself, error handling) is unchanged.

**`app/pages/oauth/OAuthAuthorizePage.tsx` (Phase 2UI.5) is retired** (deleted, along with its test and the now-dead `getOAuthErrorMessage` helper) — it existed specifically to work around the gap this phase closes properly; the backend now owns the entire redirect chain via real navigations, and no frontend shell page is needed for the primary flow at all. Its one remaining useful idea — safe copy for an unrecoverable OAuth request — becomes a small, focused `OAuthAuthorizeExpiredPage` (new, `/oauth/authorize/expired`) for the one case the backend can redirect the frontend to on its own: a missing/expired/consumed/invalid pending-authorization reference at resume time (§7), where no trusted `redirect_uri` remains to redirect an error to.

## 10-11. Validation order and PKCE

Unchanged. `AuthorizeService.handle()`'s own thirteen-step order (client_id → client+redirect_uri together → response_type → PKCE presence/method/format → scope → OIDC nonce → audience → organization context → tenant status → product entitlement → code issuance) is not touched by this phase in any way — the only change is *what populates `RequestContextService` before this method runs*, never the method's own logic. PKCE remains `S256`-only, mandatory for every client, verified with the same `crypto.timingSafeEqual` comparison at `/token`, completely untouched.

## 12. OIDC nonce

Unchanged — still mandatory whenever `openid` is requested, still stored on (now: either the authorization-code row directly, for the already-authenticated path, or) the pending-authorization row's own `nonce` column when a login round-trip is needed, then carried unchanged into the authorization code exactly as today. Never touches browser storage at any point in either path.

## 13. Organization context

Unchanged authority model: `AuthorizeService.handle()` still independently revalidates any `organizationId` — whether it arrived as a live request parameter (already-authenticated path) or was stored on a resumed pending-authorization row — against the caller's own **live** Membership, never trusting a stored value merely for having been persisted. A stale/foreign hint from before the login round-trip is denied exactly as a stale live parameter already is today (`access_denied`) — resuming a pending transaction never grants a wider organization context than a fresh, already-authenticated request would.

## 14. Local development

`Secure` cookies require HTTPS. Local development in this repo runs plain HTTP (confirmed — no TLS termination code anywhere in `main.ts`). A documented, explicit, environment-gated exception: `Secure` is omitted **only** when `NODE_ENV !== 'production'` **and** the request originated from a loopback host (`localhost`/`127.0.0.1`), mirroring the exact narrow carve-out `docs/OAUTH_ARCHITECTURE.md` §4 already establishes for redirect-URI HTTPS enforcement. `validateProductionConfig` (already refuses to boot in production without an explicit CORS allowlist) is extended to also refuse to boot in production with this relaxation still possible — the same fail-closed discipline this platform already applies to its other environment-gated behaviors.

## 15. Threat model additions

See `docs/PHASE_2UI5A.md` §Security for the full, explicit mitigated/accepted/deferred table covering every threat brief §25 lists. Summary of the two most important new judgment calls, decided and justified here:

- **"User A's pending transaction consumed by User B"** (brief §23): by design, the pending-authorization row never stores a user identity — it stores only OAuth request parameters. Resuming it always issues a code for **whoever is currently authenticated at resume time**, never for some earlier, different identity. This is not a vulnerability to close; it is the same behavior every standards-conformant browser-based OAuth IdP already exhibits (authorization always reflects the current session, by definition) — verified directly by a test asserting the resumed code's `sub` matches the resuming user, never an earlier one.
- **CSRF surface introduced by the new cookie**: scoped to exactly zero state-changing endpoints. The cookie is read by exactly one guard, used on exactly two GET routes, both of which are pure "authenticate-then-redirect" operations with no side effect an attacker could trigger beyond what the unchanged, already-hardened `AuthorizeService` itself already permits (bounded by exact-match `redirect_uri`, PKCE, and live entitlement checks). Every state-changing endpoint (login, logout, refresh, organization switch) remains Bearer-header-only, unchanged, and therefore remains structurally CSRF-immune (a cross-site attacker cannot set a custom `Authorization` header) — this phase does not need to invent a CSRF-token mechanism because it does not expand cookie-based authentication to any endpoint that changes state.

## 16. Rollback strategy

Every change is additive and independently revertible: the two new `SecuritySession` columns are nullable (dropping the migration leaves every existing row and every existing code path — Bearer-only — fully functional); the new guard and pending-authorization table are new files/routes, not modifications to existing ones; `JwtAuthGuard` and `AuthorizeService` are untouched. Reverting this phase's commit alone, with no data migration required, restores the exact prior (documented-gap) behavior.
