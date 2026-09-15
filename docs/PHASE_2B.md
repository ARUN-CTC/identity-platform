# Phase 2B — Product/Application Registration & Trust Boundary

## Objective

Establish a generic Product/Application registration model so independent products (TravelOS, Healthcare, Gym, and future ones) can register with the Identity Platform without coupling their source code or databases to it — the future trust boundary `docs/TRUST_BOUNDARY.md` documents. See `docs/PHASE_2B_DOMAIN_MODEL.md` for why this is a two-tier `Product → Application` model, not three-tier — "Client" is not a separate entity (ADR-009).

## What was implemented

- **Database**: `product` and `application` tables (`database/ddl/005_product.sql`, forward migration `database/migrations/20260913140000_product_application_registration.sql`) — both platform-level, no `tenant_id`, no RLS (`docs/TRUST_BOUNDARY.md`'s explicit determination).
- **Prisma**: `database/prisma/schema/product.prisma` — `Product`, `Application` models.
- **API**:
  - `POST /v1/products`, `GET /v1/products`, `GET /v1/products/:id`, `PATCH /v1/products/:id`
  - `POST /v1/products/:productId/applications`, `GET /v1/products/:productId/applications`
  - `GET /v1/applications/:id`, `PATCH /v1/applications/:id`
  - No DELETE endpoint for either — status (`ACTIVE`/`SUSPENDED`/`DISABLED`) is the lifecycle mechanism, not deletion (other data may reference these rows the moment real registrations exist).
- **Permissions**: four new core, platform-level codes — `PRODUCT_VIEW`, `PRODUCT_MANAGE`, `APPLICATION_VIEW`, `APPLICATION_MANAGE` — granted to `SUPER_ADMIN` only, explicitly excluded from `TENANT_ADMIN` (same treatment as `TENANT_MANAGE`).
- **Audit**: `PRODUCT_CREATED`/`PRODUCT_UPDATED`/`PRODUCT_DISABLED`, `APPLICATION_CREATED`/`APPLICATION_UPDATED`/`APPLICATION_DISABLED`/`CLIENT_CREDENTIAL_CREATED` — via the existing `SecurityEventsService`, no parallel mechanism.
- **Seed data**: `database/seeds/004_products.sql` — TravelOS/Healthcare/Gym as synthetic platform-catalog rows, one sample `CONFIDENTIAL` Application each (placeholder dev-only secret, documented as such).
- **Tests**: `tests/phase2b-product-registration.e2e-spec.ts` — 14 tests against the real database.

## Who may register a product (the platform-operator gap, reused not rebuilt)

> **Superseded by Phase 2B.1** (`docs/PHASE_2B1.md`, `docs/adr/ADR-010-platform-operator-security-boundary.md`): the stand-in described below was explicitly temporary and has been replaced by a first-class Platform Operator principal. `PRODUCT_MANAGE`/`APPLICATION_MANAGE` etc. are now granted via `platform_operator_permission`, checked by `PlatformPermissionsGuard`, never via a tenant-scoped `SecurityUserRole` grant — a `SUPER_ADMIN` token is rejected outright. The paragraph below is kept for the historical record of Phase 2B's own reasoning at the time.

`docs/IDENTITY_DOMAIN_MODEL.md` §6 already identified a real gap: a dedicated platform-operator principal, decoupled from any tenant's Membership, does not exist yet. Phase 2B needed *some* answer to "who may call `POST /v1/products`" and did not build that principal (out of scope for this phase — it's a bigger, cross-cutting change). Instead: **`SUPER_ADMIN` — an existing system role, already seeded since Phase 1 with every permission in the catalog and already documented as "full platform-level access across every tenant" — is the stand-in.** A caller holding `SUPER_ADMIN` via a `SecurityUserRole` grant in *any* tenant can manage products/applications, resolved through the exact same `PermissionsGuard`/`resolveGrants()` mechanism every other permission check in this codebase already uses — no new authorization path, no new guard. This is a deliberate, documented reuse, not a workaround pretending to be one: `SUPER_ADMIN` was already described this way before Phase 2B existed; this phase is simply its first real use case.

## Client credential handling (Step 13)

- `client_id`: generated (`cli_` + 24 random base64url bytes via `generateClientId()`, `src/common/utils/client-credential.util.ts`), public, safe to log.
- `client_secret`: generated only for `CONFIDENTIAL` applications (32 random bytes, base64url), hashed with SHA-256 (`hashClientSecret()`) before storage — never Argon2id, because a machine-generated high-entropy secret gains nothing from a memory-hard KDF, the same reasoning already applied to this codebase's refresh/invitation/reset tokens.
- Returned in plaintext **exactly once** — the `POST .../applications` response only (`ApplicationsService.create()`'s `CreatedApplication` return type is deliberately distinct from every other read path). Every `GET`/list/`PATCH` response strips `clientSecretHash` (`ApplicationsService.sanitize()`), verified directly in the e2e suite.
- No credential-rotation *workflow* was built (`secretCreatedAt`/`secretRevokedAt` columns exist, reserved, per the brief's own "do not implement ... unless required by Phase 2B").

## Platform-level vs. tenant-level (Step 20)

Full reasoning in `docs/TRUST_BOUNDARY.md`. Summary: `product`/`application` carry no `tenant_id` and have no RLS, on principle (an entity that doesn't belong to any one tenant can't correctly be tenant-partitioned) — not by omission. Every existing tenant-scoped table (`Tenant`, `Organization`, `Membership`, `security_user_role`, `security_session`) is completely unchanged.

## Organization/Tenant relationship — deferred (Step 15)

No `TenantProductSubscription` (or organization-level equivalent) was built. `docs/PRODUCT_REGISTRATION.md` already speced this conceptually at Tenant granularity during Phase 2's architecture pass; the brief's own alternative (organization-level, "Organization A: TravelOS enabled, Healthcare enabled, Gym disabled") is recorded as a live alternative to weigh, not resolved either way. Both remain future work — see `docs/PHASE_2_IMPLEMENTATION_PLAN.md`.

## What was explicitly NOT implemented (per this phase's own scope control)

OAuth2 authorization server, OIDC provider, SAML, Passkeys, MFA, social login, LDAP, SCIM, organization-context switching, any change to JWT/token claims, service-to-service authentication (`ServiceAccount`), product-specific business permissions, subscription/billing, SDKs, and — obviously — no TravelOS integration code of any kind. Every one of these remains exactly where `docs/PHASE_2_IMPLEMENTATION_PLAN.md` already placed it.

## Known issues

1. ~~Product/Application audit events are tenant-attributed to the acting admin's own session tenant~~ — **resolved in Phase 2B.1** (`docs/PHASE_2B1.md`, `docs/PLATFORM_OPERATOR_ARCHITECTURE.md` §12): `security_event.scope` now distinguishes `PLATFORM` events (genuinely `NULL` tenant_id) from `TENANT` ones, and Product/Application management now runs exclusively through Platform Operator authentication, which has no tenant context to (mis)attribute to in the first place.
2. **No request-time enforcement of Product/Application `status` anywhere.** A `DISABLED` product or application is stored and readable as such, but nothing currently checks it (there is no audience-checked token flow yet for it to gate) — exactly as Step 14 anticipated ("do not implement request authentication enforcement yet unless the current API architecture requires it"). This becomes load-bearing the moment `aud` validation (`docs/TOKEN_ARCHITECTURE.md`) is built.
3. **No DB-level constraint preventing a `client_secret_hash` on a `PUBLIC` application, or a missing one on a `CONFIDENTIAL` one** — enforced only in `ApplicationsService.create()`. Consistent with this codebase's existing convention of enforcing this class of invariant in application code rather than a DB CHECK constraint (matching, e.g., `UsersService`'s own lifecycle-transition validation).

## Deferred items

`TenantProductSubscription` (or its organization-level alternative), `ServiceAccount`, credential rotation endpoints, the platform-operator principal type, and everything else listed in `docs/PHASE_2_IMPLEMENTATION_PLAN.md` from Phase 2C onward.
