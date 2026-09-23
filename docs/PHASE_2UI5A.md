# Phase 2UI.5A — OAuth Browser Session & Authorization Completion

## Prerequisite

Phase 2UI.5's commit (`6f84007 feat(identity): implement end-user authentication UX`) was verified as HEAD before implementation began. That phase's own `docs/PHASE_2UI5.md` §24 ("Known Issues — High") is the exact gap this phase closes: `GET /oauth/authorize` required `Authorization: Bearer`, which a real top-level browser navigation structurally cannot carry, so a product-initiated `Product → /authorize → Login → Authorization → Product callback` flow could not complete for a real end user. A full architecture-first read of `JwtAuthGuard`, `AuthProvider`, `SecuritySession`, refresh-token handling, `AuthorizeService`, the authorization-code repository, OIDC nonce handling, tenant/organization-context revalidation, CORS/cookie configuration, and the frontend routing/API-client layer was performed before any implementation code was written — summarized in `docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md`.

## 1. Result

**PASS.** The OAuth browser authorization flow now completes end-to-end for a real, unauthenticated browser: `GET /oauth/authorize` → redirect to `/login` with an opaque, single-use, server-issued reference → real sign-in → `GET /oauth/authorize/resume` → standard success (`code`+`state`) or safe denial (`error`+`state`) redirect to the product's own `redirect_uri`. No bearer token, access/ID/refresh token, client secret, or session identifier is ever placed in a URL. PKCE (`S256`-only) and OIDC nonce remain mandatory and untouched. Tenant/organization/product-entitlement validation is unchanged and independently re-verified through the resume path. Backward compatibility with the pre-existing Bearer-only caller shape (an already-authenticated SPA calling `/oauth/authorize` directly) is fully preserved and regression-tested. Zero product (TravelOS/Banking AI/QueueStream) changes.

## 2. Architecture decision

Four options were evaluated in `docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md` §2: (A) a general Identity browser-session cookie, (B) a dedicated short-lived OAuth authorization session, (C) reusing the existing Bearer session mechanism as-is, (D) requiring a Bearer header on the navigation itself. **D was rejected outright** — structurally impossible for a real browser redirect. **C was rejected** — the existing session has no browser-transportable form at all. The selected design **merges B and A's useful parts**: a single new, narrowly-scoped, `HttpOnly`/`SameSite=Lax` cookie (`identity_browser_session`, path-scoped to `/api/v1/oauth`) that identifies the Identity session — never an access/ID/refresh token — reusing this platform's own established self-identifying-token pattern (`base64url(tenantId).secret`, hash-only storage) already used for refresh/password-reset/invitation tokens. A second new, RLS-free, single-use `oauth_pending_authorization` table carries the validated OAuth request parameters (never a user identity) across the login round trip. Full rationale, threat model, and rollback strategy in `docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md`.

## 3. Browser authentication

`OAuthBrowserSessionGuard` (new, route-scoped to exactly `GET /oauth/authorize` and `GET /oauth/authorize/resume`) attempts Bearer authentication first (byte-for-byte the same verification `JwtAuthGuard` already performs — same `TokenService.verifyAccessToken`, same live `SecuritySession.revokedAt` check), then falls back to the new cookie (parse tenant prefix → hash → tenant-scoped `SecuritySession` lookup filtered on `revokedAt: null` and a non-expired `browserSessionSecretExpiresAt`). It **never rejects a request itself** — an unresolved caller simply reaches the controller with no context populated, and the controller (not the guard) decides to redirect to login. `JwtAuthGuard` itself was not modified; every other route in the API is unaffected. The cookie is issued (and refreshed) as a side effect of `POST /auth/login`, `POST /auth/refresh`, `POST /auth/context/switch`, and `POST /auth/context/clear` — stripped back off (`setBrowserSessionCookie()`) before the existing JSON response body is returned, so every existing caller's response contract is byte-for-byte unchanged. `POST /auth/logout` clears it (`res.clearCookie`).

## 4. OAuth flow diagram

```text
Product's browser
  │  GET /oauth/authorize?client_id=...&redirect_uri=...&code_challenge=...
  ▼
AuthorizeController.authorize()
  │  validateClientAndRedirect() — client_id + redirect_uri validated FIRST,
  │  exactly as before; a direct 400/403 JSON error here, never a redirect.
  ▼
OAuthBrowserSessionGuard already ran (Bearer? cookie? neither?)
  ├── authenticated ────────────────────────────► AuthorizeService.handle()
  │                                                 (completely unchanged)
  │                                                       │
  └── NOT authenticated                                   ▼
        │  PendingAuthorizationsService.create()   redirect: code+state
        │  (persists validated request params,      OR error+state
        │   never a user identity)                  to the product's
        ▼                                            redirect_uri
      redirect → /login?authorize_request=<ref>
        │
        ▼  (real sign-in, browser-session cookie established)
      redirect → GET /oauth/authorize/resume?ref=<ref>
        │
        ▼
      PendingAuthorizationsService.consume() — atomic, single-use
        │
        ▼
      AuthorizeService.handle() — same as the already-authenticated path
```

## 5. OIDC

Unchanged. The `openid` scope's mandatory nonce requirement, storage (now on the pending-authorization row for the login-round-trip path, on the authorization-code row directly for the already-authenticated path), and carry-through into the issued ID Token are untested-by-assumption — verified directly by a new e2e test asserting the resumed flow's ID Token contains the exact original nonce. `/userinfo` and `/oauth/token` are untouched by this phase.

## 6. Security

- **No bearer-in-URL, no access/ID/refresh token or client secret in any redirect** — verified directly by regex assertion in e2e tests on every redirect URL this phase's new code produces.
- **No open redirect** — every redirect target is either the platform's own fixed `WEB_APP_BASE_URL`-relative path (`/login`, `/oauth/authorize/expired`) or the already-validated, exact-match `redirect_uri` `AuthorizeService`/`OAuthApplicationPolicyService` independently confirm, exactly as before this phase.
- **No second authentication authority** — the cookie identifies the SAME `SecuritySession` row the existing Bearer session already uses; no new user table, no duplicate identity, no independent revocation model.
- **Pending-authorization transaction**: single-use (atomic `tryConsume`, `count === 1` proof — same pattern as `AuthorizationCodesRepository`), time-bound (600s default), stores zero user/session identity — resuming it always authorizes whoever is *currently* authenticated at resume time, the same behavior every standards-conformant browser-based OAuth IdP already exhibits. Verified: replay of the same reference fails safely (redirect to the generic expired page); a reference resumed by a different, later-authenticated user is issued correctly to that user, never silently to an earlier one.
- **CSRF**: scoped to exactly zero state-changing endpoints. The cookie is read by one guard, on two GET routes, both pure "authenticate-then-redirect." Every state-changing endpoint (login, logout, refresh, organization switch) remains Bearer-header-only, unchanged, and therefore structurally CSRF-immune.
- **TenantStatusGuard interaction** (found and verified during implementation, not assumed safe): because `OAuthBrowserSessionGuard` is route-scoped, it runs *after* the global `TenantStatusGuard`, which no longer sees a `tenantId` at the point it runs for this now-`@Public()` route. This does not reopen a gap — `AuthorizeService.handle()` already independently re-validates `tenant.status === 'ACTIVE'` at its own step 9 (written in Phase 2D.7, explicitly as "defense in depth"), and this remains fully intact. Covered by a new, explicit e2e regression test. Documented in `docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md` §6.
- **PKCE**: unchanged, `S256`-only, mandatory.
- **Cookie properties**: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/oauth`, `Secure` in production (omitted only for non-production loopback, documented exception), `Max-Age` mirrors the refresh-token TTL for the same "remember me" state. Verified directly against the real `Set-Cookie` header in e2e tests.

## 7. Tenant/organization

Unchanged authority model. `AuthorizeService.handle()` still independently re-validates any `organization_id` — whether a live request parameter or a value carried on a resumed pending-authorization row — against the resuming caller's own **live** Membership; a stale/foreign hint is denied (`access_denied`), never silently trusted. New e2e coverage: a tenant genuinely not entitled to the requested product is denied even when resuming through the full login round trip, and a suspended tenant is denied via the `AuthorizeService`-level check (§6).

## 8. Regression

Full backend e2e (23 suites, 396 tests) and unit (30 suites, 306 tests) run clean. Client Credentials, Resource Server validation, Platform Operator boundary, Tenant Admin boundary, Product entitlement, legacy HS256 boundary, and external RS256 boundary are all exercised, unmodified, by their own existing suites, all still passing. One pre-existing e2e file (`tests/phase2d7-authorization-code-pkce.e2e-spec.ts`) had its "unauthenticated `/authorize` request" tests deliberately updated — from asserting the old bare-401 status quo to asserting the new, intended redirect-to-login behavior this phase exists to build; this is the documented, intentional behavior change the brief calls for, not an unexplained modification. Frontend regression: 49/49 files, 246/246 tests. (A run under full default parallelism showed 11 unrelated timeout failures across 5 files never touched by this phase — confirmed to be pure test-runner resource contention on this machine, not real failures, by re-running each of those 5 files in isolation, where every one passes; also reproduced cleanly under a reduced worker count.)

## 9. Tests

```text
Unit (backend, jest):        306/306 passing (30/30 suites)
  New: token.service.spec.ts        +10 (browser-session secret, pending-authorization reference)
       oauth-browser-session.guard.spec.ts  11 (new file — Bearer path, cookie path, precedence, live revocation)
       pending-authorizations.service.spec.ts  7 (new file — create/consume, replay, race-loss, non-enumeration)

E2E (backend, jest):          396/396 passing (23/23 suites)
  New: tests/phase2ui5a-oauth-browser-session.e2e-spec.ts  17 (new file)
    - Unauthenticated browser initiation (2)
    - Login issues the browser-session cookie (2)
    - Full resume flow end-to-end incl. OIDC nonce and denial (4)
    - Replay/expiry/invalid references (4)
    - Session lifecycle: logout invalidation, cross-user resume (2)
    - Tenant validation: suspended tenant, unentitled tenant (2)
    - Backward compatibility: Bearer-only caller unchanged (1)
  Updated: tests/phase2d7-authorization-code-pkce.e2e-spec.ts — 2 tests updated to assert the
    new redirect-to-login behavior in place of the superseded bare-401 assertion (36/36 passing)

Frontend (vitest):            246/246 passing (49/49 files)
  New: LoginPage.test.tsx            +2 (authorize_request resume navigation, org-picker carry-through)
       ChooseOrganizationPage.test.tsx +1 (authorize_request resume navigation after org selection)
  Removed: OAuthAuthorizePage.test.tsx (page retired, see §Frontend changes)

Security-specific (subset of the above, called out explicitly):
  - No token/session-id in any redirect URL: verified by regex assertion
  - Open redirect: N/A — no caller-controlled redirect target exists
  - Pending-authorization replay: verified (2nd resume → expired page, not a 2nd code)
  - Cross-user pending-authorization resume: verified (issued to the resuming user, by design)
  - Cookie attributes (HttpOnly/SameSite=Lax/Path/no-Secure-in-dev): verified directly
  - JSON response never leaks the internal cookie payload: verified directly

Concurrency: single-use/atomic-consume semantics verified structurally (same `tryConsume`
  CAS pattern already concurrency-tested for authorization codes in
  tests/phase2d7-authorization-code-pkce.e2e-spec.ts's own "16 concurrent redemptions" test,
  which continues to pass unmodified against this phase's changes).

Build (backend, nest build):        PASS
Typecheck (backend, tsc --noEmit):  PASS, 0 errors
Typecheck (frontend, tsc -b):       PASS, 0 errors
Lint (frontend, eslint):            PASS, 0 errors (9 pre-existing, unrelated warnings — unchanged)
Build (frontend, vite build):       PASS
Prisma (validate):                  PASS
Migration (idempotent re-apply):    PASS — verified via direct re-run against the running test DB
```

## 10. Database

Two additive changes, both required (browser session lookup needs a place to live; the login round trip needs a place to persist a validated-but-not-yet-authenticated request):

- `security_session` gains `browser_session_secret_hash` / `browser_session_secret_expires_at` (both nullable — every existing row and every non-browser session is unaffected).
- New table `oauth_pending_authorization` — no `tenant_id`, no RLS (genuinely tenant-less at creation time, consistent with this platform's existing treatment of other pre-authentication state), single-use via atomic `tryConsume`, time-bound.

`database/ddl/003_security.sql` updated in place (fresh-bootstrap convention) and `database/ddl/011_oauth_pending_authorization.sql` (new) added; `database/migrations/20260924000000_oauth_browser_session.sql` (new, idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`) applied and verified against the running test database, then re-applied to confirm full idempotency (all statements reported "already exists, skipping" on the second run). One real bug was found and fixed during e2e testing: the `OAuthPendingAuthorization.responseType` Prisma field was missing its `@map("response_type")` directive (every sibling field had one), which would have thrown a runtime "column does not exist" error on the very first `/oauth/authorize` call from an unauthenticated browser — caught immediately by this phase's own new e2e suite, not shipped.

## 11. Product isolation

```text
TravelOS:                     0 changes
CTC Banking Intelligence AI:  0 changes
QueueStream.health:           0 changes
```

## 12. Frontend changes

`app/pages/oauth/OAuthAuthorizePage.tsx` (Phase 2UI.5) is **retired** — deleted along with its test and the now-dead `getOAuthErrorMessage()` helper it alone used. It existed specifically to work around the gap this phase closes; the backend now owns the entire redirect chain via real navigations, so no frontend shell page is needed for the primary flow. `LoginPage.tsx`/`ChooseOrganizationPage.tsx` (both otherwise unchanged) now read an optional `authorize_request` reference (query param on `/login`, carried through router `state` to `/choose-organization` exactly like the existing `from` value already is) and, when present, complete with a **real** `window.location.href` navigation to the backend's `/oauth/authorize/resume?ref=...` instead of the existing in-app `navigate()` call. New `OAuthAuthorizeExpiredPage.tsx` (`/oauth/authorize/expired`) handles the one case the backend can redirect the frontend to on its own: a missing/expired/consumed/invalid pending-authorization reference, where no trusted `redirect_uri` remains to redirect an error to.

## 13. Known issues

**High**: none.

**Medium**: none. (Phase 2UI.5's Medium issue — no public endpoint to resolve `client_id` into a trusted display name for branding the sign-in step — remains open and unrelated to this phase; still deferred.)

**Low**: the same pre-existing full-frontend-suite test-timing sensitivity noted in Phase 2UI.3/2UI.4/2UI.5 (resource contention under full default parallelism on this development machine, not a real failure — every affected test passes in isolation and under reduced parallelism) — unrelated to this phase's own changes, re-confirmed still present.

## 14. Deferred

```text
MFA / Passkeys / SAML / Device Authorization / Token Exchange /
  Dynamic Client Registration / impersonation / new grant types   — still explicitly out of scope
New consent framework                                              — not implemented (brief requirement);
                                                                       existing trusted/first-party posture preserved
OAuth application branding lookup (Phase 2UI.5's Medium issue)     — unrelated to this phase, still open
Phase 2UI.6 — Developer / Application Authentication Portal        — not started; awaiting review/approval
```

## Final Decision

```text
PHASE 2UI.5A RESULT: PASS
OAUTH BROWSER AUTHORIZATION: READY
END-TO-END OAUTH: PASS
OIDC: PASS
TENANT ISOLATION: PASS
TRAVELOS: 0 changes
BANKING AI: 0 changes
QUEUESTREAM: 0 changes
NEXT RECOMMENDED PHASE: Phase 2UI.6 — Developer / Application Authentication Portal
```
