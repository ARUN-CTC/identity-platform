# Architecture (Phase 1 baseline)

This is a deliberately minimal architecture document — Phase 1 is scoped to isolation and extraction, not to designing the platform's eventual full architecture. See `docs/PHASE_1.md` for what Phase 2 should design properly.

## Stack

- **Runtime**: Node.js, NestJS (Express adapter)
- **Database**: PostgreSQL 16, accessed via Prisma (client generation only — schema/migrations are hand-written SQL, not `prisma migrate`)
- **Auth**: Signed JWT access tokens (`@nestjs/jwt`) + opaque, hash-only-persisted refresh tokens; Argon2id password hashing
- **Multi-tenancy**: PostgreSQL Row-Level Security, driven by `app.current_tenant_id` / `app.current_user_id` session variables set per-transaction

## Request lifecycle

1. `ClsMiddleware` (nestjs-cls) opens an async-local-storage context for the request.
2. `JwtAuthGuard` (global) validates the bearer token (skipped for `@Public()` routes), checks the session hasn't been revoked, and populates `RequestContextService` (tenantId/userId/sessionId).
3. `TenantStatusGuard` (global) blocks suspended/cancelled tenants (skipped via `@SkipTenantStatusCheck()`).
4. `PermissionsGuard` (global) enforces `@RequirePermissions(...)`/`@RequireRoles(...)` by resolving the caller's grants fresh on every request (never cached).
5. The controller/service/repository chain runs. Any repository touching an RLS-protected table goes through `PrismaContextService.runInContext()`, which opens a transaction and sets the Postgres session GUCs before the query runs.
6. `ResponseInterceptor` wraps every success response in a uniform envelope; `AllExceptionsFilter` does the same for errors.

## Domain boundary (Phase 1 scope)

| Domain | Contents |
|---|---|
| Tenant | `Tenant` — the SaaS-customer boundary |
| Organization | `OrganizationType`, `Organization`, `OrganizationUnitType`, `OrganizationUnit`, `OrganizationUnitHierarchy` (schema present; unit/hierarchy CRUD deferred to Phase 2) |
| Identity | `SecurityUser`, `SecurityRole`, `SecurityPermission`, `SecurityRolePermission`, `SecurityUserRole` |
| Sessions/Tokens | `SecuritySession`, `SecurityRefreshToken`, `SecurityPasswordResetToken`, `SecurityUserInvitationToken` |
| Audit | `SecurityLoginAttempt`, `SecurityEvent` |

## What Phase 1 deliberately does not include

SAML/OIDC/OAuth authorization server, Passkeys/WebAuthn, a policy/rules engine, organization-context switching (a signed-in user acting "as" a specific organization mid-session), multi-region or production-HA deployment, Kubernetes manifests, advanced identity federation. See `docs/PHASE_1.md`'s Phase 2 recommendations for what to design next, deliberately, rather than accreting ad hoc.
