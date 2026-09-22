# Tenant Bootstrap

Phase 2UI.2 — the P0 gap Phase 2UI.1's UI/UX architecture review found: `POST /platform/tenants` (unchanged by this phase) creates only the `tenant` row itself. There was, until this phase, no supported way to give that tenant its first Organization or Administrator afterward — both require a *tenant* JWT, which cannot exist until the tenant has a member. A genuine chicken-and-egg gap, verified by reading `TenantsService.create()` directly, not assumed.

## 1. The gap, precisely

```text
POST /platform/tenants  →  Tenant row only. No Organization. No Administrator. No Membership.
                                    │
                                    ▼
        To create an Organization: POST /organizations — requires a TENANT JWT
        To create a User:          POST /users          — requires a TENANT JWT
                                    │
                                    ▼
              No member exists yet → no tenant JWT can ever be issued
                                    │
                                    ▼
        The only place this repository successfully bootstraps a tenant
        today: database/seeds/003_bootstrap_dev_tenant.sql — raw SQL,
        dev-only, never runnable against production.
```

## 2. The API

```text
POST /platform/tenants/:id/bootstrap
```

Nested under the already-created tenant's own id — `POST /platform/tenants` (bare tenant creation) is unchanged; bootstrap fills in everything that endpoint alone cannot. Matches the URL-nesting convention every other tenant-scoped platform sub-resource already uses (`/platform/tenants/:id/product-entitlements`, `/platform/tenants/:id/service-account-grants`).

Authorization: `PLATFORM_TENANT_MANAGE` — the same permission `create()`/`update()`/`activate()`/`suspend()` on `PlatformTenantsController` already require. No new permission code was created.

Request body (`BootstrapTenantDto`) is **flat**, not the nested `{organization:{...}, administrator:{...}}` shape an earlier illustrative draft of this phase used — no other DTO anywhere in this codebase uses `class-transformer`'s `@Type()`/`@ValidateNested()` (confirmed by search), and introducing that pattern for exactly one endpoint would be an unjustified inconsistency:

```json
{
  "organizationName": "Fleet Ops HQ",
  "organizationTypeId": "optional-uuid",
  "organizationCode": "optional-override",
  "administratorEmail": "admin@fleetops.example",
  "administratorFirstName": "Ada",
  "administratorLastName": "Min",
  "productIds": ["optional-uuid-array"]
}
```

Response: the created `tenant`, `organization`, `administrator` (`{id, email, isNewIdentity}` — never a password hash), `membership`, `roleAssigned` (`"TENANT_ADMIN"`), `entitlements[]`, and `invitationSent: boolean`.

## 3. Transaction boundary — what "atomic" means here, exactly

One real Postgres transaction (`this.prisma.$transaction(...)`, not the ordinary per-repository `PrismaContextService.runInContext()` every other write in this codebase uses individually) covers: reading back the Tenant, resolving/creating the OrganizationType, creating the Organization, finding-or-creating the global SecurityUser, creating the Membership, resolving the `TENANT_ADMIN` system role and creating the `SecurityUserRole` grant, creating every requested `TenantProductEntitlement`, and writing the `TENANT_BOOTSTRAP_COMPLETED` audit event. Any failure anywhere in that sequence rolls back everything — no partial Tenant-without-Organization, Organization-without-Administrator, or Administrator-without-Membership state is possible.

**Why not reuse `OrganizationsRepository`/`UsersService`/`MembershipsService`/`UserRolesService` directly?** Every one of them reads `RequestContextService.requireTenantId()` (ambient) — a Platform Operator's own request context has no tenant id (they're not a tenant member), so none of those methods are callable here at all, and each one additionally opens its *own*, separately-committed `runInContext()` transaction, which would break atomicity even if the ambient-context problem were worked around. Threading an optional external transaction client through five services across four modules was considered and rejected as disproportionately large for this phase — instead, `TenantBootstrapService` writes directly against its own shared transaction client, matching each of those repositories' own `data:` shape exactly (verified by reading every one of them) so the resulting rows are indistinguishable from what the ordinary flow produces. The data **contract** is reused exactly; the function calls are not.

**Why the invitation email is sent *after* the transaction commits, not inside it**: holding a database transaction open across an SMTP call is an anti-pattern this codebase doesn't have anywhere else either — `UserInvitationsService.issueAndSend()` itself interleaves DB writes and `mailer.send()` using its own short-lived, independently-committed transactions, never one transaction spanning both. Bootstrap follows the same discipline: the DB state (tenant/org/administrator/membership/role/entitlements) is genuinely atomic; the notification email is a deliberate, separate, best-effort step. If it fails, the core state is still fully valid and correct — recoverable via the existing, unmodified "resend invitation" endpoint, never an orphaned relationship. This is the actual, precise meaning of this phase's "no orphaned state" requirement: orphaned *identity/tenant/organization* state is structurally impossible; an undelivered *email* is a known, already-recoverable operational hiccup, not the same category of problem.

## 4. Global user semantics

Mirrors `UsersService.createInternal()`'s own established behavior exactly:

- **Email doesn't exist yet** → a new `SecurityUser` is created, `PROVISIONED`, no password. Membership is `INVITED`.
- **Email already resolves to an existing, password-holding Identity** → that Identity is reused as-is (never duplicated, never modified beyond the new Membership row). Membership goes straight to `ACTIVE` — no invitation-accept step needed, matching how the ordinary (non-bootstrap) add-existing-user-to-a-second-organization flow already behaves.
- **Email resolves to a `DEACTIVATED` Identity** → rejected with a `409` and a clear, specific message. Bootstrap is a Platform-Operator-only, authenticated administrative workflow — the brief's own "Platform Operator workflows may have appropriate visibility according to the existing security model" explicitly permits a clear error here, unlike an anonymous/public endpoint where confirming an email's existence would be an enumeration risk. This is the one genuinely "incompatible state" this phase identified — reusing a deactivated identity as a brand-new tenant's administrator would silently resurrect it through an unrelated side door, which this rejects instead.

No new SUPER_ADMIN-style or cross-platform role is ever granted — the administrator receives exactly the seeded, tenant-scoped `TENANT_ADMIN` system role template (`security_role` where `role_code='TENANT_ADMIN' AND tenant_id IS NULL`), the same row every other tenant's own admin already holds. Platform Operator authority is never granted as a side effect of bootstrapping a tenant — verified explicitly by the e2e suite (`platformOperator` row absent for the new administrator).

## 5. Organization Type resolution

`OrganizationType` has **no `tenant_id` column at all** (confirmed directly from the Prisma schema) — genuinely global reference data, not tenant-owned. This independently confirms an open question Phase 2UI.1's own gap analysis flagged as "needs schema-level verification": `OrganizationTypesPage`'s on-screen copy ("global reference data shared across all tenants") is correct, and its current placement — a Tenant Console route gated by the tenant-level `ORGANIZATION_MANAGE` permission — is a real, separate, **not fixed by this phase** cross-tenant data-integrity gap (any tenant admin can edit/delete a globally-shared row every other tenant depends on). Tracked as a known issue below; fixing the page's placement/permission is out of this phase's four listed P0 gaps.

Because of that gap, a Platform Operator today has no reachable endpoint to list existing OrganizationTypes either. Rather than depend on one, or on a 'DEFAULT' row that a real production database has no guarantee of ever having seeded (the only place `'DEFAULT'` is seeded today is the dev-only `database/seeds/003_bootstrap_dev_tenant.sql`, never run in production), bootstrap **finds-or-creates** a `'DEFAULT'` OrganizationType on first use — the same find-or-create discipline `UsersService.createInternal()` already applies to a global `SecurityUser` by email, extended here to a global `OrganizationType` by `typeCode`. An explicit `organizationTypeId` may still be supplied to use an existing type instead.

## 6. Concurrency and idempotency

The real, DB-enforced guarantee is `uk_org_code UNIQUE (tenant_id, organization_code)` (`database/ddl/002_organization.sql`), not an application-level idempotency key. The bootstrap-created Organization always uses a deterministic code (`deriveOrganizationCode()` → `<TENANT_CODE>-ORG`, or an explicit override) — two simultaneous bootstrap requests for the same tenant both pass the pre-checks, both attempt the same `INSERT`, and the database's own unique constraint lets exactly one succeed. The loser's `P2002` is caught and converted to a clean `409 "This tenant has already been bootstrapped"` — the same local-catch pattern already established by `TenantsService.create()`/`TenantProductEntitlementsService.create()`/`ServiceAccountsService.create()` for their own duplicate-prevention guarantees. A sequential retry after a successful bootstrap hits the same constraint via the cheaper pre-check (does this tenant already have an Organization) before even opening a transaction.

## 7. Audit

| Event | Scope | When |
|---|---|---|
| `TENANT_BOOTSTRAP_COMPLETED` | PLATFORM | Inside the transaction, on success — carries `tenantCode`, `organizationId`, `administratorUserId`, `administratorIsNewIdentity`, `membershipStatus`, `roleAssigned`, `productIds` in `metadata`; the structured `tenantId` column is always `null` (PLATFORM-scoped events cannot carry one — enforced by `security_event`'s own RLS `WITH CHECK`, not just convention) |
| `TENANT_BOOTSTRAP_DENIED` | PLATFORM | Before any write, when the tenant isn't `PROVISIONING` or already has an Organization — `metadata.reason` states which |
| `TENANT_BOOTSTRAP_FAILED` | PLATFORM | After a rolled-back transaction — `metadata.errorType` only (a coarse class name, e.g. `AppException`), never the raw error message, which could incidentally echo request data |

No `TENANT_BOOTSTRAP_STARTED` event is written. A pre-authorization "attempt started" event was considered and rejected: every genuine authorization-boundary rejection (missing/invalid token, insufficient permission) already relies on the existing, unmodified `PlatformJwtAuthGuard`/`PlatformPermissionsGuard` behavior, exactly like every other platform endpoint — adding a new, bootstrap-only "log every auth attempt" behavior would be an inconsistent, narrowly-scoped exception to how every other endpoint in this codebase already behaves. `DENIED`/`FAILED`/`COMPLETED` are the three business-outcome events that matter; the guard layer's own 401/403 is the fourth, already-audited-the-same-way-everywhere-else outcome.

## 8. Never stored, logged, or returned

No password is ever set by bootstrap (the administrator sets their own, via the ordinary invitation-accept flow) — there is nothing password-shaped for this endpoint to leak. No secret/credential material is involved in bootstrap at all (that's Gap #2/#3 — see `docs/CREDENTIAL_ROTATION.md`).

## 9. Frontend contract

The future Admin Console's Tenant Onboarding wizard (`docs/PRODUCT_ONBOARDING_UX.md`'s sibling document, `docs/IDENTITY_UX_ARCHITECTURE.md` §3.1) can now be built entirely against this one endpoint plus the pre-existing `POST /platform/tenants` and `POST .../product-entitlements` — no raw SQL, no dev seed script, no hidden workaround. `Create Tenant` (existing) → `Bootstrap` (this endpoint: organization + administrator + optional entitlements, one call) → `Activate` (existing `POST .../activate`).

## 10. Known issues carried forward, not fixed this phase

- **Organization Types placement/permission** (§5) — a real, confirmed cross-tenant data-integrity gap, out of this phase's four listed P0 items. Tracked for a future phase.
- **No bulk product-entitlement endpoint** — bootstrap's `productIds` array issues N sequential `tenantProductEntitlement.create()` calls inside the one transaction; fine for the handful of products a new tenant typically starts with, not a general bulk-entitlement primitive (still doesn't exist anywhere in this codebase, per Phase 2UI.1's own finding).
