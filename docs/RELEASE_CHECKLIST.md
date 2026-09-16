# Release Checklist

Phase 3.1 — a single, structured pre-release gate. Every item cites the
command/evidence that satisfies it; none are aspirational. Run this before
any production deployment, and re-run in full after any change that
touches authentication, authorization, tenant/platform isolation, OAuth,
or deployment configuration.

## Code

- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run build` — `nest build` exits 0, `dist/main.js` exists
- [ ] `npm test` — backend unit suite, 100% pass, exact count recorded
- [ ] `npm run test:e2e` — backend e2e suite (requires a real Postgres — see docker-compose.yml or CI's disposable service), 100% pass, exact count recorded
- [ ] `npm run web:typecheck` — 0 errors
- [ ] `npm run web:lint` — 0 errors (warnings reviewed, not blocking if pre-existing and unrelated)
- [ ] `npm run web:build` — clean production build
- [ ] `npm run web:test` — frontend suite, 100% pass, exact count recorded

## Security

- [ ] Tenant isolation: cross-tenant GET/PATCH/DELETE by UUID substitution denied (`tests/phase2d-tenant-registry-security.e2e-spec.ts`)
- [ ] Platform isolation: a tenant token (any permission, including `TENANT_MANAGE`) gets 401 on every `/platform/*` route (same suite)
- [ ] `TENANT_MANAGE` cannot manage any tenant other than the caller's own (`/tenants/me` has no id parameter to substitute at all)
- [ ] A platform-only permission cannot be granted to a tenant Role (DB trigger `trg_security_role_permission_no_platform_only`)
- [ ] OAuth: PKCE (S256-only, wrong/malformed verifier rejected), exact redirect-URI matching (no wildcard/path-suffix/query-manipulation bypass), authorization-code single-use under concurrency (`tests/phase2d7-authorization-code-pkce.e2e-spec.ts`)
- [ ] Invitation tokens: single-use (atomic `claim()`), rate-limited (`tests/phase3-auth-hardening.e2e-spec.ts`)
- [ ] Authentication: rate limiting on login/password-reset/invitation routes triggers and recovers; per-account lockout after 5 failed attempts, for both tenant and platform-operator login (`tests/phase3-auth-hardening.e2e-spec.ts`)
- [ ] Secrets: password hashes, client secrets (after creation), service-account credentials (after creation), and the private signing key never appear in any API response (source-verified: `sanitize()`/`OneTimeSecretDialog`/`getJwks()` — see `PHASE_3_1_PRODUCTION_OPERATIONAL_READINESS_REPORT.md` §Final Security Review)
- [ ] Audit: `security_event` RLS confirmed live (PLATFORM rows visible without tenant context, TENANT rows never cross tenants) — re-run the direct `psql`-as-`identity_app` check in this report's §9 if schema/RLS policies changed since
- [ ] HTTP security headers present (`tests/phase3-1-security-headers.e2e-spec.ts`) and Swagger UI still renders with them on

## Deployment

- [ ] `docker build -t identity-platform-backend:<tag> -f Dockerfile .` succeeds
- [ ] Container starts, `GET /health/live` responds 200 within the Dockerfile's own `--start-period`
- [ ] Container runs as a non-root user (`docker exec <container> whoami` → `identity`, not `root`)
- [ ] Every required production environment variable is set (`DATABASE_URL`, `JWT_ACCESS_SECRET` ≥32 chars real value, `OAUTH_ISSUER` real value, `OAUTH_PRIVATE_KEY` real PEM, `CORS_ALLOWED_ORIGINS` explicit list, `APP_ENV=production`) — `validateProductionConfig()` refuses to boot otherwise; a boot failure here is the control working, not a bug
- [ ] Database migrations applied (`database/scripts/migrate.sh` against the target database, owner role) before the new application version receives traffic
- [ ] `GET /health/ready` returns 200 against the real production database once migrations are applied
- [ ] TLS termination in front of the container (see `docs/TLS_AND_REVERSE_PROXY_RUNBOOK.md`) — this app never terminates TLS itself
- [ ] Reverse proxy's `trust proxy`-equivalent / forwarded-header trust configured (see the same runbook's own flagged action item — required for Phase 3's rate-limit/lockout controls to key on the real client IP, not the proxy's)
- [ ] Rollback plan confirmed: previous image tag retained and deployable; database migrations for this release are additive-only (no rollback migration needed) — confirm this explicitly for every release, since this repository has no automated down-migration tooling

## Operations

- [ ] `database/scripts/backup-restore-validate.sh` run successfully against the target environment's own database within the release window (not merely "has been run before, at some point")
- [ ] Backup retention/location/access-control documented and current (see `PHASE_3_1_PRODUCTION_OPERATIONAL_READINESS_REPORT.md` §8 for what's repository-managed vs. operational-environment-dependent)
- [ ] Monitoring: `IdentityMetrics` output wired to a real backend, OR explicitly accepted as not-yet-wired for this release (vendor-neutral seam, `src/common/metrics/` — not a blocker on its own, but should be a conscious decision each release, not a silent gap)
- [ ] Structured logs reaching wherever they're expected to (log aggregator, stdout capture, etc.) — this app logs to stdout/stderr only, container-runtime-dependent for anything beyond that
- [ ] Graceful shutdown confirmed for this deployment target specifically (see this report's §10 — verified via `docker stop` in this session; a real orchestrator's own SIGTERM/grace-period behavior should be spot-checked once, per target platform)
- [ ] Rollback procedure rehearsed at least once per deployment target (not merely documented)

## Performance

- [ ] Baseline latency/throughput numbers for this release are not worse than the last recorded baseline by an unexplained margin (`docs/RESILIENCE_AND_FAILURE_MODEL.md` §3 + this report's own extension) — a regression here is a signal to investigate, not an automatic block, since this is a baseline, not an SLO
- [ ] No new N+1 query pattern introduced by this release's own changes (code review, not a tool this repository runs automatically)
- [ ] Database error rate is 0 under the same load-test methodology used for the baseline
