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

**Not measured this pass** (documented limitation, not overclaimed): `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`, and a full resource-authorization request under load — each requires a pre-provisioned Application/ServiceAccount/Tenant fixture and, for `/authorize`, a real authenticated session; building that fixture harness for a load-generator (rather than a correctness test) was judged lower priority than the dependency-failure and concurrency-race work above within this phase's own effort budget. A future load-test pass should extend this same script against those endpoints using the fixture-creation helpers already established in `tests/phase2d4-*`/`tests/phase2d6-*`.

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
Containerization:     docker-compose.yml provisions ONLY the local-development PostgreSQL container — no application Dockerfile exists yet (a genuine, documented gap; building
                       one is new deliverable work, judged out of this phase's validate-the-existing-system scope)
```

No cloud provider is assumed or hard-coded anywhere in this document or the codebase.
