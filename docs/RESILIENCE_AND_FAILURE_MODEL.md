# Resilience and Failure Model

Phase 2D.11 — dependency-failure behavior, concurrency, load-test methodology/results, and the deployment baseline.

## 1. Dependency failure matrix

| Dependency | Failure mode | Behavior | Verified |
|---|---|---|---|
| PostgreSQL | Down/unreachable | `GET /health/ready` → 503; `GET /health/live` still 200 (process itself is fine); any request needing the DB fails per-request (e.g. an unhandled rejection → 500) — never a silent wrong answer | New this phase (health split); DB-dependent request failure mode unchanged from every prior phase |
| PostgreSQL | Slow (not down) | No statement_timeout enforced by default — a slow query can hold a connection/pool slot indefinitely. **Documented, not built this phase** — operators must set `statement_timeout` via `DATABASE_URL` (`.env.example`, Phase 2D.11) | Documented gap, not simulated (would require an artificial slow-query injection this phase's scope does not call for) |
| JWKS endpoint (external resource server's own dependency) | Temporary outage | An already-cached key continues to verify tokens; an unresolvable (never-seen) `kid` during the outage fails closed, never guessed | Unchanged, re-confirmed against Phase 2D.9's own 10-point checklist |
| Configuration | Malformed/unsafe at boot | Process refuses to start at all (`validateProductionConfig`, before any module is instantiated) | Directly tested — 20 cases, `production-config.validation.spec.ts` |
| Rate-limit store | In-process store, single instance | Correct within one instance; a multi-instance deployment sharing NO state means each instance enforces its OWN limit independently — the EFFECTIVE cluster-wide limit is (per-instance limit × instance count), not a shared one, until a distributed `RateLimitStore` is supplied | Documented (Phase 2D.9), re-stated here as a live production requirement, not silently pretended to be cluster-safe |
| Metrics backend | None connected | `IdentityMetrics` accumulates in-process only; a process restart loses all counters | Unchanged, documented (Phase 2D.9) |

**Security priority**: every dependency failure above either fails closed (configuration, JWKS-unknown-kid) or fails in a way that cannot itself grant unauthorized access (an unreachable database means requests fail, not that they succeed without authorization). No dependency failure mode was found that degrades into an authentication or authorization bypass.

## 2. Concurrency / race validation

| Scenario | Convergence | Mechanism |
|---|---|---|
| Authorization-code redemption | Deterministic — exactly one redemption succeeds | Atomic conditional `UPDATE` (`AuthorizationCodesRepository.tryConsume`, Phase 2D.7), unchanged |
| ServiceAccountTenantGrant / TenantProductEntitlement status transitions | Deterministic | Conditional `UPDATE` with an explicit `fromStatuses` allow-list (Phase 2B.2/2D.3), unchanged |
| Tenant creation (same `tenantCode`) | **Fixed this phase** — previously a genuine race (check-then-insert); now deterministic | `TenantsService.create()` P2002 catch → 409 (new, Phase 2D.11) |
| Product creation (same `slug`) | **Fixed this phase**, same class of race | `ProductsService.create()` P2002 catch → 409 (new, Phase 2D.11) |
| User creation (same brand-new email) | **Fixed this phase**, same class of race | `UsersService.createInternal()` P2002 catch → the same `IAM_EMAIL_ALREADY_REGISTERED` 409 the duplicate-with-password branch already used (new, Phase 2D.11) |
| Rate-limit burst | Deterministic within one instance | Fixed-window counter, `InMemoryRateLimitStore` (Phase 2D.9), unchanged |
| Session/organization-context switching | Deterministic | Unchanged, Phase 2C's own existing suite |

All three fixes are proven by direct concurrency tests (`Promise.allSettled` against the real service, `tests/phase2d11-production-readiness.e2e-spec.ts`) — not merely reasoned about.

## 3. Performance / load validation

**Methodology**: the built application (`dist/src/main.js`, `npm run build`) run standalone against the real local PostgreSQL instance; a small Node script (`http` module, no external dependency) fires a fixed concurrency of requests and measures wall-clock latency per request via `process.hrtime.bigint()`. Concurrency 20, 200 requests per endpoint. Environment: this development machine (Windows, local PostgreSQL 17 client / PostgreSQL 16 server per `docker-compose.yml`), default `DATABASE_URL` (no explicit `connection_limit` set — Prisma's own default pool sizing applied).

| Endpoint | Concurrency | Requests | Throughput | p50 | p95 | p99 | max | Errors |
|---|---|---|---|---|---|---|---|---|
| `GET /health/live` (no I/O) | 20 | 200 | 1515 req/s | 9.9ms | 18.8ms | 21.9ms | 36.7ms | 0 |
| `GET /health/ready` (1 DB round-trip) | 20 | 200 | 990 req/s | 19.2ms | 28.8ms | 35.6ms | 36.7ms | 0 |
| `GET /.well-known/jwks.json` (in-memory key cache) | 20 | 200 | 1198 req/s | 16.6ms | 19.8ms | 21.2ms | 21.3ms | 0 |

Zero errors across all 600 requests. `/health/ready`'s added ~9-10ms p50 latency over `/health/live` is consistent with one round-trip to a local database — not itself a bottleneck signal on this hardware.

**Phase 3.1 — extended to the authenticated/business endpoints this phase's own brief prioritized** (same methodology, same script class, same dev machine/database; a real DEV-tenant session token, `identity_app` runtime role):

| Endpoint | Concurrency | Requests | Throughput | p50 | p95 | p99 | max | Errors |
|---|---|---|---|---|---|---|---|---|
| `GET /auth/me` | 20 | 200 | 55 req/s | 331.8ms | 499.1ms | 524.1ms | 552.6ms | 0 |
| `GET /users?limit=20` | 20 | 200 | 61 req/s | 300.6ms | 456.6ms | 472.4ms | 483.7ms | 0 |
| `GET /organizations?limit=20` | 20 | 200 | 94 req/s | 185.1ms | 334.2ms | 362.6ms | 373.5ms | 0 |
| `POST /auth/login` | 20 | 200 | 29 req/s | 660.4ms | 787.5ms | 859.3ms | 942.8ms | 0 |

Zero errors across all 800 additional requests (1400 total across both passes). `/auth/login`'s latency is dominated by Argon2id verification — deliberately expensive by design (password hashing must resist offline brute force), not a query/index problem; this is expected and matches the shape every credential check in this class of system should have. `/auth/me`'s ~300ms p50 under 20-way concurrency on this modest dev machine (not Prisma's default connection-pool size tuned for load) is the closest thing to a soft signal in this pass — worth re-measuring once Prisma's `connection_limit`/`pool_timeout` are explicitly set (§K/L above; still undischarged) rather than left at their defaults, but no index/query-plan issue was identified by inspection.

**Still not measured** (documented limitation, not overclaimed — unchanged from the prior pass): `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`, and a full resource-authorization request under load — each requires a pre-provisioned Application/ServiceAccount/Tenant fixture and, for `/authorize`, a real authenticated session; building that fixture harness for a load-generator (rather than a correctness test) remains lower priority than the security-hardening work covered elsewhere in Phase 3/3.1. A future load-test pass should extend the same script (`perf-baseline.js`-class, no new dependency) against those endpoints using the fixture-creation helpers already established in `tests/phase2d4-*`/`tests/phase2d6-*`.

**No premature optimization performed** — these numbers are a baseline, not a target; nothing in this phase changed a hot path's implementation for speed.

## 4. Backup / restore

See `docs/PRODUCTION_READINESS.md` §X/Y and `database/scripts/backup-restore-validate.sh` — validated end to end this phase (dump as `identity_owner`, restore into a disposable database, exact row-count match on 9 tables, RLS survives restore, disposable database dropped).

## 5. Deployment baseline

```text
Runtime:              Node.js (this repo built/tested against the Node version already installed; no engines pin exists yet — a documented gap, not a defect)
Framework:            NestJS (package.json pins exact versions)
Database:             PostgreSQL 16 (docker-compose.yml; PostgreSQL 17 client tools used for backup/restore in this phase — client/server version skew produced one harmless
                       "unrecognized configuration parameter: transaction_timeout" warning during pg_restore, non-fatal, documented)
Required env vars:    DATABASE_URL, JWT_ACCESS_SECRET, OAUTH_ISSUER, OAUTH_PRIVATE_KEY (production), CORS_ALLOWED_ORIGINS (production) — all fail-closed via
                       validateProductionConfig if missing/malformed in production
Signing key:          RS256 private key required in production (OAUTH_PRIVATE_KEY); ephemeral auto-generated key permitted ONLY outside production
JWKS exposure:        GET /.well-known/jwks.json — public keys only, verified (docs/OAUTH_OPERATIONAL_HARDENING.md §8)
TLS:                  Not terminated by this application — expected to sit behind a TLS-terminating proxy/load balancer in production (not built or assumed otherwise)
Rate limiting:        In-process by default — a multi-instance deployment MUST supply a distributed RateLimitStore (§1 above)
Database role:        Application connects ONLY as identity_app (NOBYPASSRLS, verified live); migrations/seeds/backups run as identity_owner
Health/readiness:     GET /health/live (liveness), GET /health/ready (readiness) — new this phase
Shutdown:             app.enableShutdownHooks() + PrismaService.onModuleDestroy() — unchanged, clean disconnect on SIGTERM/SIGINT
Backup:               database/scripts/backup-restore-validate.sh — run as identity_owner, never identity_app
Monitoring:           No metrics/log/trace exporter wired — IdentityMetrics (Phase 2D.9) is the vendor-neutral seam; wiring a real backend is a deployment-time integration, not built here
Containerization:     Phase 3.1 — Dockerfile added (multi-stage, node:22-slim/glibc, non-root, HEALTHCHECK on /health/live). Built and smoke-tested live this
                       phase: container starts, connects to the real Postgres, GET /health/live and /health/ready both 200, non-root confirmed
                       (`docker exec ... whoami` -> identity), a real API request behaves correctly, and `docker stop` exits cleanly (code 0) in <1s.
CI/CD:                Phase 3.1 — .github/workflows/ci.yml added (previously absent entirely). Backend typecheck/build/unit/e2e (disposable Postgres
                       service), frontend typecheck/lint/build/test, dependency audits (non-blocking), and a Docker build+smoke-test job. Repository
                       artifact only — not executed on a real GitHub Actions runner this session (no such access); reviewed line-by-line against every
                       command it invokes, all of which are pre-existing, already-working local scripts.
Security headers:     Phase 3.1 — helmet added (`src/config/security-headers.config.ts`), CSP deliberately off (Swagger UI at /api/docs uses inline
                       assets that would break under helmet's default CSP; this API has no other HTML surface to protect with one). Every other helmet
                       default (nosniff, frame-ancestors, no-referrer, HSTS, X-Powered-By removal) verified live via `tests/phase3-1-security-headers.e2e-spec.ts`
                       and against the real Docker container's own response headers.
Reverse proxy:        Phase 3.1 — `app.set('trust proxy', ...)` is NOT yet called anywhere in main.ts. Not exploitable today (no proxy sits in front of
                       this app in development/CI), but a real production deployment behind any reverse proxy MUST set this or every rate-limit/lockout
                       control (§1 above, and Phase 3's login/password-reset/invitation policies) keys on the proxy's own IP instead of the real client's.
                       See docs/TLS_AND_REVERSE_PROXY_RUNBOOK.md.
```

No cloud provider is assumed or hard-coded anywhere in this document or the codebase.
