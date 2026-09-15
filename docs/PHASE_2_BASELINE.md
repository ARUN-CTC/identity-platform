# Phase 2 Baseline — Where Phase 1 Actually Left Us

This is the factual starting point for Phase 2. It restates what exists today (code, schema, behavior), not what Phase 2 wants it to become — those decisions live in the other Phase 2 documents this baseline feeds into. Nothing in this document changes any code.

Sources reviewed: `docs/PHASE_1.md`, `docs/PROJECT_ISOLATION.md`, `docs/TRAVELOS_COUPLING.md`, `docs/IDENTITY_SOURCE_INVENTORY.md`, `docs/ARCHITECTURE.md`, `database/prisma/schema/*.prisma`, `src/modules/*`.

## 1. Current architecture

NestJS (Express adapter) monolith, single deployable service, single Postgres database (`identity_platform_db`), Prisma as the query layer over hand-written SQL DDL (no `prisma migrate`). Request lifecycle: `nestjs-cls` context → global `JwtAuthGuard` → global `TenantStatusGuard` → global `PermissionsGuard` → controller/service/repository → `PrismaContextService` sets RLS session GUCs per transaction → `ResponseInterceptor`/`AllExceptionsFilter` for envelope/error shape. See `docs/ARCHITECTURE.md` for the full request lifecycle diagram — it has not changed.

## 2. Current IAM modules

`src/modules/{authentication,authorization,jwt,sessions,security-audit,users,roles,permissions,organizations,organization-types,tenants,mailer,health}`. Organization Unit / Organization Unit Hierarchy have schema and DDL but no service/controller — deliberately deferred in Phase 1. No modules exist yet for: applications/clients, product registration, service accounts, OAuth2/OIDC, MFA, SAML, LDAP, SCIM, a policy engine.

## 3. Current database (schema facts that matter for Phase 2 decisions)

- `Tenant` — top-level entity, 1:N `Organization`. Rewritten in Phase 1 (not copied) with a minimal set of back-relations (see `TRAVELOS_COUPLING.md`).
- `Organization` — belongs to exactly one `Tenant`, typed via `OrganizationType`. 1:N `OrganizationUnit`.
- `OrganizationUnit` — self-referencing hierarchy plus a closure table (`OrganizationUnitHierarchy`) for ancestor/descendant queries. Schema only; no API yet.
- `SecurityUser` — **scoped to exactly one `Tenant`** (`tenantId` is a required FK; email uniqueness is `(tenantId, email)`, not global). This is the single most consequential fact for Phase 2's domain-model decision — see `docs/IDENTITY_DOMAIN_MODEL.md` §"Is the User model still correct?".
- `SecurityRole` — optionally tenant-scoped (`tenantId` nullable → platform/system roles) or tenant-owned (custom roles). No product scoping field exists today.
- `SecurityPermission` — a single flat, global catalog (`permissionCode` globally unique), currently seeded with 9 identity-core codes only (`TRAVELOS_COUPLING.md`). No namespace/product ownership field exists.
- `SecurityUserRole` — the grant row: `(userId, roleId, organizationId?)`, always inside one `tenantId`. `organizationId` nullable → tenant-wide grant. This is how "roles differ by organization" already works today, within a single tenant.
- `SecuritySession` — carries a nullable `organizationId`: the schema already anticipated organization-context switching (see Phase 1's own note in `security.prisma`'s comment on this field) but no service/endpoint uses it yet.
- `SecurityRefreshToken` — opaque, hash-only storage, rotation-chain (`replacedById`/`replaces`). No revocation-reason taxonomy beyond a free-text field.
- Nothing in the schema represents: an external application/client, a product/subscription, a service account, an OAuth scope, an audience.

## 4. Current authentication

Username/email + password (Argon2id) → session + JWT access token + opaque refresh token. Password reset and invitation flows use self-identifying, hash-only-stored tokens (tenant id in cleartext, secret hashed). No MFA, no social login, no SSO, no passkeys. Login is always tenant-scoped by construction (the login DTO or the user's own row resolves exactly one tenant) — there is no concept of "log in, then pick which tenant" because a user cannot belong to more than one tenant today.

## 5. Current authorization

Classic RBAC: `SecurityUserRole` grants a `SecurityRole` (bundle of `SecurityPermission`s via `SecurityRolePermission`) to a user, optionally scoped to one `Organization`. `PermissionsGuard` resolves grants fresh on every request (no caching, no staleness window). A documented "grant-ceiling" rule exists in `UserRolesService`: a caller can only grant permissions they themselves hold. No policy engine, no attribute-based rules, no resource-level ownership checks beyond what a controller/service does by hand.

## 6. Current token design

Signed JWT access token (short-lived; exact TTL is env-configured, not hardcoded) + opaque refresh token (long-lived, rotated, hash-only persisted). Access token claims are minimal — Phase 1 did not standardize or document a claim set beyond what the login/refresh flow needed to run its own guards (see `docs/TOKEN_ARCHITECTURE.md` for the claim-by-claim Phase 2 design). No `aud` concept exists — a token is valid for this one service only, because no other service has ever consumed it. No ID token, no API-key concept, no service-account credential.

## 7. Current tenant model

One tenant = one root-level customer account. A tenant contains N organizations. A user belongs to exactly one tenant (see §3). There is no concept of a tenant subscribing to a "product" — Phase 1 is single-product-shaped by omission, not by an explicit single-product decision.

## 8. Current organization model

An organization belongs to exactly one tenant, has a type, and can be internally subdivided into `OrganizationUnit`s (hierarchical, closure-table-backed). Users are granted roles scoped to zero or one organization at a time (multiple grant rows cover multiple organizations). No organization-level product entitlement exists. No "active organization" session/token concept is wired up yet, despite the schema field being present.

## 9. Current gaps (carried in from Phase 1, restated here as Phase 2 inputs)

1. No environment-variable validation schema.
2. No organization-context switching implementation (schema field present, unused).
3. No Organization Unit service/controller.
4. No real outbound mail provider.
5. No deliberate SAML/OIDC/OAuth-authorization-server/Passkeys/policy-engine decision — none exist, none were ruled in or out.
6. No CI/CD pipeline.
7. **Newly identified during this baseline review** (not in Phase 1's own gap list): `SecurityUser` is tenant-scoped, which structurally blocks "one person, multiple organizations/tenants/products" — a requirement the Phase 2 brief explicitly asks about (Step 3, question 4). This is the central open question `docs/IDENTITY_DOMAIN_MODEL.md` resolves.
8. No application/client/product/subscription concept exists at all — required for any multi-product integration boundary (Step 4).
9. No audience (`aud`) claim, so nothing today prevents a token issued for one purpose being replayed against a different consumer — moot while there is exactly one consumer, but a blocking gap the moment a second product (or even a second TravelOS environment) exists.

## 10. Existing TravelOS coupling

Unchanged since Phase 1: **LOW**, at the code/runtime level (`docs/TRAVELOS_COUPLING.md`). This baseline review found no new coupling — no TravelOS import, config, secret, or network path exists anywhere in this repository. TravelOS remains read-only reference material for this and all subsequent Phase 2 documents.

## 11. Phase 1 limitations relevant to Phase 2 scope

Phase 1 was extraction-and-isolation, not design. Its multi-tenancy model was carried over largely as TravelOS had it (single-product, tenant-scoped user) because there was only ever one product to extract from. Phase 2's job is to test that model against three concrete products (TravelOS, Healthcare, Gym) plus "N future products," and change only what that test actually breaks — not to redesign for its own sake. The user/tenant-scoping gap (§9.7) is the one place that test breaks the existing model; everything else (organization, role, permission, session, token *mechanism*) survives largely intact and is reused, not replaced, in the documents that follow.
