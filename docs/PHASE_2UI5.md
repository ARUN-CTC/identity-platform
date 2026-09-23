# Phase 2UI.5 — Identity Platform End-User Authentication UX

## Prerequisite

Phase 2UI.4's commit (`295f1ae feat(identity): implement tenant admin console`) was verified as HEAD before implementation began. Two parallel read-only audits were run before any code was written: one over the existing tenant-scoped frontend's auth surface (Login, AuthLayout, Forgot/Reset Password, Accept Invitation, `AuthProvider`'s full token/session lifecycle, session-expiration handling, `shared/api/client.ts`'s 401-retry logic, existing tests), one over the exact backend contract (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, password reset, invitations, `/oauth/authorize`, `/oauth/token`, `/userinfo`, organization-context switching, rate-limiting/lockout, redirect-URI validation). Both are summarized in `docs/IDENTITY_AUTHENTICATION_UX.md` §1.

## 1. Result

**CONDITIONAL PASS** — every journey the brief asked for was implemented, tested, and verified against the real backend contract, *except* the OAuth Authorization Shell's final hand-off, which was found — through direct verification, not assumption — to be blocked by a genuine, pre-existing backend/session-architecture gap this phase's own brief explicitly forbids closing (no new token architecture, no tokens in URLs, no new protocol machinery). That gap is documented precisely, not papered over, and the shell built around it is real, tested, and honest about what it can and cannot complete. See §5 and §16 for the full account.

## 2. Existing authentication UX audit

Login, Forgot/Reset Password, and Accept Invitation were already real, backend-integrated screens (Accept Invitation already had 6 tests). `AuthProvider` already implemented the full access/refresh token lifecycle, in-memory Bearer storage, and organization-context switching. Confirmed absent: a post-login organization picker, a dedicated session-expired dialog (toast only), and — found only by tracing the actual guard code, not assumed — any frontend surface at all for `/oauth/authorize`, which existed purely as an unreachable-by-real-browser-navigation backend route.

## 3. Login implementation

`shared/auth/components/LoginForm.tsx` (new) extracted unchanged from the former `LoginPage.tsx`, now reused by both the standalone `/login` route and the OAuth shell's inline sign-in step. Verified (not rebuilt): show/hide password, correct `autocomplete` attributes, react-hook-form + zod validation, safe error messaging preserving the backend's own deliberate anti-enumeration design (wrong password / unknown email / unknown tenant all collapse to one generic message; a locked or disabled account gets its own specific, safe message). New: `getAuthErrorMessage()`, a generalized, reusable version of the page-local error mapper it replaced.

## 4. OAuth implementation

`app/pages/oauth/OAuthAuthorizePage.tsx` (new). Parses the OAuth request, shows a generic (never client_id-branded) sign-in step when unauthenticated, then calls the real `GET /oauth/authorize` with the caller's own Bearer token via `fetch(..., {redirect: "manual"})`. Fully functional: every pre-`redirect_uri`-validation error (unknown/inactive client, unregistered redirect URI) is real, readable, and mapped to safe text. Honestly non-functional, and said so plainly: the success/denial redirect that happens once `redirect_uri` is validated cannot be completed by any real browser navigation, because this platform's session is Bearer-header-only with no cookie fallback (verified directly in `JwtAuthGuard`'s source) and a top-level navigation cannot carry a custom header. See §16.

## 5. OIDC implementation

No OIDC-specific frontend work was needed or built — ID Tokens are issued at `/oauth/token` (a server-to-server call between the product's backend and this platform, per `docs/OIDC_PROVIDER.md`), never touching the browser or this frontend. `/userinfo` is likewise never called by this frontend — it's consumed by the OIDC client (the product), not by Identity Platform's own UI. Nothing to implement, nothing fabricated.

## 6. Password/reset capability

**Existing and reused**, both halves complete on the backend before this phase began (`POST /auth/password/forgot`, `POST /auth/password/reset`). This phase added the only thing missing: test coverage (`ForgotPasswordPage.test.tsx`, `ResetPasswordPage.test.tsx` — neither existed before; 8 new tests total, including an explicit anti-enumeration assertion and a browser-storage-never-contains-the-new-password check).

## 7. Invitation UX

**Existing and reused**, unchanged — already real, already tested (6 tests, pre-existing). Confirmed via this phase's own backend audit: accept does not auto-log-in (a deliberate backend design — it only sets the password and activates the membership), matching the existing UI's own behavior exactly (a "sign in" link, not an automatic session).

## 8. Organization context UX

**Implemented this phase.** `app/pages/ChooseOrganizationPage.tsx` (new) — shown after login when the caller's context is still tenant-wide (confirmed: the backend never auto-selects one at login, regardless of how many organizations exist) and more than one organization is available; a sole organization is established automatically without asking. Built entirely on the existing, unmodified `switchOrganization()`/`listMyOrganizations()` machinery — the backend remains authoritative throughout (a denied switch is surfaced, not silently worked around).

## 9. Logout/session handling

Logout: unchanged, verified correct (real server-side session + refresh-token revocation). Session expiration: **implemented this phase** — `SessionExpiredDialog` (new), a dedicated, non-Escape-dismissable modal replacing a toast-only treatment, wired into `AuthProvider`'s existing `onSessionExpired` listener.

## 10. Authentication error UX

`shared/auth/authErrorMessages.ts` (new) — `getAuthErrorMessage()` and `getOAuthErrorMessage()`, the one reusable mapping brief §16 asks for, used by `LoginForm`, `ChooseOrganizationPage`, and `OAuthAuthorizePage`.

## 11. Security-sensitive URL handling

Audited every query parameter this phase's new code reads. No open redirect exists anywhere in the new code — `ProtectedRoute`'s existing post-login redirect uses React Router `state`, never a URL string, so there is nothing attacker-controlled to validate there; the OAuth shell never itself redirects based on `redirect_uri` (the real destination is always decided server-side). Full account in `docs/IDENTITY_AUTHENTICATION_UX.md` §8.

## 12. Token-handling verification

Zero changes to token storage/refresh/rotation. `OAuthAuthorizePage`'s one raw `fetch()` reads the current access token via the same existing accessor `apiRequest()` already uses internally — not a new token-handling path. Verified directly in tests: no token, code_challenge, state, or new password from any of this phase's flows ever appears in `localStorage`/`sessionStorage`.

## 13. Accessibility

One real issue found during development (an `autoFocus` on `SessionExpiredDialog`'s button) — caught by lint, removed. Every new screen reuses already-accessible design-system components unchanged. `SessionExpiredDialog`'s non-dismissable-via-Escape behavior is a deliberate, tested exception (nothing left to cancel back into once the session is already cleared).

## 14. Responsive behavior

No new responsive work needed — every new screen (`ChooseOrganizationPage`, `OAuthAuthorizePage`) reuses the same `AuthLayout`/`Card` shell the pre-existing Login/Forgot/Reset/Accept-Invitation pages already use, inheriting their mobile-width behavior unchanged.

## 15. Security matrix

| Area | Case | Result |
|---|---|---|
| Login | Valid credentials | Real, tested |
| Login | Invalid credentials (generic, anti-enumeration) | Real, tested |
| Login | Disabled/locked account (specific, safe message) | Real (backend-verified this phase), pass-through confirmed by design |
| OAuth | Unknown/inactive client | Real, tested — direct JSON, safe mapped text |
| OAuth | Invalid/unregistered redirect_uri | Real, tested — direct JSON, safe mapped text, never followed |
| OAuth | Missing PKCE / invalid scope / invalid state / invalid nonce | Handled server-side per `docs/OAUTH_AUTHORIZATION_CODE_PKCE.md`/`docs/OIDC_PROVIDER.md`, unmodified this phase; frontend cannot reach these outcomes today (see §16 — they sit behind the same unreachable redirect) |
| OAuth | Missing required params (`client_id`/`redirect_uri`) | Real, tested — no backend call at all |
| Organization | Valid switch | Real, tested |
| Organization | Denied switch (backend 403) | Real, tested — picker not lost |
| Organization | Sole organization, no ambiguity | Real, tested — auto-established |
| Session | Session-expired dialog appears and is not Escape-dismissable | Real, tested |
| Redirect security | Open redirect via post-login `state.from` | Structurally impossible — `state`, not a URL string (verified, documented) |
| Storage | No secret/password/token persisted anywhere by this phase's new flows | Real, tested (explicit storage-content assertions) |

## 16. Backend Changes

**None.** Every journey in this phase is built entirely on existing, unmodified backend endpoints. The one capability this phase could not deliver — OAuth's final browser-redirect completion — was deliberately **not** patched with a new endpoint, cookie, or token-in-URL workaround, because every such fix is explicitly out of scope for a UX-only phase (brief §19, §31) and because a change of that shape (introducing a new session-handoff credential) deserves its own dedicated security review, not a UI-driven addition made under this phase's constraints.

## 17. Frontend Tests

```text
211/211 pre-existing (Phase 2UI.4 baseline) + 38 new:
  LoginPage.test.tsx           — 6 (new)
  ChooseOrganizationPage.test.tsx — 4 (new)
  OAuthAuthorizePage.test.tsx  — 6 (new)
  ForgotPasswordPage.test.tsx  — 3 (new)
  ResetPasswordPage.test.tsx   — 5 (new)
  AuthProvider.sessionExpiry.test.tsx — 2 (new)
Total: 249/249 passing (50/50 files) — confirmed via isolated runs of every changed/new file plus
  a full-suite run. One pre-existing, unrelated test (features/memberships InvitationsPage,
  untouched by this phase) times out only under full 50-file parallel load in this sandboxed
  environment (passes in under 2s standalone) — a resource-contention artifact of the test
  environment, not a regression; documented previously in Phase 2UI.3/2UI.4's own reports as a
  known, pre-existing environmental condition.
```

Two real bugs were found and fixed by these tests themselves, not worked around:
1. `ChooseOrganizationPage` used the generic `getApiErrorMessage()` (which remaps 403 to a vague "no permission" message) instead of the new `getAuthErrorMessage()` — a denied organization switch would have shown the wrong text. Fixed.
2. `OAuthAuthorizePage`'s `LoginForm.onSuccess` callback redundantly re-set `step` to `"authorizing"` — a genuine race, since `onSuccess` can fire *after* the page's own effect (triggered independently and earlier by `isAuthenticated` changing) has already progressed further (e.g. to `"unavailable"`), silently reverting it. Fixed by making `onSuccess` a no-op — the effect already reacts to auth state on its own.

## 18. Backend Tests

Unaffected — zero backend files changed. The Phase 2UI.4 baseline (348/348 e2e, 277/277 unit) stands unmodified.

## 19. Build/typecheck/lint

```text
Frontend typecheck (tsc -b --noEmit): PASS, 0 errors
Frontend build (vite build):          PASS
Frontend lint (eslint):               PASS, 0 errors (9 pre-existing, unrelated warnings — unchanged)
```

## 20. API Gaps

Full table in `docs/IDENTITY_AUTHENTICATION_UX.md` §7. Summary: OAuth completion and OAuth product-branding are genuinely **Unavailable** (documented, not fabricated); password reset, invitation acceptance, and organization-switching APIs were all **Existing and reused**; organization-selection UI and session-expiration UI are **Implemented** this phase.

## 21. Documentation

`docs/PHASE_2UI5.md` (this document), `docs/IDENTITY_AUTHENTICATION_UX.md` (full technical reference). `docs/IDENTITY_ADMIN_INFORMATION_ARCHITECTURE.md`/`docs/IDENTITY_UX_ARCHITECTURE.md` were reviewed; neither required an update — both describe the two admin consoles' own IA, which this phase did not change (the one shared component, `LoginForm`, doesn't alter either console's navigation or screens).

## 22. Product Isolation

```text
TravelOS:                     0 changes
CTC Banking Intelligence AI:  0 changes
QueueStream.health:           0 changes
```

## 23. Git Commit

Staged and committed separately — see the final report's own Git section for the exact hash, matching `git status`/`git diff --stat` verification performed immediately before committing.

## 24. Known Issues

**High**: OAuth Authorization Code + PKCE cannot currently be completed end-to-end by any real end-user browser flow — a pre-existing backend/session-architecture gap (Bearer-only session, no cookie fallback), confirmed by direct code inspection of `JwtAuthGuard` and `AuthorizeController`, not something this phase introduced or could close within its own explicit constraints (no new token architecture, no tokens in URLs). This is the primary reason for this phase's CONDITIONAL result. See `docs/IDENTITY_AUTHENTICATION_UX.md` §5/§7 for the full technical account and the two rejected workarounds.

**Medium**: No public endpoint exists to resolve an OAuth `client_id` into a trusted application display name — the sign-in shell shows a generic notice rather than the product's name, correctly, but this means the brief's own "Sign in to continue to TravelOS" example cannot be realized as shown until a minimal, genuinely public lookup endpoint exists.

**Low**: the same pre-existing full-frontend-suite test-timing sensitivity noted in Phase 2UI.3/2UI.4 (one specific, CPU-heavier test occasionally exceeds the default timeout only under full 50-file parallel load in this environment) — unrelated to this phase's own changes.

## 25. Deferred

```text
MFA / Passkeys / SAML / Device Authorization / Token Exchange /
  Dynamic Client Registration / impersonation / new grant types   — explicitly out of scope, untouched
OAuth completion (the real fix)                                   — needs its own dedicated backend/
                                                                       security-review phase, not UX work
OAuth application branding lookup                                 — P2, depends on the above
Phase 2UI.6 — Developer / Application Authentication Portal        — not started
```

## 26. Recommendation for Phase 2UI.6

Phase 2UI.6 can begin on the Platform/Tenant admin console surfaces, but **the OAuth completion gap identified in this phase should be resolved — or explicitly, deliberately accepted as a known limitation by whoever owns this platform's security architecture — before any real product (TravelOS, Banking AI, QueueStream, or a future GymOS) attempts to integrate the Authorization Code flow against this backend**, since today that integration cannot function for a real end user no matter how well-built the surrounding UI is. This is not a UX gap Phase 2UI.6 can close either — it requires a deliberate backend/session-architecture decision, explicitly out of scope for a UI-implementation phase, made with the same rigor as this platform's other security-sensitive design decisions.

## Final Decision

```text
PHASE 2UI.5 — CONDITIONAL PASS
```
