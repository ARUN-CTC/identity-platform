# Identity Source Inventory

**Phase:** 1 — Project Isolation & Source Extraction
**Source system inspected:** TravelOS (`E:\wrkspc\travelOS\TravelPlatform\travelos`), read-only
**Method:** Direct inspection of `apps/backend/src/modules/{security,organization}`, `apps/backend/src/common`, `apps/backend/src/database`, and `packages/database/{domains,prisma/schema}`. No TravelOS file was modified, moved, or deleted to produce this inventory.

Every component below is classified as exactly one of:

- **A. REUSABLE** — generic identity functionality, copied into this platform with only mechanical adjustments (import paths, package name).
- **B. REFACTOR REQUIRED** — reusable in principle, currently coupled to TravelOS naming/data in a way that needs deliberate rework before it's genuinely product-agnostic. Not deeply refactored in Phase 1 — see `TRAVELOS_COUPLING.md`.
- **C. TRAVELOS ONLY** — travel-business-specific. Not copied.
- **D. UNKNOWN** — purpose not confidently determined from inspection alone. Not copied; flagged for a follow-up decision.

---

## A. REUSABLE

### Authentication (`apps/backend/src/modules/security/authentication`, `.../jwt`)

| Component | TravelOS path | Notes |
|---|---|---|
| Login/logout, refresh, password change/forgot/reset, organization-context switch | `authentication/controllers/authentication.controller.ts`, `authentication/services/authentication.service.ts` | Generic session lifecycle; the "organization-context switch" endpoint is IAM-generic (any product with an org hierarchy needs it) |
| JWT issuance/parsing, refresh-token hashing/rotation, invitation/reset token self-identifying format | `jwt/services/token.service.ts` | Token format encodes tenant id in cleartext + a hashed secret — a deliberate, reusable pattern for pre-auth flows (password reset, invitations) |
| Refresh token storage, password-reset token storage | `jwt/repositories/refresh-tokens.repository.ts`, `.../password-reset-tokens.repository.ts` | Pure persistence, no travel logic |
| `JwtAuthGuard`, `PermissionsGuard` | `authentication/guards/*.ts` | Generic; `PermissionsGuard` reads permission codes from a decorator + resolves via `UserRolesService`, no product coupling |
| DTOs: login, refresh, change/forgot/reset password, org-context switch | `authentication/dto/*.ts` | Generic |
| `/auth/me` shape | `authentication/entities/me.entity.ts` | Generic |

### Sessions (`.../sessions`)

| Component | Notes |
|---|---|
| Session CRUD/revocation, device info, "remember me" | Fully generic — a session belongs to a user, optionally scoped to an organization context |

### User Management (`.../users`)

| Component | Notes |
|---|---|
| `SecurityUser` entity/model, lifecycle (PROVISIONED → ACTIVE ↔ SUSPENDED → DEACTIVATED) | Generic account lifecycle |
| `UsersService`/`UsersRepository`/`UsersController` (CRUD, activate/suspend/deactivate, resend-invitation) | Generic |
| `UserRolesService`/`UserRolesRepository` (role grant/revoke, org-scoped grants, **grant-ceiling check** — a caller can only grant a role carrying permissions they themselves hold) | The grant-ceiling check is a genuinely valuable, reusable security primitive |

### Invitations (`.../users/invitations`)

| Component | Notes |
|---|---|
| `UserInvitationsService`, invitation token repository, accept/validate/resend flow, resend cooldown | Fully generic admin-invites-user flow; no travel coupling found |

### Authorization / RBAC (`.../roles`, `.../permissions`, `.../authorization`)

| Component | Notes |
|---|---|
| `SecurityRole`/`SecurityPermission`/`SecurityRolePermission`/`SecurityUserRole` models | Generic RBAC core |
| `RolesService`/`PermissionsService`/`RolePermissionsService` | Generic CRUD + the same grant-ceiling delegation rule |
| `RequirePermissions`/`RequireRoles` decorators | Generic |
| `OrganizationAccessService` (`authorization/services/organization-access.service.ts`) | Generic "does this caller's grant set cover this specific organization" check — reusable for any org-scoped write |

### Audit (`.../security-audit`)

| Component | Notes |
|---|---|
| `SecurityEvent`, `SecurityLoginAttempt` models, `SecurityEventsService` (write), `SecurityAuditQueryService` (read), `AuditController` | Generic security/administrative event log — event `type`/`metadata` are free-form strings/JSON, no travel coupling |

### Organization / Tenant (`.../organization`, `packages/database/domains/platform` Tenant tables)

| Component | Notes |
|---|---|
| `Tenant` (slimmed — see `TRAVELOS_COUPLING.md`) | The SaaS-customer-level entity every product signs up under. Copied in a **trimmed** form (see below) — TravelOS's own `Tenant` model has ~20 back-relations into product-specific domains (documents, foundation, notifications, etc.) that do not belong in a reusable platform. |
| `Organization`, `OrganizationType` | Generic "a tenant has one or more organizations" concept |
| `OrganizationUnit`, `OrganizationUnitType`, `OrganizationUnitHierarchy` (closure table) | Generic internal hierarchy (branch/department/team — the type is data-driven, not hardcoded) |

### Infrastructure (`apps/backend/src/common`, `.../database`, `packages/database/shared`)

| Component | Notes |
|---|---|
| `RequestContextService` + CLS store (`common/context`) | Generic per-request tenant/user/org context, backend of the multi-tenancy model |
| `PrismaService`/`PrismaContextService` (`database/`) | Generic Prisma wrapper that sets the RLS session GUCs before each unit of work |
| `JwtAuthGuard`/`PermissionsGuard`/`TenantStatusGuard` interplay | Generic layered authorization |
| `RequirePermissions`/`RequireRoles`/`Public`/`ResponseMessage`/`SkipTenantStatusCheck` decorators | Generic |
| `AppException`/`AllExceptionsFilter`/`ResponseInterceptor` (uniform envelope + error shape) | Generic |
| `password.util.ts` (hashing), `mask.util.ts` | Generic |
| PostgreSQL Row-Level Security pattern (`packages/database/shared/policies/001_row_level_security.sql`, `002_apply_tenant_rls_nullable.sql`) | **The single most valuable reusable architectural asset in TravelOS** — `current_tenant_id()`/`current_user_id()` session GUCs + `apply_tenant_rls(table)` procedure. Product-agnostic by construction; copied near-verbatim. |
| Audit + soft-delete triggers (`packages/database/shared/triggers/001_audit.sql`, `002_soft_delete.sql`, `003_apply_standard_triggers.sql`) | Generic `created_by`/`updated_by`/`deleted_by`/`version` bookkeeping, driven by the same `app.current_user_id` GUC |
| UUID/common SQL functions (`packages/database/shared/functions/001_uuid.sql`, `002_common_functions.sql`) | Generic |

---

## B. REFACTOR REQUIRED

| Component | Coupling | Phase 1 disposition |
|---|---|---|
| Seeded system roles (`SUPER_ADMIN`/`TENANT_ADMIN`/`AGENT`) | `AGENT` is TravelOS's own operational-tier naming, not a generic identity concept | Copied as **`SUPER_ADMIN`/`TENANT_ADMIN`/`MEMBER`** — see coupling report. The RBAC *mechanism* is reusable; the three seeded role *names* are a TravelOS product decision, replaced with product-neutral defaults. |
| Permission catalog seed (`packages/database/domains/security/seeds/001_permissions.sql` + per-domain grants across many files) | The full catalog spans dozens of TravelOS-domain-specific codes (`TRAVEL_*`, `WHATSAPP_*`, `FOUNDATION_*`, etc.) accumulated across the whole product | Copied only the domain-agnostic subset: `TENANT_MANAGE`, `USER_VIEW`/`USER_MANAGE`, `ROLE_VIEW`/`ROLE_MANAGE`, `PERMISSION_VIEW`, `ORGANIZATION_MANAGE`, `SESSION_MANAGE`, `SECURITY_AUDIT_VIEW`. Every `TRAVEL_*`/`WHATSAPP_*`/`FOUNDATION_*`/`EMAIL_*`/`DOCUMENT_MANAGE`/`BANK_ACCOUNT_MANAGE`/`TENANT_BRANDING_MANAGE`/`TENANT_BUSINESS_DEFAULTS_MANAGE` code is TravelOS/product-specific and excluded. |
| `Organization` model's `currencyId`/`languageId`/`timezoneId` FKs | Depend on TravelOS's Foundation reference-data domain (Countries/Currencies/Languages/Timezones), not extracted in Phase 1 | Fields dropped from the copied model. Re-add only if/when a Foundation-equivalent module is deliberately added to this platform. |
| `OrganizationUnit`'s `costCenterId`/`workingHours`/`holidayCalendarAssignments` relations | Depend on Cost Center / Fiscal Year / Holiday Calendar / Working Hours domains — travel-operations scheduling/finance concerns, not identity | Fields/relations dropped from the copied model. |
| Bootstrap admin/superadmin seed emails (`003_bootstrap_admin_user.sql`, `004_bootstrap_superadmin_user.sql`) | Hardcode a specific developer's real email address for local dev bootstrap | Rewritten with placeholder `admin@example.com`-style addresses and placeholder passwords, documented as dev-only |

---

## C. TRAVELOS ONLY — not copied

Booking, Ticketing, Itinerary, Hotel, Flight, Supplier, Travel Inventory, Travel Accounting, Travel Operations, Customers, Inquiries, Quotations, Payments, Travelers, WhatsApp/Email communication channels, Document management (R2/storage), Foundation reference data (Countries/Currencies/Languages/Timezones/Lookups), Gamification, Reports, Subscription Plans/Tenant Features/Configuration/Integration/TenantDomain (platform billing/product-config, not identity), Cost Centers, Fiscal Years, Holiday Calendars, Working Hours, Organization Sequences (travel-operations scheduling/finance, layered on top of Organization but not identity-core).

---

## D. UNKNOWN

| Component | Why unknown |
|---|---|
| `security/oauth/oauth.module.ts` | Present as an empty/stub module in TravelOS with no providers or controllers wired in `security.module.ts` beyond the bare module registration. Cannot confidently determine intended scope (OAuth client? OIDC provider? third-party login?) from inspection alone. **Not copied.** Flagged for a Phase 2 product decision rather than guessed at. |
| `security/policies/policies.module.ts` | Same — an empty stub module, no services/controllers. Likely a placeholder for a future policy-engine that was never built. **Not copied.** |

---

## Summary Count

| Classification | Count (top-level components) |
|---|---|
| A. Reusable | 24 |
| B. Refactor Required | 5 |
| C. TravelOS Only (excluded) | ~20 domains |
| D. Unknown (excluded) | 2 |
