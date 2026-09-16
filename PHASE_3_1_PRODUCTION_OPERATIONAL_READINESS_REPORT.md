# Phase 3.1 — Production Deployment & Operational Readiness

## 1. Executive Summary

**PASS WITH FINDINGS**

## 2. Baseline

Recorded at the start of this phase, before any change:

```
Backend Unit: 277/277
Backend E2E:  335/335
Frontend:     194/194
Security status (from Phase 3): PASS WITH FINDINGS — no release blockers,
  two findings fixed (missing rate limiting on login/password-reset/
  invitation routes; missing lockout test coverage)
```

## 3. Repository Architecture Assessment

- **Backend**: NestJS 10 (Express platform), TypeScript, Prisma 5 (`@prisma/client`) against PostgreSQL. Entry point `src/main.ts` → `dist/src/main.js` after `nest build` (locally; a Docker build that only copies `src/` produces `dist/main.js` instead — both are correct given what each build actually includes, confirmed by inspecting `tsconfig.json`'s `include`/inferred `rootDir`).
- **Frontend**: Vite + React 18 + TypeScript, npm workspace at `apps/web`, built via `npm run web:build` from the repo root.
- **Package manager**: npm (`package-lock.json` present at both the root and `apps/web` — deterministic installs via `npm ci`).
- **Database**: PostgreSQL 16 (`docker-compose.yml`, local development only — no other database configuration exists in-repo). RLS is enforced on every tenant-scoped table; the application connects exclusively as `identity_app` (`NOBYPASSRLS`); `identity_owner` (schema owner, `BYPASSRLS`) is reserved for migrations/seeds/backups.
- **Deployment**: no application `Dockerfile` existed before this phase (confirmed absent; `docker-compose.yml`'s own header comment scopes it to local-dev Postgres only). No cloud provider, Kubernetes manifest, or reverse-proxy configuration exists anywhere in the repository.
- **Environment**: `.env.example` documents every variable; `src/config/production-config.validation.ts` (pre-existing, Phase 2D.9/2D.11) fails the process closed at boot for a placeholder/missing/unsafe production value.
- **CI/CD**: no `.github` directory existed before this phase — confirmed absent, not assumed.
- **Observability**: structured NestJS `Logger`; `traceId`/correlation-id generation and propagation into audit records (Phase 2D.9, pre-existing); `IdentityMetrics` (`src/common/metrics/`) — an in-process, vendor-neutral counter/duration seam, pre-existing, no exporter wired.
- **Prior production-readiness work found during this phase's own inspection** (not previously visible in this engagement's own working context): `docs/PRODUCTION_READINESS.md`, `docs/RESILIENCE_AND_FAILURE_MODEL.md`, `docs/SECURITY_OPERATIONS_RUNBOOK.md`, and `database/scripts/backup-restore-validate.sh` already existed from an earlier "Phase 2D.11" pass, already covering: production config validation, live RLS verification, health/live vs. health/ready, `enableShutdownHooks()`, a real backup/restore drill, a real (partial) performance baseline, and rate-limit single-instance documentation. This phase extends and re-verifies that work rather than duplicating it — see each section below for exactly what was reused vs. newly built.

## 4. Changes Implemented

| File | Change |
|---|---|
| `Dockerfile` (new) | Multi-stage production image |
| `.dockerignore` (new) | Excludes `.git`, `node_modules`, `dist`, `.env*`, `apps/web`, docs from the build context |
| `.github/workflows/ci.yml` (new) | CI pipeline (backend, backend-e2e, backend-audit, frontend, frontend-audit, docker-build jobs) |
| `src/config/security-headers.config.ts` (new) | Extracted, testable helmet configuration |
| `src/main.ts` (modified) | Wires `helmet(securityHeadersOptions())` into the real bootstrap |
| `tests/phase3-1-security-headers.e2e-spec.ts` (new) | 6 tests — the only spec exercising `main.ts`'s real CORS+Swagger+helmet stack together |
| `package.json` / `package-lock.json` (modified) | Adds `helmet` as a production dependency |
| `docs/TLS_AND_REVERSE_PROXY_RUNBOOK.md` (new) | Architecture-neutral TLS/proxy requirements; surfaces the `trust proxy` gap |
| `docs/RELEASE_CHECKLIST.md` (new) | Structured pre-release gate |
| `docs/SECURITY_OPERATIONS_RUNBOOK.md` (extended) | Deployment/rollback sequence, outage playbooks |
| `docs/RESILIENCE_AND_FAILURE_MODEL.md` (extended) | Extended performance baseline, updated deployment-baseline block |

No business logic, authorization rule, RLS policy, or existing test was modified or weakened.

## 5. Docker / Containerization

**Dockerfile**: multi-stage (`deps` → `build` → `runtime`), base image `node:22-slim` (Debian/glibc). **Why not Alpine**: `argon2` and `@prisma/client` are both native-binary dependencies; this schema declares no `binaryTargets`, so Prisma's engine binary defaults to whatever platform/libc ran `prisma generate`. Alpine's musl libc would require a schema change (adding a musl `binaryTarget`) this phase has no mandate to make without dedicated testing — Debian/glibc avoids the question entirely, and every stage uses the same base image family so no binary crosses a stage boundary with a libc mismatch.

**Build result**: `docker build -t identity-platform-backend:phase3-1-test -f Dockerfile .` — **PASS** (verified live this phase; content size 301MB, disk usage 1.22GB). First build attempt failed mid-way due to an unrelated host disk-space exhaustion incident (see §18); a clean rebuild after that was resolved succeeded without any Dockerfile change.

**Runtime result**: container started, connected to the real `docker-compose` Postgres over the `identity-platform_default` Docker network — **PASS**, evidence:
```
GET /health/live  -> 200 {"status":"ok",...}
GET /health/ready -> 200 {"status":"ready","database":"up",...}
POST /auth/login (bad creds) -> 401 {"statusCode":401,"message":"Invalid credentials"}  (not 500)
```

**Non-root verification**: `docker exec identity-backend-smoke whoami` → `identity` — **PASS**.

**Healthcheck**: `HEALTHCHECK ... CMD curl -f http://127.0.0.1:4000/health/live` — container reported `Up ... (healthy)` in `docker ps` — **PASS**.

**Smoke test**: full sequence (build → start → live → ready → real API request → graceful stop) executed end to end this phase — **PASS**, not claimed from a local test as a production deployment (see §18's NOT VERIFIED list for what remains environment-dependent).

## 6. CI/CD

`.github/workflows/ci.yml` — 6 jobs: `backend` (typecheck/build/unit), `backend-e2e` (disposable `postgres:16-alpine` service, schema build + seed + e2e), `backend-audit` (non-blocking `npm audit`), `frontend` (typecheck/lint/build/vitest), `frontend-audit` (non-blocking), `docker-build` (build + smoke test against a disposable Postgres service, including a graceful-shutdown check).

**Limitation, stated plainly**: this pipeline was **not executed on a real GitHub Actions runner** — this session has no access to trigger or observe one. Every command it invokes was verified independently, locally, in this same session (the exact `npm run typecheck`/`build`/`test`/`test:e2e`/`web:*` commands, the exact `docker build`/`docker run` sequence, the exact `db:build-schema`/`db:seed` scripts against a disposable database). The workflow YAML itself was reviewed for correctness but its actual execution on GitHub's infrastructure is **NOT VERIFIED**.

## 7. Environment & Secret Hardening

Reused, not duplicated: `src/config/production-config.validation.ts` (pre-existing) already fails production boot closed for: placeholder/missing `JWT_ACCESS_SECRET` or one under 32 characters, missing `OAUTH_ISSUER` or the example placeholder, missing `OAUTH_PRIVATE_KEY`, missing `DATABASE_URL` or one still containing the example `changeme` password, and missing/wildcard `CORS_ALLOWED_ORIGINS`. Re-confirmed still passing this phase (`production-config.validation.spec.ts`, part of the 277 unit tests).

`TRAVELOS_DATABASE_URL` — re-inspected this phase specifically per this task's own instruction. Grepped `src/` again: **zero consumers**, confirmed still dead. **Not removed** — the instruction was explicit that removal requires confirming no legitimate consumer exists, and while none was found, removing a documented `.env.example` entry is a decision with no urgency and no security benefit; left as-is, flagged again rather than acted on unilaterally.

New this phase: `helmet` (production dependency) — no other new environment variable introduced; `securityHeadersOptions()` takes no configuration input, deliberately (a static, reviewed default, not something an operator needs to tune per environment).

Classification of every environment variable in `.env.example`:

| Variable | Class |
|---|---|
| `DATABASE_URL` | Required production secret+config |
| `JWT_ACCESS_SECRET` | Required production secret |
| `OAUTH_PRIVATE_KEY` | Required production secret |
| `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_KEY_ID`, `OAUTH_JWKS_URI` | Required production configuration |
| `CORS_ALLOWED_ORIGINS` | Required production configuration |
| `APP_NAME`, `APP_ENV`, `PORT` | Required configuration (any environment) |
| `JWT_ACCESS_TOKEN_TTL`, `JWT_REFRESH_TOKEN_TTL(_SHORT)`, `PASSWORD_RESET_TOKEN_TTL_HOURS`, `USER_INVITATION_TOKEN_TTL_HOURS`, `PLATFORM_ACCESS_TOKEN_TTL`, `PLATFORM_REFRESH_TOKEN_TTL` | Optional (documented, validated-if-set) configuration |
| `OAUTH_RETIRED_PUBLIC_KEYS` | Optional production configuration (key-rotation overlap) |
| `OAUTH_JWKS_MIN_REFRESH_INTERVAL_MS`, `OAUTH_CLOCK_SKEW_SECONDS`, `OAUTH_AUTHORIZATION_CODE_TTL_SECONDS`, every `*_RATE_LIMIT_*` var (including this phase's 4 new ones) | Optional configuration, validated-if-set, some upper-bounded |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `WEB_APP_BASE_URL` | Required configuration (any environment with real email delivery) |
| `TRAVELOS_DATABASE_URL` | **Dead** — zero consumers, re-confirmed this phase, not removed (see above) |

## 8. Database Backup & Recovery

**Repository capability** (pre-existing, `database/scripts/backup-restore-validate.sh`): `pg_dump` as `identity_owner` → restore into a disposable database → verify exact row-count match on 9 security-critical tables → verify RLS survives restore → drop the disposable database.

**Re-run live this phase** against the real running database:
```
==> PASS: row counts match exactly on every checked table.
```
RLS confirmed present on all 3 spot-checked tables (`membership`, `oauth_authorization_code`, `tenant_product_entitlement`) in the restored copy. One harmless, previously-documented warning reproduced exactly as before (`pg_restore: ... unrecognized configuration parameter "transaction_timeout"` — a client/server version-skew artifact, one `SET` statement, zero data loss).

**Production operational configuration** — NOT repository-managed, **OPERATIONAL GAP**: backup frequency, retention, storage location, encryption at rest, access control to backups, and automated scheduling are all deployment-environment decisions this repository has no opinion about and cannot verify. `docs/SECURITY_OPERATIONS_RUNBOOK.md` §3 states the procedure to use; it does not and cannot mandate a schedule.

## 9. TLS / Reverse Proxy

**ENVIRONMENT DEPENDENT** — this application never terminates TLS itself (confirmed: no certificate/key-loading code anywhere in `src/`) and no reverse-proxy technology is referenced anywhere in the repository. `docs/TLS_AND_REVERSE_PROXY_RUNBOOK.md` (new this phase) states the required behavior architecture-neutrally. One concrete, actionable finding: `app.set('trust proxy', ...)` is never called — not exploitable in this environment (no proxy sits in front of it here) but required before any real deployment behind one, or Phase 2D.9/Phase 3's own IP-keyed rate-limit and lockout-adjacent audit records collapse onto the proxy's IP.

## 10. Graceful Shutdown

**Implementation**: `app.enableShutdownHooks()` (pre-existing, `src/main.ts`) + `PrismaService.onModuleDestroy()` (pre-existing) — the framework-supported NestJS lifecycle-hook mechanism, no custom signal-handling code.

**Evidence — live process-level test performed this phase** (not merely read from source): started the production Docker container, confirmed serving traffic, then `docker stop --time 10`:
```
stop took 921 ms
Status=exited ExitCode=0 OOMKilled=false
```
Exited cleanly, well within the grace period, exit code 0, no forced kill. This is real SIGTERM-path evidence via the container runtime, not a source-code inference.

**Limitation**: a raw `kill -TERM <pid>` against the bare Node process (outside any container) was not additionally performed — the Docker-level test above already exercises the same signal delivery path Docker/any container orchestrator would use in production, judged sufficient evidence for this phase.

## 11. Rate Limiting

**Endpoints** (Phase 2D.9 pre-existing: `oauth_authorize`, `oauth_token`, `oidc_userinfo`; Phase 3 added: `auth_login`, `platform_auth_login`, `password_reset` — shared by forgot+reset, `invitation` — shared by validate+accept). **Behavior**: fixed-window counter, IP-hashed key (no `client_id` concept for the Phase 3 routes), 429 with `Retry-After` past the limit, recovers after the window — all 7 Phase 3 e2e tests re-confirmed passing this phase.

**Store**: `InMemoryRateLimitStore` — explicitly documented (pre-existing, re-confirmed this phase) as **single-process only**. **Horizontal-scaling implication**: with N replicas behind a load balancer, the effective cluster-wide limit becomes `configured limit × N`, not the configured limit, since each instance counts independently. No Redis or other shared store was introduced this phase — not currently justified (single-instance deployment, no evidence a multi-instance rollout is imminent) and explicitly out of this phase's "do not introduce Redis merely for architectural fashion" instruction. **Migration trigger, documented**: the moment horizontal scaling is adopted, a distributed `RateLimitStore` implementation bound to the same `RATE_LIMIT_STORE` DI token must be supplied first.

## 12. Security Headers

**Implementation**: `helmet(securityHeadersOptions())`, `contentSecurityPolicy: false` (Swagger UI at `/api/docs` uses inline assets a default CSP would break; no other CSP-exploitable HTML surface exists on this JSON API). Every other helmet default left unmodified.

**Tests**: `tests/phase3-1-security-headers.e2e-spec.ts`, 6/6 passing — asserts `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Frame-Options: SAMEORIGIN`, absent `Content-Security-Policy`, absent `X-Powered-By`, headers present uniformly across the versioned API/`health`/`.well-known` routes, CORS still functions, and Swagger UI still renders (200, contains `swagger-ui`).

**Live confirmation** against the real Docker container (not just the Jest harness):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-Permitted-Cross-Domain-Policies: none
X-XSS-Protection: 0
```
No `Content-Security-Policy` header present (as intended); `x-trace-id` (pre-existing correlation-id middleware) unaffected.

## 13. Observability

**Logs**: structured NestJS `Logger`, confirmed free of secrets (pre-existing review, re-confirmed by this phase's own source reading — no new log statement added touches a credential/token/secret).
**Correlation IDs**: pre-existing `traceId`/`x-trace-id` propagation into responses and audit records, confirmed present on live container responses this phase.
**Metrics**: `IdentityMetrics` (`src/common/metrics/`) — pre-existing, in-process counters/durations, no exporter wired; this phase added no new metric (no new business logic was added to instrument).
**Health/Readiness**: pre-existing `/health/live` (no I/O) / `/health/ready` (DB-dependent, 503 on failure) split — re-confirmed live via both the Jest e2e harness and the real Docker container this phase.

## 14. Performance

**Methodology**: unchanged from the pre-existing pass (`docs/RESILIENCE_AND_FAILURE_MODEL.md` §3) — a small Node `http`-module script, no external dependency, concurrency 20, 200 requests per endpoint, against the built application run standalone against the real local Postgres.

**New this phase** (the specific endpoints this task's own brief prioritized that the prior pass had explicitly left unmeasured):

| Endpoint | Throughput | p50 | p95 | p99 | max | Errors |
|---|---|---|---|---|---|---|
| `GET /auth/me` | 55 req/s | 331.8ms | 499.1ms | 524.1ms | 552.6ms | 0/200 |
| `GET /users?limit=20` | 61 req/s | 300.6ms | 456.6ms | 472.4ms | 483.7ms | 0/200 |
| `GET /organizations?limit=20` | 94 req/s | 185.1ms | 334.2ms | 362.6ms | 373.5ms | 0/200 |
| `POST /auth/login` | 29 req/s | 660.4ms | 787.5ms | 859.3ms | 942.8ms | 0/200 |

Zero errors across all 800 requests. `/auth/login`'s latency is dominated by Argon2id password verification — deliberately expensive by design, not a query/index defect. `/auth/me`'s ~300ms p50 under 20-way concurrency on this development machine (Prisma's default, untuned connection-pool sizing) is the only soft signal — worth re-measuring once `connection_limit`/`pool_timeout` are explicitly set (a pre-existing, still-undischarged documented gap, not introduced by this phase). No index/query-plan defect was identified by inspection; no query or index was changed.

**Still not measured** (documented, not overclaimed, unchanged from the prior pass): `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`, and a full resource-authorization request under load — each requires a pre-provisioned Application/ServiceAccount/Tenant fixture and, for `/authorize`, a real authenticated session; judged lower priority than the Docker/CI/security-hardening deliverables within this phase's own effort budget.

**This is a baseline on one development machine, not a production capacity certification.**

## 15. Dependency Audit

Backend (`npm audit --omit=dev`), unchanged from the Phase 3 review (no new vulnerability introduced by this phase's one new dependency, `helmet` — `npm audit` confirms 0 additional findings from it):

| Package | Severity | Affected | Exploitability in this app | Remediation |
|---|---|---|---|---|
| `lodash` (via `@nestjs/config`) | High | prototype pollution / code injection in `_.template`/`_.unset`/`_.omit` | Not called directly by this app's own code; pulled in transitively | Requires `@nestjs/config` major bump → NestJS v11+; not performed this phase |
| `multer` (via `@nestjs/platform-express`) | High | multiple DoS vectors | **Unreachable** — grep-confirmed zero `FileInterceptor`/file-upload code anywhere in `src/` | Requires `@nestjs/platform-express` major bump → NestJS v11+; not performed this phase |
| `qs` (via `body-parser`/`express`) | Moderate | DoS in `qs.stringify` under specific crafted input | This app never serializes attacker-influenced data via `qs.stringify`; it's an inbound parser here | Same major-bump dependency chain; `npm audit fix` (non-force) confirmed no independently-resolvable version exists |

**Frontend**: `npm audit --omit=dev` — 0 vulnerabilities.

**No major upgrade performed** — per this phase's explicit instruction not to blindly upgrade NestJS. Target: NestJS v11 (or later, whatever resolves all three chains) with a dedicated upgrade plan and full regression re-run, tracked separately from this hardening pass.

## 16. Security Regression

| Area | Result | Evidence |
|---|---|---|
| Authentication | PASS | `tests/phase3-auth-hardening.e2e-spec.ts` (7/7, re-run this phase); lockout + rate limiting both re-confirmed live |
| Authorization | PASS | Existing `PermissionsGuard`/`PlatformPermissionsGuard` suites unchanged, re-run, all green |
| Tenant Isolation | PASS | `tests/phase2d-tenant-registry-security.e2e-spec.ts` (10/10, re-run); live RLS re-verified via direct `psql` as `identity_app` this phase |
| Platform Isolation | PASS | Same suite — tenant token → `/platform/*` = 401, re-confirmed |
| IDOR | PASS | Same suite; no new resource/endpoint added this phase to introduce a new IDOR surface |
| OAuth/OIDC | PASS | `tests/phase2d7-*`/`phase2d9-*` (unchanged, re-run, all green) |
| Invitation Security | PASS | Rate limiting added and tested this phase (Phase 3, re-confirmed); single-use `claim()` unchanged |
| Secrets | PASS | No new secret-touching code added this phase; `helmet` config contains no secret material; live container logs inspected — no OAUTH_PRIVATE_KEY/JWT_ACCESS_SECRET/DATABASE_URL value ever printed |
| Rate Limiting | PASS | §11 above |
| Lockout | PASS | Re-run this phase, unchanged since Phase 3 |
| RLS | PASS | Re-verified live this phase (fail-closed on `organization`/`membership` with no context; `security_event`'s PLATFORM/TENANT split intact — 0 cross-tenant rows visible) |

## 17. Test Results

```
Backend Unit:
Before: 277/277
After:  277/277

Backend E2E:
Before: 335/335
After:  348/348  (335 + 7 Phase 3 auth-hardening + 6 Phase 3.1 security-headers)

Frontend:
Before: 194/194
After:  194/194  (unchanged — no frontend code touched this phase; re-run once after an unrelated, transient local Docker/disk-space incident during this session, to confirm it was unaffected)
```

## 18. NOT VERIFIED

- **Real production TLS termination** — no TLS-terminating layer exists in this repository's own infrastructure to test against; `docs/TLS_AND_REVERSE_PROXY_RUNBOOK.md` states required behavior, not a tested configuration.
- **Real cloud/managed backup storage, retention, and encryption at rest** — the backup/restore *procedure* was verified live (§8); the operational schedule, storage location, and access control around it are deployment-environment decisions with nothing in this repository to execute against.
- **Multi-instance/Redis-backed rate limiting** — no multi-instance deployment exists to test against; the single-instance behavior was verified, the distributed case is a documented migration trigger, not a built-and-tested feature.
- **Real production-scale load/capacity** — §14's numbers are a single-developer-machine baseline (200 requests, concurrency 20), not a load test against production-equivalent hardware/data volume/network topology.
- **GitHub Actions execution of `.github/workflows/ci.yml`** — this session has no access to trigger or observe a real Actions run; the workflow was reviewed command-by-command against locally-verified equivalents, not executed on GitHub's own infrastructure.
- **A real container-orchestrator SIGTERM/rolling-deployment cycle** (e.g., a real Kubernetes pod eviction) — the Docker-level `docker stop` test (§10) exercises the same signal-delivery mechanism any orchestrator uses, but a real orchestrator's own grace-period/drain behavior was not separately exercised.
- **Production key rotation drill** — the documented procedure (`docs/SECURITY_OPERATIONS_RUNBOOK.md` §2, pre-existing) was not re-executed live this phase; no code path for it changed, so this is carried forward as previously documented, not re-verified.
- **A disk-full / host-resource-exhaustion failure mode for the application itself** — this phase's own session encountered a real host disk-space exhaustion incident (§ below) affecting Docker's daemon; the *application's own* behavior under a full disk (e.g., can Postgres itself still accept writes, does the app degrade predictably) was not deliberately tested — the incident was resolved by freeing host disk space, not analyzed as a designed failure-mode test.

**Incidental infrastructure note**: during this phase's own work, the host machine's `C:` drive reached 0 bytes free, crashing Docker Desktop's daemon mid-build. This was a pre-existing host condition unrelated to this repository's own disk usage (this project's combined `node_modules`+`dist` total ~620MB; Docker's own WSL virtual disk was ~12GB) — resolved by the user freeing host disk space, after which the Docker build, container smoke test, e2e suite, RLS re-verification, and backup/restore drill were all completed successfully and are reported above with real evidence. Flagged here for transparency, not as a finding against this codebase.

## Remaining Backend Gaps

```
SESSION_MANAGE remains a backend capability gap — a seeded, tenant-grantable
permission checked by zero endpoints (re-confirmed via grep this phase, no
change since Phase 2E/3). No frontend or backend work performed for it.
```

## Deferred Capabilities

```
Developer Portal          — backend capability does not exist
Signing Key Management UI — backend exposes protocol infrastructure only
MFA / Passkeys / SSO      — backend capability does not exist
NestJS major upgrade      — target v11+; documented plan (§15), not performed this phase
```

None built, started, or modified this phase, per the No Over-Implementation rule.

## Findings

```
ID: OPS-01
Severity: LOW
Area: Reverse proxy / rate-limit correctness
Description: `app.set('trust proxy', ...)` is never called in main.ts.
Impact: In a production deployment behind any reverse proxy/load balancer,
  req.ip (used to key every rate-limit policy and login-attempt audit
  record) would resolve to the proxy's own address rather than the real
  client's, collapsing every distinct client into one shared bucket.
Recommendation: Set `app.set('trust proxy', ...)` to the correct hop
  count/IP range for the actual deployment's proxy topology before going
  to production behind one. Not fixed this phase — the correct value is
  deployment-topology-specific and guessing at it risks either no effect
  or, worse, trusting an attacker-spoofable header if set incorrectly.
Status: Documented (docs/TLS_AND_REVERSE_PROXY_RUNBOOK.md), not fixed.
Release Blocking: NO for the current (no-proxy) deployment; YES-before-
  going-live behind any reverse proxy.
```

```
ID: OPS-02
Severity: LOW
Area: Database performance
Description: No `connection_limit`/`pool_timeout`/`statement_timeout` set
  on DATABASE_URL; Prisma's own defaults apply. /auth/me's ~300ms p50
  under 20-way concurrency (§14) is a soft signal, not a confirmed defect.
Impact: A slow query could hold a pool slot indefinitely with no timeout;
  pool sizing is untuned for production load.
Recommendation: Set explicit connection_limit/pool_timeout/
  statement_timeout via DATABASE_URL query parameters before a production
  load test; already documented as a gap in docs/PRODUCTION_READINESS.md
  §K/L (pre-existing, re-surfaced here with fresh evidence).
Status: Documented, not fixed (no code change — this is operator
  configuration, not an application defect).
Release Blocking: NO
```

```
ID: OPS-03
Severity: INFORMATIONAL
Area: Dependency security
Description: 12 pre-existing backend advisories (lodash/multer/qs, all
  requiring a NestJS major bump) — carried forward unchanged from Phase 3;
  re-confirmed this phase that `npm audit fix` (non-force) resolves none
  of them independently.
Impact: multer's chain is confirmed unreachable (no upload code exists);
  lodash/qs are transitive, not directly invoked by this app's own code
  in an attacker-reachable way.
Recommendation: Plan a dedicated NestJS v11+ upgrade with full regression.
Status: Documented, tracked, not performed.
Release Blocking: NO
```

## Production Blockers

### Security Blockers
NONE.

### Deployment Blockers
NONE — a production `Dockerfile` and CI pipeline now exist and were verified locally (build, run, health, non-root, graceful shutdown). The one remaining item (`.github/workflows/ci.yml` never executed on a real runner) is a verification gap, not a known-broken pipeline.

### Operational Blockers
NONE that are release-blocking. Two OPERATIONAL GAPs remain, both requiring a decision/action at actual deployment time rather than a code change: (1) `trust proxy` configuration must be set correctly before deploying behind any reverse proxy (OPS-01); (2) production backup scheduling/retention/storage/encryption is environment-dependent and not repository-manageable (§8).

## Final Production Readiness Decision

**PASS WITH FINDINGS**

Evidence basis: a production Docker image now builds, runs non-root, passes a live health/readiness/real-API-request/graceful-shutdown smoke test connected to a real Postgres instance; a CI pipeline now exists covering every quality gate this repository already enforces locally (typecheck, build, unit, e2e against a disposable database, frontend equivalent, dependency audit, Docker build+smoke-test) — reviewed line-by-line though not executed on GitHub's own infrastructure; HTTP security headers are live-verified with Swagger UI compatibility confirmed, not assumed; the pre-existing backup/restore procedure and live RLS enforcement were both re-run against the real database this phase with identical, correct results; a real (if partial) performance baseline now covers the specific business endpoints this phase's brief prioritized, with zero errors across 800 additional requests; and every finding from this pass is either fixed (none required a code fix beyond what's listed under Changes Implemented) or explicitly documented with a clear, non-blocking severity and an honest NOT VERIFIED / OPERATIONAL GAP classification for what this repository genuinely cannot verify on its own (real TLS, real cloud backup infrastructure, real multi-instance scale, real GitHub Actions execution, real production-scale load). No security boundary was touched, weakened, or newly introduced as a risk this phase — every change is additive operational infrastructure on top of a security posture already established and re-confirmed, not altered.
