# Phase 2B.1 — First-Class Platform Operator

## Objective

Replace `SUPER_ADMIN`-as-platform-administrator (Phase 2B's own documented, temporary stand-in) with a genuine, structurally separate Platform Operator security boundary — see `docs/adr/ADR-010-platform-operator-security-boundary.md`, `docs/PLATFORM_OPERATOR_ARCHITECTURE.md`, `docs/PLATFORM_OPERATOR_AUTHORIZATION.md`, `docs/PLATFORM_OPERATOR_LIFECYCLE.md` for the full design. This document is the phase-completion record: what changed, what was tested, what's deferred.

## Database changes

New tables (`database/ddl/006_platform_operator.sql`): `platform_operator`, `platform_operator_permission`, `platform_operator_session`, `platform_operator_refresh_token` — all platform-level (no `tenant_id`, no RLS). `security_permission` gains `platform_only BOOLEAN`, enforced against `security_role_permission` by a new trigger (`trg_security_role_permission_no_platform_only`). `security_event` gains `scope VARCHAR(20)` (`TENANT`/`PLATFORM`), with a corrected RLS policy allowing a genuine `PLATFORM`-scope NULL-tenant write through the ordinary application connection. A new trigger (`trg_platform_operator_protect_last_active`) enforces the last-active-operator invariant concurrency-safely via `pg_advisory_xact_lock`.

Three new core permissions: `PLATFORM_OPERATOR_VIEW`, `PLATFORM_OPERATOR_MANAGE`, `PLATFORM_SECURITY_VIEW` (`database/seeds/001_permissions.sql`).

## APIs

New: `POST/GET/GET/PATCH /v1/platform/operators`, `POST /v1/platform/operators/:id/permissions`, `DELETE /v1/platform/operators/:id/permissions/:code`, `POST /v1/platform/auth/{login,refresh,logout}`, `GET /v1/platform/auth/me`, `GET /v1/platform/audit-events` — full contract in `docs/PLATFORM_OPERATOR_LIFECYCLE.md`.

**Changed** (breaking, deliberate — see ADR-010): `POST/GET/GET/PATCH /v1/products`, `POST/GET /v1/products/:id/applications`, `GET/PATCH /v1/applications/:id` now require Platform Operator authentication (`PlatformJwtAuthGuard`/`PlatformPermissionsGuard`) — a tenant-scoped `SUPER_ADMIN` token is rejected with 401, not merely denied a permission check. `docs/API_BOUNDARY.md` §7 updated accordingly.

## SUPER_ADMIN migration

`SUPER_ADMIN` remains a legitimate tenant-scoped role (every non-platform-only permission) — not renamed, not deleted. `database/migrations/20260913160000_platform_operator_boundary.sql` (a) strips every `platform_only` permission from every existing tenant-scoped role's grants (chiefly `SUPER_ADMIN`'s original "every permission" seed), and (b) creates a real `platform_operator` row, `ACTIVE`, granted every current `platform_only` permission, for every global Identity that held `SUPER_ADMIN` at migration time — no existing platform administrator loses access. Verified against a genuinely simulated pre-2B.1 database (a real `SUPER_ADMIN` assignment reconstructed by reverting exactly the 2B.1-specific schema additions on a live copy of the dev database, then re-applying the migration) — not merely a fresh-bootstrap check.

## Test coverage

- **`tests/phase2b1-platform-operator.e2e-spec.ts`** — 17 tests: independent security boundaries (3), authentication incl. enumeration-safety and refresh rotation/reuse-detection (4), disabled-operator token/refresh invalidation (1), last-active-operator protection incl. a direct concurrency test (2), grant-ceiling incl. no-existing-identity and duplicate-grant rejection (3), least-privilege authorization (3), platform audit-event attribution (1), and the SUPER_ADMIN-token-rejected migration proof (1).
- **`tests/phase2b-product-registration.e2e-spec.ts`** — updated in place (not left broken): every fixture now authenticates as a Platform Operator; every former "TENANT_ADMIN denied" assertion now expects 401 (rejected outright) rather than 403 (a permission check that no longer runs on these routes) — itself the explicit regression proof of the migration, from the Products/Applications side.
- **`tests/phase2a-membership.e2e-spec.ts`**, **`tests/health.e2e-spec.ts`** — unchanged, still passing (nothing in this phase touches Membership/tenant-session machinery).
- Bootstrap script (`database/scripts/bootstrap-platform-operator.ts`) — manually verified both the create path (zero-operator database) and the idempotent no-op path (an operator already exists).
- Full suite: 42/42 e2e, 3/3 unit, clean `db:reset` bootstrap, clean `typecheck`, clean `build` — all re-verified after every change, most recently against a freshly reset database.

## Known issues

None blocking. Documented, deliberate simplifications:

1. **No brand-new-Identity provisioning for Platform Operator creation** (`docs/PLATFORM_OPERATOR_ARCHITECTURE.md` §5) — the target email must already have an account. Medium: a real operational inconvenience if onboarding a genuinely new person as a platform operator on day one; low risk otherwise.
2. **Two parallel authentication/session stacks now exist** (tenant, platform) — accepted ongoing maintenance surface, not a defect (ADR-010's own "Risks" section).
3. **No `PlatformRole` convenience layer** — every operator's permission set is managed one code at a time. Low: fine at current scale, revisit only if operator onboarding volume ever makes it a real friction point.

## Deferred work (explicitly confirmed out of scope, unchanged from prior phases)

Product Entitlement (`TenantProductSubscription`), Organization Context Switching, OAuth2, OIDC, SAML, MFA, Passkeys, Service Authentication (`ServiceAccount`), SDKs. None of these were touched.

## TravelOS verification

```text
TravelOS files changed: 0
TravelOS dependencies added: 0
TravelOS DB changed: 0
```
