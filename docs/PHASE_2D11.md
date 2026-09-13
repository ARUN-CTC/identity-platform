# Phase 2D.11 — Production Readiness, Resilience & Security Validation

## Objective

Validate — and, only where genuinely necessary, fix — the Identity Platform's readiness to serve as shared production identity infrastructure. A validation-first phase, not a feature-development phase. See `docs/PRODUCTION_READINESS.md`, `docs/RESILIENCE_AND_FAILURE_MODEL.md`, and `docs/SECURITY_OPERATIONS_RUNBOOK.md` for the full detail.

## What was found and fixed

- **Configuration** — `validateProductionConfig` (Phase 2D.9) had no check at all for `JWT_ACCESS_SECRET` (a missing value previously surfaced only as a cryptic runtime `jsonwebtoken` error on the first login, not a boot-time failure) or `DATABASE_URL` (could still carry the local-dev example password in production) or `CORS_ALLOWED_ORIGINS` (did not exist as a concept at all — CORS was maximally permissive in every environment). All three now fail closed in production. Added upper bounds (not just "positive") for `OAUTH_CLOCK_SKEW_SECONDS` (≤300s) and `OAUTH_AUTHORIZATION_CODE_TTL_SECONDS` (≤600s) — an excessively large value in either is itself a security-relevant misconfiguration, not merely a malformed one. Extended the numeric-validation list to cover the legacy JWT/session TTL env vars, previously unchecked.
- **CORS** — `app.enableCors()` previously took no options at all, reflecting any origin unconditionally, in every environment including production. Now configurable via `CORS_ALLOWED_ORIGINS`; production refuses to boot without it explicitly set (and refuses a wildcard). Extracted to a small, unit-tested pure function (`src/config/cors.config.ts`) since no existing e2e fixture invokes `main.ts`'s own `bootstrap()`.
- **Health / readiness** — the single `GET /health` conflated liveness and readiness and depended on the database, meaning an orchestrator using it as a liveness probe could restart a healthy process merely because the database was temporarily unreachable. Added `GET /health/live` (no I/O) and `GET /health/ready` (503 when the database is unreachable); kept `GET /health` unchanged for backward compatibility.
- **P2002 race conditions** — `TenantsService.create()`, `ProductsService.create()`, and `UsersService.createInternal()` each had a check-then-insert race: two concurrent requests for the same `tenantCode`/`slug`/brand-new `email` could both pass the pre-check, and the loser would surface as an unhandled 500 (no global exception filter is, or should be, wired — see below). All three now catch the underlying `P2002` and convert it to the same 409 the pre-check already promised. Verified with direct concurrency tests (`Promise.allSettled` against the real service).
- **`AllExceptionsFilter` reviewed, deliberately NOT globally registered** — it exists and has its own P2002→409 mapping, but registering it globally would re-wrap every OAuth/OIDC/resource-server `HttpException` into this platform's generic response envelope, breaking the frozen RFC 6749/6750 wire contract those classes' own doc comments rely on. Documented as an explicit architectural decision, not an oversight — the local-catch-per-service pattern is correct and stays.

## What was verified, unchanged (no code required)

- **Cryptography**: HS256/RS256 separation, algorithm pinning, `kid` handling, issuer/audience/temporal validation — all already correct (Phase 2D.1/2D.5/2D.9).
- **Tenant isolation**: `identity_app` confirmed `NOBYPASSRLS` and RLS confirmed enabled+forced on 6 checked tenant-scoped tables — directly queried against the live database, not merely read from a migration file.
- **JWKS resilience**: re-confirmed against Phase 2D.9's own 10-point checklist.
- **Rate limiting**: unchanged; the in-process store's single-instance limitation re-documented as a live production deployment requirement.
- **OAuth/OIDC/resource-server flows**: full regression, zero protocol change.

## Backup / restore — real validation performed

`pg_dump` as `identity_owner` (the elevated, RLS-bypass-via-ownership role — `identity_app` itself CANNOT dump the database at all, a genuine finding: RLS blocks it from reading cross-tenant rows, correct/expected behavior given its `NOBYPASSRLS` posture) → restore into a disposable `identity_platform_db_restore_test` database → exact row-count match verified on 9 security-critical tables → RLS confirmed to survive the restore → disposable database dropped. Scripted and reproducible: `database/scripts/backup-restore-validate.sh` (run successfully during this phase).

## Load-test baseline (real, reproducible, documented limitation)

`GET /health/live`, `GET /health/ready`, `GET /.well-known/jwks.json` — measured against the real built application, concurrency 20, 200 requests each, zero errors. See `docs/RESILIENCE_AND_FAILURE_MODEL.md` §3 for the full table and methodology. Write-heavy OAuth endpoints (`/authorize`, `/token`, `/userinfo`) were NOT load-tested this pass (documented as a limitation, not overclaimed as covered) — building their fixture-provisioning harness for a load generator was judged lower priority than the dependency-failure/concurrency-race work within this phase's effort budget.

## Tests

```text
Unit:        271/271 PASS (261 pre-existing + 10 new: cors.config.spec.ts (5), production-config additions (5))
E2E:         325/325 PASS (318 pre-existing + 7 new: tests/phase2d11-production-readiness.e2e-spec.ts)
Security:    embedded in E2E (health/readiness, RLS live-query, P2002-race tests)
Concurrency: 3 new tests (Tenant/Product P2002-race via Promise.allSettled, plus a raw-Prisma race) + all pre-existing concurrency tests unmodified and re-passing
Load/Perf:   docs/RESILIENCE_AND_FAILURE_MODEL.md §3 (3 endpoints, 600 total requests, 0 errors) — see limitation noted above
Migration:   N/A — no schema change
Backup/Restore: PASS — database/scripts/backup-restore-validate.sh, real run, cleaned up
Build:       PASS (nest build, exit 0)
Typecheck:   PASS (tsc --noEmit, exit 0)
Prisma:      VALID (npx prisma validate); zero diff in database/prisma/schema/
```

## Database

```text
DB changes: 0
Migration: none
```

## Regression

Every prior phase's own suite (2A through 2D.10) re-run unmodified and passing — see the exact E2E count above.

## TravelOS Isolation

```text
Files: 0   Dependencies: 0   DB: 0   Migrations: 0   Git history: 0
```

## Known Issues

- **Medium**: no `statement_timeout`/`connection_limit` is enforced by application code — available via `DATABASE_URL` query parameters (documented, `.env.example`), but not itself validated or defaulted. An operator who forgets to set them gets Prisma/pg's own unbounded defaults.
- **Medium**: no application Dockerfile exists — `docker-compose.yml` provisions only the local-development database. Deployment baseline is documented (`docs/RESILIENCE_AND_FAILURE_MODEL.md` §5); the container image itself is not built (new deliverable work, out of this phase's validate-the-existing-system scope).
- **Low**: `/authorize`/`/token`/`/userinfo` were not included in this phase's load-test pass (documented limitation, §Load-test baseline above).
- **Low**: no distributed `RateLimitStore` implementation exists — required before any multi-instance production deployment (unchanged since Phase 2D.9, re-stated here as a live requirement).
- **Low**: no metrics/log/trace exporter is wired to a real backend — `IdentityMetrics` remains in-process only (unchanged since Phase 2D.9).

None of the above is classified Critical/High — no tenant-isolation, authentication, or authorization defect was found; every dependency-failure mode either fails closed or fails in a way that cannot itself grant unauthorized access.

## Deferred Scope

Everything Phase 2D.9/2D.10 already deferred (MFA, Passkeys, SAML, Dynamic Client Registration, Device Authorization Grant, Token Exchange, Impersonation, advanced consent, pairwise subjects, ACR/AMR, refresh-token redesign, billing/metering/org-level subscriptions, product-specific IAM, full SDKs, TravelOS runtime integration) plus, new to this phase's own explicit scope: application containerization, distributed rate-limit backend implementation, and a full authenticated-flow load-test harness.

## Git

```text
Previous HEAD: f52e45c (feat(identity): establish external product integration contract)
```

Commit created at the end of this phase containing only Phase 2D.11 files — see the final report for the exact SHA.

## Final Decision

```text
PHASE 2D.11 — PASS
```
