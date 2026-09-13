# Production Readiness

Phase 2D.11 — validates, and where genuinely necessary fixes, the Identity Platform's readiness to serve as shared production identity infrastructure for TravelOS/Healthcare/Gym/future products. This is a validation document first — every ✅ below was verified directly (source review, a real database query, or a real, reproducible test), not assumed from a prior phase's own report.

## A. Configuration

`src/config/production-config.validation.ts` (Phase 2D.9, extended this phase), wired into `ConfigModule.forRoot({validate})` — runs before any module is instantiated.

| Check | Environment | Behavior |
|---|---|---|
| Every numeric OAuth/rate-limit/legacy-session env var (`NUMERIC_ENV_VARS`) | Any | Malformed or ≤0 → **FAIL CLOSED** |
| `OAUTH_CLOCK_SKEW_SECONDS` > 300s | Any | **FAIL CLOSED** (new, Phase 2D.11 — an excessive tolerance weakens temporal validation) |
| `OAUTH_AUTHORIZATION_CODE_TTL_SECONDS` > 600s | Any | **FAIL CLOSED** (new, Phase 2D.11) |
| `OAUTH_ISSUER` missing/placeholder | Production | **FAIL CLOSED** (Phase 2D.9) |
| `OAUTH_PRIVATE_KEY` missing | Production | **FAIL CLOSED** (Phase 2D.9; `SigningKeyService` itself also checks, defense in depth) |
| `JWT_ACCESS_SECRET` missing/placeholder/<32 chars | Production | **FAIL CLOSED** (new, Phase 2D.11 — previously UNCHECKED; a missing value surfaced only as a cryptic runtime `jsonwebtoken` error on the first login attempt, not a boot-time failure) |
| `DATABASE_URL` missing/still the example `changeme` password | Production | **FAIL CLOSED** (new, Phase 2D.11) |
| `CORS_ALLOWED_ORIGINS` missing or `*` | Production | **FAIL CLOSED** (new, Phase 2D.11 — see §CORS below) |

No secret value ever appears in a thrown `InvalidProductionConfigurationError` message — every check reports only what's wrong (missing / placeholder / too short / contains a known substring), never the value itself.

**Not yet identified as needing a hard check**: request-size limits (already bounded via `@MaxLength`, Phase 2D.9 — no separate env var to validate); `ACCESS_TOKEN_TTL`/`ID_TOKEN_TTL` (these are computed from existing, already-validated numeric vars, not separate env vars in this codebase).

## B. Cryptography

Re-verified, zero code changes needed (already correct since Phase 2D.1/2D.5/2D.9):
- Legacy path: HS256 only, algorithm pinned at verification (`algorithms:['HS256']`).
- External path: RS256 only, `kid` mandatory, unknown `kid` fails closed, `alg=none`/unexpected algorithm rejected before any signature check runs.
- Private key never reachable from the resource-server validation path (`JwksClientService` has no import of `SigningKeyService` — a structural, not conventional, guarantee, `docs/RESOURCE_SERVER_ARCHITECTURE.md` §2).
- Issuer, audience, and temporal (`exp`/`nbf`) validation are mandatory on every external token verification, never defaulted.
- Key rotation: manual, documented runbook (`docs/OAUTH_OPERATIONAL_HARDENING.md` §8) — unchanged, still the correct posture (no coordinated multi-instance automatic rotation mechanism exists to safely automate).

## C. Authentication

All seven authentication paths (legacy human, Authorization Code + PKCE, OIDC, Client Credentials, resource-server bearer, ServiceAccount, Platform Operator) are exercised end-to-end by the existing regression suite (`tests/phase2a-*` through `tests/phase2d9-*`), unmodified by this phase. No path falls back to another trust model — confirmed by source review of every guard (`JwtAuthGuard`, `ExternalBearerAuthGuard`, `PlatformJwtAuthGuard` each check exactly one algorithm/key source, never try-both).

## D. Authorization chain

Re-verified end to end (Principal → Tenant → Organization → Entitlement → Scope → Product authorization) — every layer's fail-closed behavior is exercised by `tests/phase2d6-resource-authorization.e2e-spec.ts` and `tests/phase2d10-product-integration-contract.e2e-spec.ts` (the latter closing the `REVOKED`-entitlement and `DISABLED`-product gaps the former didn't cover, Phase 2D.10).

## E. Tenant isolation (PostgreSQL RLS)

Verified directly against the real, running database (not merely read from a migration file):

```sql
-- identity_app (the ONLY role the running application connects as):
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname='identity_app';
--  identity_app | f     (NOBYPASSRLS, confirmed)

-- RLS enabled AND FORCED on every checked tenant-scoped table:
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class ...
--  membership, oauth_authorization_code, security_session,
--  security_user_role, service_account_tenant_grant,
--  tenant_product_entitlement  →  all (t, t)
```

`identity_owner` (schema owner, migrations/seeds/backup only) remains superuser/BYPASSRLS — never the role the running application connects as (`docs/PROJECT_ISOLATION.md`, unchanged).

## F. Organization context

Phase 2C's behavior (same-tenant switch, cross-tenant switch rejected, stale membership/organization handling) is unchanged and re-verified by its own existing, unmodified suite (`tests/phase2c-organization-context.e2e-spec.ts`, `tests/phase2c-stabilization.e2e-spec.ts`). JWT claims remain non-authoritative by themselves — server-side membership/tenant state is what every check actually queries.

## G. Product entitlement

`ProductAccessService.canAccess()` (Phase 2B.2) — product-status and entitlement-status are independently checked, product status takes precedence. All five states (`ACTIVE`+`ACTIVE`, `ACTIVE`+`SUSPENDED`, `ACTIVE`+`REVOKED`, `DISABLED`+`ACTIVE`, missing) are now exercised across `tests/phase2b2-*` and the new `tests/phase2d10-*`/`tests/phase2d11-*` (the latter's own P2002-race tests additionally prove disabling a product never mutates an existing `TenantProductEntitlement` row — only `Product.status` itself changes).

## H. Service accounts

`Application → ServiceAccount → ServiceAccountTenantGrant → Tenant → TenantProductEntitlement → Product` — every wrong-app/wrong-credential/missing-grant/suspended-grant/revoked-grant/cross-tenant scenario is covered by the existing, unmodified `tests/phase2d3-*`/`tests/phase2d4-*`/`tests/phase2d6-*` suites.

## I. OAuth/OIDC

Full protocol regression (Authorization Code + PKCE, OIDC, Client Credentials) re-run this phase with zero protocol change — see §Tests. `token_use`/`principal_type` discrimination (Phase 2D.7/2D.8) unmodified.

## J. Resource server

Bearer extraction, JWKS resolution, signature/issuer/audience/temporal/claim validation — unmodified since Phase 2D.5/2D.9. JWKS outage behavior (§N) unmodified.

## K/L. Database reliability

- **Connection pool / statement timeout**: not enforced in application code — Prisma reads both from `DATABASE_URL`'s own query parameters (`connection_limit`, `pool_timeout`, `statement_timeout`), documented in `.env.example` this phase. No apply-at-connect code exists to validate these are actually set — a genuine, documented **Medium** operational gap (an operator who forgets to set them gets Prisma/pg's own unbounded defaults), not silently pretended to be handled.
- **P2002 (unique-constraint) race handling** — a known earlier issue, reviewed this phase (brief §22): `AllExceptionsFilter` (`src/common/filters/`) has its own P2002→409 mapping but is **NOT, and must NOT be, globally registered** — doing so would re-wrap every OAuth/resource-server `HttpException` (`OAuthTokenError`, `ResourceServerAuthError`, `RateLimitExceededException`) into this platform's generic `{success,message,data,errors,...}` envelope, breaking the frozen RFC 6749/6750 wire contract those classes' own doc comments explicitly rely on. **Decision: keep the existing local-catch-per-service pattern, never register the filter globally.** Three genuine gaps in that pattern were found and fixed this phase: `TenantsService.create()`, `ProductsService.create()`, and `UsersService.createInternal()` each had a check-then-insert race (two concurrent requests for the same code/slug/email could both pass the pre-check) that previously surfaced the loser as an unhandled 500 — now caught and converted to the same 409 the pre-check already promised. Verified by new concurrency tests (`tests/phase2d11-production-readiness.e2e-spec.ts`).
- **Migration safety**: unchanged — every phase's migration remains additive-only, already verified pre/post-migration in its own phase report.
- **Concurrency**: authorization-code redemption (Phase 2D.7, atomic `UPDATE`), entitlement/grant state transitions (Phase 2B.2/2D.3, conditional `UPDATE`), and the new Tenant/Product/User creation races (above) all converge deterministically — no security or data-integrity invariant depends on application-level race avoidance alone.

## M. Rate limiting

Unchanged from Phase 2D.9. `InMemoryRateLimitStore` is explicitly documented as single-instance-only (`docs/OAUTH_OPERATIONAL_HARDENING.md` §1) — a multi-instance production deployment MUST supply its own `RateLimitStore` behind the same DI token (Redis or equivalent); this is a real, undischarged production requirement, not silently pretended to be cluster-safe.

## N. JWKS resilience

Unchanged, re-confirmed against the 10-point checklist (Phase 2D.9): cached key survives a JWKS outage; an unknown `kid` during an outage fails closed (never guessed); refresh is cooldown-bounded and in-flight-deduplicated.

## O. Logging / P. Metrics / Q. Audit

Unchanged from Phase 2D.9 — no secret/token/code/nonce/password/private-key is ever logged (verified by source review of every `Logger` call site touched this phase — `HealthController`, the three P2002-catch sites, `main.ts` — none log request bodies or credentials). `IdentityMetrics` remains label-free by construction.

## R. Health / readiness

**Fixed this phase** (a genuine, real gap): the single `GET /health` conflated liveness and readiness, and depended on the database — meaning an orchestrator using it as a liveness probe could restart a healthy PROCESS merely because the database was temporarily slow/unreachable (brief §20's own explicit warning). Now:
- `GET /health/live` — no I/O, always `{status:'ok'}` if the process can respond at all.
- `GET /health/ready` — database-dependent, returns `503` (not a 200-with-a-degraded-body) when unreachable.
- `GET /health` — kept, unchanged, for backward compatibility with the existing monitor/test that already polls it.

Neither new endpoint exposes anything beyond up/down.

## S. Startup / shutdown

`app.enableShutdownHooks()` (unchanged, Phase 1) — `PrismaService.onModuleDestroy()` disconnects cleanly on SIGTERM/SIGINT. Production cryptographic configuration validation (§A) now runs at `ConfigModule` load — before ANY module, including the HTTP listener, is instantiated — so a bad production config never accepts a single request.

## T. Error handling

400/401/403/404/409/429/500/503 semantics reviewed — all already consistent (`ResourceServerAuthError`/`OAuthTokenError`/`AppException` families each pin their own status per code). See §K/L above for the P2002/409 finding and fix.

## U/V/W. Dependency failure, performance, concurrency

See `docs/RESILIENCE_AND_FAILURE_MODEL.md` for the full dependency-failure matrix and load-test methodology/results.

## X/Y. Disaster recovery, backup/restore

**Performed a real, safe validation this phase** (not merely documented): `pg_dump` as `identity_owner` (the elevated, RLS-bypass-via-ownership role) → restore into a disposable `identity_platform_db_restore_test` database → verified exact row-count match on 9 security-critical tables → verified RLS survives restore → dropped the disposable database. Scripted, reproducible: `database/scripts/backup-restore-validate.sh`.

**Genuine finding**: `identity_app` (the runtime role) **cannot** `pg_dump` the database at all — RLS blocks it from reading rows outside whatever single tenant context happens to be set (or none). This is correct, expected behavior given its `NOBYPASSRLS` posture, not a defect — but it means backup tooling MUST run as `identity_owner` (or an equivalent schema-owner/BYPASSRLS role), documented explicitly so an operator doesn't waste time debugging an RLS error mid-incident.

## Z. Deployment

No application Dockerfile exists yet — `docker-compose.yml` provisions only the local-development PostgreSQL container. Documented as a known gap (`docs/RESILIENCE_AND_FAILURE_MODEL.md` §Deployment baseline) rather than built this phase (building a production container image is a genuinely new deliverable, not a validation of the existing one — out of this phase's own "validate, fix only if required" scope).

## Tests

```text
Unit:        266/266 PASS (256 pre-existing + 10 new: cors.config.spec.ts, production-config additions)
E2E:         325/325 PASS (318 pre-existing + 7 new: tests/phase2d11-production-readiness.e2e-spec.ts)
Security:    embedded in E2E (RLS role check, backup/restore script, P2002-race tests)
Concurrency: 3 new tests (Tenant/Product P2002-race, plus a raw-Prisma race) + all pre-existing concurrency tests unmodified
Backup/Restore: PASS (database/scripts/backup-restore-validate.sh, real run against the dev database, cleaned up)
Build:       PASS (nest build, exit 0)
Typecheck:   PASS (tsc --noEmit, exit 0)
Prisma:      VALID; zero diff in database/prisma/schema/
```

See `docs/PHASE_2D11.md` for the exact final counts after the full regression re-run.
