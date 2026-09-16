# Security Operations Runbook

Phase 2D.11 — the operator-facing procedures this platform's own production-readiness review (`docs/PRODUCTION_READINESS.md`, `docs/RESILIENCE_AND_FAILURE_MODEL.md`) points to. Consolidates, rather than duplicates, what earlier phases already documented.

## 1. Secret management boundary

This platform reads every secret from environment variables (`ConfigService`/`process.env`) — no cloud secret-management vendor is hard-coded or required. Operators are expected to inject `DATABASE_URL`, `JWT_ACCESS_SECRET`, `OAUTH_PRIVATE_KEY`, and `CORS_ALLOWED_ORIGINS` via whatever mechanism their deployment platform already provides (a secrets manager, an orchestrator's own secret objects, etc.) — this codebase has no opinion about which one, by design.

**Never appears in logs, audit records, metrics, error responses, or stack traces** (verified by source review this phase, and by every prior phase's own equivalent review): `client_secret`, `service_account_secret`, `JWT_ACCESS_SECRET`, `OAUTH_PRIVATE_KEY`, access tokens, ID tokens, refresh tokens, authorization codes, PKCE verifiers, nonces, passwords. `production-config.validation.ts`'s own error messages report only *that* a value is missing/placeholder/too short — never the value.

**Test output**: unit/e2e test logs DO contain synthetic test secrets (fixture passwords like `Test-Passw0rd!1`, ephemeral dev signing keys) — these are test-only, regenerated per run, and never valid against a real deployment; not a production secret leak.

## 2. Key rotation (RS256 signing key)

Unchanged from Phase 2D.9 (`docs/OAUTH_OPERATIONAL_HARDENING.md` §8) — reproduced here for operational convenience:

1. Generate a new RSA keypair.
2. Add the OLD public key to `OAUTH_RETIRED_PUBLIC_KEYS` (so tokens already signed with it keep verifying through their own natural expiry).
3. Set `OAUTH_PRIVATE_KEY` to the NEW private key; set/derive a new `OAUTH_KEY_ID`.
4. Restart. New tokens sign with the new key; the JWKS endpoint publishes both keys during the overlap window.
5. After every token signed with the old key has naturally expired (≥ the longest-lived token TTL past the rotation), remove the old key from `OAUTH_RETIRED_PUBLIC_KEYS`.

No automatic rotation exists — this remains a deliberate choice (no coordinated multi-instance publication mechanism exists to safely automate it, Phase 2D.9).

## 3. Backup / restore

Run `database/scripts/backup-restore-validate.sh` (Phase 2D.11) periodically as a drill, and use the same `pg_dump`/`pg_restore` invocation pattern (as `identity_owner`, never `identity_app` — RLS blocks the runtime role from dumping cross-tenant data, by design) for real backups. See `docs/PRODUCTION_READINESS.md` §X/Y for the validated procedure and its one-time findings.

**Restore into production**: restore into a NEW database first, verify row counts/RLS (the same checks the script performs), THEN cut the application over to it — never restore in place over a database still receiving traffic.

## 4. Incident response — quick reference

| Symptom | First check | Likely cause |
|---|---|---|
| `GET /health/ready` returning 503 | `GET /health/live` — is the process itself up? | If live is 200: database is unreachable/down. If live is ALSO down: the process itself crashed — check process logs, not the database |
| A burst of `429 temporarily_unavailable` from `/oauth/token`/`/authorize`/`/userinfo` | Is this a single client, or many? (`docs/OAUTH_OPERATIONAL_HARDENING.md`'s rate-limit key is `client_id` + hashed source) | Expected behavior under genuine abuse/misconfigured retry storms; if it's every client platform-wide, the configured limit may be too low for real traffic — see `.env.example`'s rate-limit variables |
| `invalid_token` spike from a resource server | Check `GET /.well-known/jwks.json` is reachable FROM that resource server's own network path | A JWKS fetch failure serving stale/no cached key for a genuinely new `kid` (e.g., right after a rotation, before the resource server's own cache refreshed) |
| A production boot failure citing `InvalidProductionConfigurationError` | Read the message — it names exactly which variable and why (never the value) | Missing/placeholder configuration — see `docs/PRODUCTION_READINESS.md` §A for the full checked list |
| Unexpected 500 on a `POST` endpoint that creates a uniquely-keyed resource (tenant/product/user/application/service-account) | Check for a concurrent duplicate request | Prior to Phase 2D.11, `Tenant`/`Product`/`User` creation had an unhandled race; now fixed. If a NEW such 500 appears elsewhere, the same P2002-catch pattern (`docs/PRODUCTION_READINESS.md` §K/L) should be applied to that service too |

## 5. Rate-limit deployment requirement

Restated from `docs/OAUTH_OPERATIONAL_HARDENING.md` — the shipped `InMemoryRateLimitStore` is single-instance only. A multi-instance production deployment MUST bind a distributed `RateLimitStore` implementation (Redis or equivalent) behind the same `RATE_LIMIT_STORE` DI token before scaling horizontally, or each instance enforces its own independent limit (the effective cluster-wide ceiling becomes `limit × instance count`, not the configured limit).

## 6. Monitoring integration points

`IdentityMetrics` (`src/common/metrics/`) exposes named counters/duration samples in-process only. Recommended production integration (not built, vendor-neutral by design): scrape/export `IdentityMetrics.snapshotCounters()`/`snapshotDurations()` on an interval into whatever metrics backend the deployment already uses; forward structured `Logger` output (already free of secrets, §1) to a log aggregator; correlate via the existing `traceId`/`correlationId` (Phase 2D.9) across logs and any future distributed tracing.

## 7. Deployment (Phase 3.1 — `Dockerfile` added this phase)

**Build**: `docker build -t identity-platform-backend:<tag> -f Dockerfile .` — multi-stage, produces a non-root runtime image (see `Dockerfile`'s own header comment for the base-image rationale: `node:22-slim`/glibc, not Alpine, because of `argon2`/`@prisma/client`'s native binaries).

**Deploy sequence**:
1. Apply database migrations against the target database as the elevated owner role (`database/scripts/migrate.sh`) — BEFORE the new image receives traffic.
2. Start the new container(s) with every required production env var set (`validateProductionConfig()` refuses to boot otherwise — this is the control working, not a failure to work around).
3. Wait for `GET /health/ready` to return 200 against the real database before routing traffic to the new instance.
4. Drain and stop the old instance(s) — `docker stop`/orchestrator-equivalent sends SIGTERM, which `app.enableShutdownHooks()` + `PrismaService.onModuleDestroy()` handle cleanly (verified this phase — see `PHASE_3_1_PRODUCTION_OPERATIONAL_READINESS_REPORT.md` §10).

**Rollback**: redeploy the previous image tag. Every migration in `database/migrations/` to date is additive-only (no destructive rollback migration exists or is needed) — confirm this remains true for each new migration before relying on "redeploy the old image" as a complete rollback; a migration that removes/renames a column the OLD image still reads would break that assumption.

**Reverse proxy / TLS**: see `docs/TLS_AND_REVERSE_PROXY_RUNBOOK.md` — this app never terminates TLS itself, and (flagged this phase) does not yet call `app.set('trust proxy', ...)`, which a production deployment behind any proxy MUST configure or every rate-limit/lockout control keys on the proxy's own IP instead of the real client's.

## 8. Incident response — outage playbooks (Phase 3.1 addendum)

| Incident | Immediate check | Response |
|---|---|---|
| **Authentication outage** (login/refresh failing platform-wide) | `GET /health/ready` — is the database itself the cause? Check for a recent `InvalidProductionConfigurationError` in startup logs (a bad redeploy) | If DB-caused: see Database outage below. If config-caused: roll back to the previous image/config. If neither: check for an exhausted rate-limit/lockout state affecting many accounts simultaneously (unlikely — these are per-IP/per-account, not global) |
| **Database outage** | `GET /health/live` (process itself up?) vs `GET /health/ready` (DB reachable?) | If live=200, ready=503: database is down/unreachable from the app's network path — this is an infrastructure incident, not an application bug; the app itself fails safe (no silent wrong answers, §T of `docs/PRODUCTION_READINESS.md`) |
| **OAuth outage** (`/oauth/token`/`/authorize`/`/userinfo` failing) | Is it EVERY client, or a burst of `429`s from one client/source (§4 of this doc)? Check JWKS reachability (`GET /.well-known/jwks.json`) if external resource servers report `invalid_token` | A platform-wide OAuth outage with the rest of the API healthy points at `SigningKeyService`/JWKS-specific state — check `OAUTH_PRIVATE_KEY`/`OAUTH_KEY_ID` configuration was not altered by the triggering deploy |
| **Elevated 401/403 rate** | Is it concentrated on one tenant/client (misconfiguration on their side) or platform-wide (a real regression)? Check recent deploys for an authorization-guard change | Platform-wide + recent deploy → roll back. Concentrated on one caller → likely their own expired/misconfigured credential, not a platform incident |
| **Elevated 429 rate** | Which policy/route (`auth_login`, `platform_auth_login`, `password_reset`, `invitation`, or the pre-existing OAuth ones)? One source IP or many? | One IP hammering one route: expected behavior, the control working as intended. Many IPs hitting login/password-reset simultaneously: possible credential-stuffing campaign — consider tightening `AUTH_LOGIN_RATE_LIMIT_MAX`/`PASSWORD_RESET_RATE_LIMIT_MAX` temporarily via env var + restart (no code change needed, Phase 3's policies are env-overridable) |
| **Suspicious cross-tenant access pattern** | Check `security_event`/platform audit for the specific tenant/user/resource involved — RLS (verified live, `docs/PRODUCTION_READINESS.md` §E) makes a SUCCESSFUL cross-tenant read structurally impossible from this app's own runtime role, so a report of one should be investigated as either (a) a misread of legitimately-visible PLATFORM-scoped data, or (b) a genuine finding requiring immediate escalation, never dismissed | If (b) is confirmed: treat as a Critical/release-blocking finding per this platform's own severity classification (see the Phase 3 security-hardening report) — this would contradict RLS's own live-verified behavior and requires re-verifying the RLS policies haven't been altered |
| **Audit-event anomaly** (missing events, or events with unexpected `tenantId`/`scope`) | Compare against the audit matrix in the Phase 3 security-hardening report (which security-sensitive operations are expected to produce which event) | A TENANT-scoped event with a NULL `tenant_id`, or vice versa, would violate the `security_event` table's own CHECK/RLS invariant — this should be structurally impossible; treat as Critical if observed |
