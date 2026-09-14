# TravelOS — Current Identity Inventory (Phase 2E.1)

Read-only discovery findings from `E:\wrkspc\travelOS\TravelPlatform\travelos` (the actual application source — the repository root's `.docx` files and `TravelPlatform/prod-dataset*` are design documents/sample data, not inspected further here). TravelOS is a real, separate npm-workspace monorepo (`apps/{admin,backend,web}`, `packages/{config,database,sdk,shared,ui}`) with its own Git history, independent of Identity Platform. **Baseline commit at time of discovery: `4bec101d02700a5f344f4de1ba77f1927755ebbd`, branch `enhacement/platform-tenant-user`, clean working tree** (`git status --short` empty) — recorded here so §J of the final report can prove it is unchanged.

Every finding below cites the exact file it came from. Where something could not be directly confirmed from source, it is marked **UNKNOWN — requires further investigation**, not assumed.

## 1. Repository shape

```text
travelos/ (npm workspaces: apps/*, packages/*)
├── apps/
│   ├── backend   — NestJS 11 API (the system inspected below)
│   ├── admin     — a separate frontend app
│   └── web       — the main tenant-facing SPA (React, bearer-token client)
├── packages/
│   ├── database  — Prisma schema + raw SQL DDL/migrations/seeds, domain-organized
│   ├── sdk       — shared frontend API client
│   ├── shared, config, ui
```

Backend framework: NestJS `^11.0.0` (Identity Platform: NestJS `^10.4.0` — different major version; irrelevant to integration since they are separate deployed processes with no shared runtime). Prisma: `^5.22.0` client (Identity Platform: `^5.19.0` — likewise irrelevant to interop). Password hashing library: `argon2 ^0.45.1` (Identity Platform: `argon2 ^0.41.1` — see §7, hash format is portable regardless of package version).

## 2. Authentication (brief §5)

| | File | Responsibility |
|---|---|---|
| Login | `apps/backend/src/modules/security/authentication/services/authentication.service.ts` (`login()`) | Resolves `Tenant` by `tenantCode`, then `SecurityUser` by `(tenantId, email)`, verifies Argon2id password, checks `status`/`lockedUntil`, records `SecurityLoginAttempt` + `SecurityEvent`, issues an access+refresh token pair |
| Logout | Same service (`logout()`, not fully read this pass) | Revokes the session/refresh token — see §12 |
| Registration | No self-service registration endpoint found; users are created via `UsersController`/`UserInvitationsService`-style admin-invited flow (mirrors Identity Platform's own Phase 1/2A invitation model) | Admin-invited only |
| Password reset | `ForgotPasswordDto`/`ResetPasswordDto`, `PasswordResetTokensRepository`, `security_password_reset_token` table | Opaque, tenant-prefixed, hash-only-stored token (identical design to Identity Platform's own) |
| Password hashing | `apps/backend/src/common/utils/password.util.ts` | `argon2.hash(plain, {type: argon2.argon2id})` — **default parameters, no custom memoryCost/timeCost/parallelism** — byte-for-byte the same call Identity Platform's own `hashPassword()` makes |
| JWT generation/verification | `apps/backend/src/modules/security/jwt/services/token.service.ts`, `jwt.module.ts` | RS256, own keypair (`JWT_PRIVATE_KEY_BASE64`/`JWT_PUBLIC_KEY_BASE64`), own `iss`/`aud` (`JWT_ISSUER=travelos`, `JWT_AUDIENCE=travelos-api` in `.env.example`) |
| Refresh tokens | Same `TokenService` + `security_refresh_token` table | Opaque (not a JWT), tenant-prefixed, SHA-256-hash-only stored, rotation-chained (`replacedById`/`replaces` self-relation) |
| Sessions | `apps/backend/src/modules/security/sessions/` | `security_session` table — device info, IP, `rememberMe`, `organizationId` context, `expiresAt`/`revokedAt` |
| Authentication guard | `apps/backend/src/modules/security/authentication/guards/jwt-auth.guard.ts` | Verifies the RS256 JWT, attaches request context |
| Authorization guard (RBAC) | `.../guards/permissions.guard.ts` | Re-resolves grants live via `UserRolesService.resolveGrants(tenantId, userId, organizationId)` on every request — **never trusts JWT claims for roles/permissions** (the JWT carries no role/permission claim at all — see §11) |
| Auth controller | `.../authentication/controllers/authentication.controller.ts` | HTTP surface for the above |

## 3. Users (SecurityUser) — brief §6

`packages/database/prisma/schema/security.prisma` model `SecurityUser` (table `security_user`):

```text
id                Uuid, PK
tenantId          Uuid, FK -> Tenant, NOT NULL          ← a TravelOS user IS tenant-scoped by construction
email             String
username          String?
passwordHash      String? (nullable — PROVISIONED users have none yet)
passwordChangedAt DateTime?
firstName / lastName String?
status            String, default 'PROVISIONED'
emailVerifiedAt   DateTime?
failedLoginCount  Int, default 0
lockedUntil       DateTime?
lastLoginAt       DateTime?
createdAt/By, updatedAt/By, deletedAt/By, version (soft-delete + optimistic lock, standard across every table)

@@unique([tenantId, email], map: "uk_security_user_email")   ← EMAIL IS UNIQUE PER TENANT, NOT GLOBALLY
```

**Critical finding**: unlike Identity Platform's `SecurityUser.email` (globally `@unique`, one global Identity spanning tenants via `Membership`), TravelOS's `SecurityUser.email` is unique only **within a tenant**. The same email address can — and, on a real multi-tenant deployment, likely does — exist as multiple, entirely independent `SecurityUser` rows (different `id`, potentially different `passwordHash`) across different tenants. **There is no cross-tenant identity concept in TravelOS today.** See §"Identity mapping" in `docs/TRAVELOS_IDENTITY_MAPPING.md` for the reconciliation this forces.

## 4. Tenants — brief §7

`packages/database/prisma/schema/platform.prisma` model `Tenant` (table `tenant`):

```text
id, tenantCode (unique), tenantName, legalName, businessType, registrationNumber, taxNumber,
email, phone, website, logoUrl, status, activatedAt, suspendedAt, ... (audit columns)
```

Directly analogous in shape to Identity Platform's own `Tenant` (`tenantCode` is even the same field name). Tenant isolation is **both DB-enforced (PostgreSQL RLS) and application-enforced**:

- DB: `packages/database/shared/functions/` provides `apply_tenant_rls(table)`/`apply_tenant_rls_nullable(table)` — the SAME `USING (tenant_id = current_tenant_id()) WITH CHECK (...)` pattern Identity Platform's own `database/shared/002_functions.sql` uses (Identity Platform's own header comment already says this was "copied near-verbatim from TravelOS's shared layer" — confirmed directly by this discovery, not merely asserted).
- DB role: `packages/database/shared/roles/001_app_role.sql` creates the runtime role `NOBYPASSRLS` (confirmed by direct grep) — the same posture as Identity Platform's `identity_app`. **Both systems already share the identical RLS discipline.**
- Application: every repository query runs inside an ambient tenant context (`RequestContextService`-equivalent — same pattern name as Identity Platform's own).

## 5. Organizations — brief §8

TravelOS **does** have an organization concept, but it is a far richer, ERP-style hierarchy than Identity Platform's lightweight `Organization`:

```text
OrganizationType  — customer/supplier/internal classification
Organization      — tenantId FK, organizationTypeId, organizationCode (unique per tenant),
                     legalName, registrationNumber, taxNumber, currency/language/timezone FKs, status
OrganizationUnit / OrganizationUnitType / OrganizationUnitHierarchy — a branch/department hierarchy WITHIN an Organization
HolidayCalendar, FiscalYear, OrganizationSetting, CostCenter, OrganizationSequence — business/finance configuration scoped to an Organization
```

`packages/database/prisma/schema/organization.prisma`. `SecurityUserRole.organizationId` (nullable) is how a role grant is scoped to one Organization within the tenant (or left tenant-wide if null) — **there is no separate `Membership` join table**; a user's tenant affiliation IS the `SecurityUser.tenantId` column itself, and organization-level role scoping is a property of the role GRANT, not a first-class "this user is a member of this org" record. This is architecturally different from Identity Platform's `Membership` (a user CAN belong to multiple organizations within one tenant, each with its own `Membership` row/status) — see the mapping document for how this reconciles.

## 6. Roles — brief §9

`security_role` (table), 3 system role templates (`tenant_id IS NULL`, `is_system=true`), seeded in `packages/database/domains/security/seeds/002_system_roles.sql`:

```text
SUPER_ADMIN   — every permission in the catalog
TENANT_ADMIN  — everything except TENANT_MANAGE (platform-operator-only) and FOUNDATION_MANAGE (platform-owned reference data)
AGENT         — standard operational access
```

Tenants may also define their own custom roles (`security_role.tenantId` non-null path exists in the schema). Role assignment: `SecurityUserRole` (user × role × optional organizationId).

## 7. Permissions — brief §10, the critical classification

`security_permission` (`permission_code`, `resource`, `action`). Two clearly distinguishable groups found by source inspection:

**Group A — identity/platform-administration permissions** (`packages/database/domains/security/seeds/001_permissions.sql`):
```text
USER_VIEW, USER_MANAGE, ROLE_VIEW, ROLE_MANAGE, PERMISSION_VIEW, SESSION_MANAGE,
TENANT_MANAGE, SECURITY_AUDIT_VIEW
```
These map directly onto capability Identity Platform now owns (user/session/tenant lifecycle, role/permission administration, security audit). **Classification: Identity Platform responsibility** — post-migration, these become redundant with Identity Platform's own admin surface (`docs/PLATFORM_OPERATOR_ARCHITECTURE.md`-equivalent) rather than something TravelOS continues to enforce itself.

**Group B — business/organization-domain permissions** (same file, plus every `products/*/seeds/*_permissions.sql` file):
```text
ORGANIZATION_MANAGE, DOCUMENT_MANAGE, BANK_ACCOUNT_MANAGE, TENANT_BRANDING_MANAGE,
TENANT_BUSINESS_DEFAULTS_MANAGE
TRAVEL_BOOKING_{READ,CREATE,UPDATE,DELETE,ASSIGN,CONFIRM,CANCEL,AMEND,FINANCIAL_READ}
TRAVEL_QUOTATION_*, TRAVEL_CUSTOMER_*, TRAVEL_INQUIRY_* (confirmed present; full contents not enumerated this pass)
```
**Classification: TravelOS responsibility (TravelOS IAM), permanently.** `TRAVEL_`-prefixed codes are unambiguous product/business authorization — Phase 2D.6's boundary (Identity Platform must never own booking/quotation/customer permissions) applies exactly as designed. `ORGANIZATION_MANAGE`/`DOCUMENT_MANAGE`/`BANK_ACCOUNT_MANAGE`/tenant-branding/business-defaults are TravelOS's own ERP-style business configuration, not part of Identity Platform's frozen `Organization` contract either (Identity Platform's `Organization` is a lightweight context marker, not an ERP entity with cost centers/fiscal years) — these stay TravelOS-owned regardless of the identity migration.

The JWT itself carries **no role or permission claim at all** (§11) — TravelOS already resolves authorization live, server-side, on every request (`UserRolesService.resolveGrants`), the identical discipline Identity Platform's `ResourceAuthorizationPolicy` seam assumes a product will apply. This is a significant point of ALREADY-COMPATIBLE architecture, not something that needs inventing.

## 8. JWT — brief §11

`apps/backend/src/modules/security/jwt/services/token.service.ts` + `jwt.module.ts`:

```text
Algorithm:   RS256 (own keypair — JWT_PRIVATE_KEY_BASE64 / JWT_PUBLIC_KEY_BASE64, base64-encoded PEM)
Issuer:      JWT_ISSUER, default 'travelos' (.env.example)
Audience:    JWT_AUDIENCE, default 'travelos-api' (.env.example)
Claims:      sub (userId), tenantId, sessionId, email, organizationId? (absent = tenant-wide)
Lifetime:    JWT_ACCESS_TOKEN_TTL, default 900s (15 min) — same default as Identity Platform
No claim for: role, permission, scope — none exist on this token
```

**Gap table vs. Identity Platform V1 Access Token** (`docs/contracts/access-token-claims-v1.schema.json`):

| Claim | TravelOS today | Identity V1 | Migration |
|---|---|---|---|
| Algorithm | RS256, TravelOS's own key | RS256, Identity Platform's own key | Redefine trust anchor — TravelOS must fetch Identity Platform's JWKS instead of using its own embedded public key |
| `iss` | `travelos` (self) | Identity Platform's `OAUTH_ISSUER` | Redefine — TravelOS becomes a validating resource server, not its own issuer, for the migrated flow |
| `aud` | `travelos-api` (self) | An explicit, registered Application audience string | Redefine per `docs/IDENTITY_EXTERNAL_API_CONTRACT.md` §5 — never `*`/wildcard |
| `sub` | `SecurityUser.id` (TravelOS's own, tenant-scoped) | `security_user.id` (Identity Platform's own, global) | Map — see identity mapping doc; NOT the same value space |
| `tenantId` | present | `tenant_id`, required | Map (§ Tenant mapping) |
| `sessionId` | present, TravelOS's own `security_session.id` | Not a V1 access-token claim (`jti` is the closest analog) | TravelOS-local concept; does not carry over 1:1 — see cutover plan |
| `email` | present, directly on the token | NOT a V1 access-token claim (identity claims live in the ID Token/`/userinfo`, scope-gated) | Drop from the access token; TravelOS reads email via `/userinfo` or its own already-cached principal data, never re-embeds it as an access-token claim |
| `organizationId` | present, optional | present, optional, same semantics (server-validated, never client-overridden) | Direct match — same design already |
| `scope` | absent | present, OAuth scopes | New concept for TravelOS to adopt (§27) |
| `role` / `permissions` | absent (correctly — TravelOS resolves these live) | Not Identity Platform's responsibility at all | Remains TravelOS-only, unchanged |
| `client_id` | absent | required | New — TravelOS becomes a registered Application |
| `token_use`/`principal_type` | absent | required | New claims TravelOS's validator must check |

## 9. Sessions — brief §12

`security_session` (device info, IP, `rememberMe`, `organizationId`, `expiresAt`/`revokedAt`/`revokedReason`) + `security_refresh_token` (opaque, SHA-256-hash-only, rotation-chained via `replacedById`/`replaces`). Directly analogous, again, to Identity Platform's own `SecuritySession`/refresh mechanism (same design lineage). No concurrent-session-limit logic found this pass (**UNKNOWN — requires further investigation** if a cap exists).

## 10. Frontend token handling (relevant to cutover/logout design, brief §32)

`apps/web/src/shared/api/session.ts`: tokens are returned in the HTTP response **body**, not an httpOnly cookie (the file's own comment cites `docs/technical-debt/security.md` acknowledging this as known debt). Access token held in memory only; refresh token in `sessionStorage` by default, `localStorage` only when "Remember me" was explicitly chosen at login. **No cookies are used anywhere in the current auth flow** — this is directly compatible with Identity Platform's own bearer-token-only, no-cookie design; no cookie-vs-bearer reconciliation is needed.

## 11. Existing OAuth/OIDC code

`apps/backend/src/modules/security/oauth/oauth.module.ts` is a **completely empty stub** (`imports: [], controllers: [], providers: [], exports: []`). **TravelOS has zero existing OAuth/OIDC implementation today** — there is no legacy OAuth system to migrate away from; the Identity Platform integration is new wiring, not a replacement of a competing implementation.

## 12. Machine/API credentials

`platform.prisma` models `ApiKey`/`Webhook` exist, but source-grepping their actual usage (`apps/backend/src/modules/products/travel/notifications/email/...`) shows they are used for **outbound third-party integration credentials (e.g., email-provider API keys)**, not for authenticating INCOMING machine callers. **TravelOS has no existing ServiceAccount/Application-equivalent concept for incoming requests** — Identity Platform's `Application`/`ServiceAccount`/`ServiceAccountTenantGrant` chain is an entirely new addition for TravelOS, not a replacement.

## 13. Multi-product structure (significant finding)

`apps/backend/src/modules/products/` contains **three** product domains today, not one: `travel/`, `healthcare/`, `fitness/`. Each has its own sub-modules (bookings, customers, quotations, etc. for `travel/`) and — confirmed for `travel/` — its own `TRAVEL_`-prefixed permission catalog. "TravelOS" (the deployable) is really "TravelPlatform" internally, already hosting what Identity Platform's own docs elsewhere call three separate future products (TravelOS/Healthcare/Gym). **This directly affects Product/audience design** (§16 of the architecture document) — see the mapping recommendation there.

## 14. Invitations — brief §34

`security_user_invitation_token` (table), `SecurityUserInvitationToken` model — opaque, tenant-prefixed, hash-only-stored, `emailSent`/`isResend` tracking. Structurally identical to Identity Platform's own invitation-token design (again, shared lineage).

## 15. Audit — brief §35

`security_login_attempt` (identifier/success/failureReason/IP/UA) and `security_event` (actorUserId, eventType, resourceType/Id, metadata JSON, correlationId) — both tenant-scoped, both directly analogous to Identity Platform's own `SecurityLoginAttempt`/`SecurityEvent`. Business events (bookings, quotations, etc.) are **not** in this table — they live in each product domain's own audit trail (**UNKNOWN — requires further investigation**: the exact table name per product domain was not enumerated this pass).

## 16. Database table classification (brief §13)

| Table | Classification | Reason |
|---|---|---|
| `security_user` | **MIGRATE (with reconciliation)** | Becomes Identity Platform `SecurityUser` + `Membership` — see mapping doc for the per-tenant→global-email reconciliation this requires |
| `security_role`, `security_permission`, `security_role_permission`, `security_user_role` | **SPLIT** | Identity/platform-admin subset (§7 Group A) → superseded by Identity Platform's own admin surface; business subset (§7 Group B) → **KEEP in TravelOS**, unchanged |
| `security_session`, `security_refresh_token` | **REPLACE** | Superseded by Identity Platform `SecuritySession`/OAuth token issuance once TravelOS trusts Identity-Platform-issued tokens |
| `security_password_reset_token` | **REPLACE** | Superseded by Identity Platform's own password-reset flow (TravelOS users become Identity Platform users) |
| `security_user_invitation_token` | **REPLACE** | Superseded by Identity Platform's own invitation flow |
| `security_login_attempt`, `security_event` | **KEEP (TravelOS-local), PARTIALLY DUPLICATED** | Login/session/auth events move to Identity Platform's own audit (already the case for anything going through Identity Platform post-cutover); TravelOS keeps recording its own business-event audit trail — see `docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md` §Audit for exactly which event types split which way |
| `tenant` | **MAP (not migrate wholesale)** | TravelOS's own `tenant` table stays — it owns TravelOS-specific fields (subscriptions, features, domains) Identity Platform has no equivalent for; only the TENANT IDENTITY (id/code) needs to reconcile with Identity Platform's own `Tenant` row for the same real-world tenant |
| `organization`, `organization_unit`, and their ERP-adjacent tables (`cost_center`, `fiscal_year`, `holiday_calendar`, ...) | **KEEP (TravelOS-owned)** | Out of Identity Platform's frozen `Organization` contract scope entirely — these are TravelOS business/finance configuration, not identity |
| `api_key`, `webhook` | **KEEP (TravelOS-owned)** | Outbound third-party integration credentials, unrelated to Identity Platform |
| `subscription_plan`, `tenant_subscription`, `feature`, `plan_feature`, `tenant_feature` | **KEEP (TravelOS-owned)** | TravelOS's own billing/feature-flag system — a DIFFERENT layer from `TenantProductEntitlement` (which answers "may this tenant use TravelOS AT ALL," a platform-wide fact); must not be conflated |

## 17. What remains UNKNOWN after this discovery pass

- Exact concurrent-session-limit behavior (if any).
- The full enumerated permission catalog for `healthcare`/`fitness` product domains (only `travel`'s was directly sampled).
- Exact business-event audit table name(s) per product domain.
- Whether any additional (non-`ApiKey`) service-to-service credential mechanism exists elsewhere in the codebase (only a targeted grep was performed, not an exhaustive one).
- Real-world data profile (actual duplicate-email counts across tenants, orphaned-row counts, etc.) — this inventory is a SCHEMA/CODE inventory, not a data profile; `docs/TRAVELOS_IDENTITY_MIGRATION_PLAN.md` §Data Quality names the data-profiling step as a required, not-yet-executed, future activity.

None of the above blocks the architecture decision in `docs/adr/ADR-022-TRAVELOS-IDENTITY-INTEGRATION.md` — each is flagged as a specific, scoped input a later 2E phase must resolve before executing that step.
