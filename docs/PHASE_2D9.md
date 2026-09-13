# Phase 2D.9 — OAuth/OIDC Operational Hardening & Consent Boundary

## Objective

Harden the now-functional OAuth/OIDC platform (Phase 2D.1-2D.8) for
production operational behavior — abuse resistance, bounded resource
consumption, observability, and configuration safety — without
redesigning any completed architecture and without expanding into the
large deferred protocol features. See `docs/OAUTH_OPERATIONAL_HARDENING.md`
for the full design and review.

## What was implemented

- **Rate limiting** (new, `src/common/rate-limit/`) — a reusable,
  provider-neutral abstraction (`RateLimitStore`/`RateLimitService`/
  `RateLimitPolicy`/`RateLimitGuard`), applied to `GET /oauth/authorize`,
  `POST /oauth/token`, and `GET /oauth/userinfo` via `@RateLimited(name)`.
  Default in-process store (`InMemoryRateLimitStore`); a production,
  multi-instance deployment swaps in a different `RateLimitStore` behind
  the SAME token, no other file changes. Keyed by `client_id` + a
  SHA-256-hashed, bounded source identifier — never the raw IP, never
  bypassable by changing an unrelated request field. Denials are a single
  protocol-agnostic `RateLimitExceededException` (429,
  `{error: 'temporarily_unavailable', ...}`, `Retry-After` header) that
  never reveals whether the named client/credential exists.
- **Resource consumption limits** (new) — explicit `@MaxLength` bounds
  (`OAUTH_INPUT_MAX_LENGTHS`) on every OAuth/OIDC request field
  (`AuthorizeQueryDto`, `TokenRequestDto`), plus a bounded raw
  bearer-token length check (`extractBearerToken`) — all deterministic
  400/401 rejections, never silent truncation.
- **Request correlation** (reused, extended) — the pre-existing
  `JwtAuthGuard`/`RequestContextService.traceId` mechanism is now threaded
  into every OAuth/OIDC audit event via `SecurityEvent.correlationId`
  (`AuthorizeService`, `AuthorizationCodeGrantService`,
  `ClientCredentialsService`, the new `UserInfoController` audit calls).
- **Security observability** — `UserInfoController` now records
  `OIDC_USERINFO_ACCESSED`/`OIDC_USERINFO_DENIED` (a genuine gap from
  Phase 2D.8, closed); a new stable reason-code vocabulary
  (`OAuthReasonCodes`) is introduced as an additive layer alongside the
  existing, already-tested internal reason strings (crosswalk documented,
  no risky mass rename).
- **Metrics abstraction** (new, `src/common/metrics/`) — `IdentityMetrics`
  (`@Global()`, in-process counters + bounded duration samples), wired
  into every OAuth/OIDC issuance/denial path and the rate limiter. Forces
  no monitoring vendor; label-free by construction (no high-cardinality
  data possible).
- **Authorization-code lifecycle hardening** —
  `AuthorizationCodesRepository.deleteExpiredForTenant()` (RLS-scoped,
  never touches an unexpired row) plus a standalone, cross-tenant
  maintenance script (`database/scripts/cleanup-expired-authorization-codes.ts`,
  documented operational runbook, no background-worker framework
  introduced).
- **Consent boundary** (new, deliberately inert) —
  `ConsentPolicy`/`ConsentContext`/`ConsentDecision` interfaces
  (`src/modules/oauth/interfaces/consent-policy.interface.ts`) — a
  documented future seam; nothing in this codebase constructs, registers,
  or calls an implementation. `AuthorizeService` is completely unmodified
  by this section.
- **JWKS operational resilience** — reviewed against the brief's own
  10-point checklist; every item already correctly implemented since
  Phase 2D.1/2D.5 (no code change needed). Manual key-rotation procedure
  documented (automatic rotation explicitly not implemented — no
  coordinated multi-key publication mechanism exists to safely automate).
- **Configuration validation** (new) —
  `src/config/production-config.validation.ts`, wired into
  `ConfigModule.forRoot({ validate })`. Fails closed at boot (before any
  module is instantiated) on a malformed numeric timing/rate-limit env
  var (any environment) or a missing/placeholder `OAUTH_ISSUER` /
  missing `OAUTH_PRIVATE_KEY` in production.
- **Test infrastructure** — `tests/jest-e2e.json` gained a
  `testTimeout: 30000` (up from Jest's built-in 5000ms default), a
  wall-clock budget increase only, made after diagnosing a genuine
  environmental slowdown (see Tests §Test infrastructure flake below);
  no assertion, fixture, or behavior was changed.

## Security Results

Rate limiting is verified to deny beyond each policy's configured
threshold, recover after the window elapses, never leak client/credential
existence through its response, and never be evaded by varying an
unrelated request parameter. Oversized `state`/`nonce`/`scope`/`audience`/
`redirect_uri`/bearer-token values are all deterministically rejected,
never truncated. A correlation id is generated (or an external one
honored), appears on the resulting audit record, and never affects the
authorization decision itself. Durable audit events for successful and
denied token exchanges, and OIDC denials specifically, contain no access
token, authorization code, PKCE verifier, nonce value, or client/service-
account secret. Authorization-code cleanup deletes only genuinely expired
rows and never an unexpired one, consumed or not. Every existing OAuth/
OIDC/Resource-Server/Client-Credentials flow (Phase 2D.4-2D.8) continues
to pass unmodified.

## Tests

```text
Unit:        251/251 PASS (223 pre-existing + 28 new) — clean full run, exit code 0
E2E:         311/311 PASS (288 pre-existing + 23 new: tests/phase2d9-oauth-operational-hardening.e2e-spec.ts)
             — clean full run (16 suites, 16 passed), exit code 0
Security:    embedded in E2E (Rate limiting, Input size limits, Telemetry safety describe blocks)
Concurrency: embedded in E2E (16-way concurrent code redemption, re-verified; rate-limit burst tests)
```

### Test infrastructure flake — identified, reproduced, isolated, rerun cleanly, documented

During this phase's own full-regression verification (not a defect in any
Phase 2D.9 test, and not a regression this phase's code caused), two
consecutive full `npm run test:e2e` runs both failed the SAME way:
`tests/phase2d7-authorization-code-pkce.e2e-spec.ts`'s `beforeAll` hook
(module compile + Nest application bootstrap) exceeded Jest's built-in
5000ms default hook timeout, failing every test in that file. Individual
suite wall-clock times across both runs were consistently 2-4x their
historical baseline (e.g. 24s vs. ~5-8s), including suites that passed —
evidence of environmental/system load rather than a functional defect.
No stray Identity-Platform process or elevated DB connection count was
found on inspection.

- **Identified**: `beforeAll` hook timeout, not an assertion failure —
  the thrown error is Jest's own "Exceeded timeout of 5000 ms for a hook"
  message, at the `Test.createTestingModule(...).compile()` /
  `createNestApplication()` line.
- **Reproduced**: two independent full-suite runs, same file, same
  failure shape.
- **Isolated**: `tests/jest-e2e.json` has no `testTimeout` override
  (Jest's built-in 5000ms default applies to every hook and test); no
  Phase 2D.9 code change touches `phase2d7`'s fixtures, and the same
  fixture setup pattern (`Test.createTestingModule({imports:[AppModule]})`)
  is shared by every other e2e file, none of which name a code-level
  reason this file specifically would slow down.
- **Fix applied**: added `"testTimeout": 30000` to `tests/jest-e2e.json`
  — a wall-clock budget increase only; no test assertion, fixture, or
  behavior was changed to make this pass. This is infrastructure-budget
  tuning for a slower execution environment, not weakening a test to
  eliminate a failure.
- **Rerun cleanly**: a subsequent full `npm run test:e2e` run, with the
  new timeout in place, passed all 16 suites / 311 tests with exit code
  0 (`phase2b2-product-entitlement` in particular still took 180s —
  confirming the environment really is this slow right now — but stayed
  well inside the new 30s-per-hook budget). A second full `npm run test`
  (unit) run also passed all 24 suites / 251 tests with exit code 0.

## Build

```text
Typecheck: PASS (tsc --noEmit, exit 0)
Build:     PASS (nest build, exit 0)
Prisma:    VALID — `npx prisma validate` passes; `git diff --stat database/prisma/schema/` is empty (zero schema drift)
Migration: N/A — no schema change
```

## Database

```text
DB changes: 0
Migration: none
```

No schema change — `oauth_authorization_code` (Phase 2D.7/2D.8) already
carried every fact this phase's cleanup logic needs.

## Regression

Phases 2A / 2B / 2B.1 / 2B.2 / 2C / 2C-stabilization / 2D.1 / 2D.2 / 2D.3 /
2D.4 / 2D.5 / 2D.6 / 2D.7 / 2D.8 all still green, unedited except the pure,
additive, non-behavior-changing correlation-id/metrics enrichment
described above.

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0
```

## Known Issues

- **Low**: `RateLimitStore`'s default implementation is in-process —
  correct for a single-instance deployment; a multi-instance production
  deployment needing a SHARED limit across instances must supply its own
  `RateLimitStore` implementation (the seam exists; a concrete
  Redis-backed one is not built, per brief §4's own "do not hard-code
  Redis").
- **Low**: no `/metrics` HTTP endpoint is exposed — `IdentityMetrics` is
  in-process/test-observable only; wiring a real exporter is left to the
  deployment.
- **Low**: automatic JWKS key rotation is not implemented — a documented
  manual procedure exists (`docs/OAUTH_OPERATIONAL_HARDENING.md` §8).
- **Deferred**: consent remains an inert interface only — no real
  third-party consent flow exists yet (by design, brief §10).
- **Medium** (pre-existing, discovered by this phase, not caused by it):
  no e2e test file in this repository — across all eight prior phases —
  ever called `app.useGlobalPipes(new ValidationPipe(...))` in its test
  fixture; the real running app registers it in `src/main.ts`, but every
  e2e suite until now exercised the app WITHOUT DTO-level `whitelist`/
  `forbidNonWhitelisted`/`transform` enforcement actually active. This
  phase's own new e2e file is the first to register it (needed to prove
  its own `@MaxLength` size-limit tests), but no other, pre-existing
  e2e file was touched to add it — doing so was judged out of scope for
  a phase whose brief is operational hardening, not e2e-harness
  remediation, and risks perturbing ~500 already-passing assertions.
  Flagged here rather than silently left for a future phase to
  rediscover.

## Deferred Scope

```text
MFA, Passkeys, SAML: deferred
Dynamic Client Registration, Device Authorization Grant: deferred
Token Exchange, Impersonation, token forwarding: deferred
Advanced consent management: deferred (inert seam only)
Pairwise subjects, ACR/AMR framework: deferred
Refresh-token redesign: deferred (unchanged from Phase 2D.7)
SDKs: deferred
Product-specific IAM: deferred (0 product-specific code)
Billing, metering, organization-level product subscriptions: deferred
TravelOS integration: deferred (0 changes)
```

## Git

```text
Previous HEAD: ecf0d61 (feat(identity): implement OIDC provider)
```

Commit created at the end of this phase containing only Phase 2D.9 files
— see the final report for the exact SHA.

## Final Decision

```text
PHASE 2D.9 — PASS
```
