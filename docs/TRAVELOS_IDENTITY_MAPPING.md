# TravelOS ↔ Identity Platform — Identity Mapping

Phase 2E.1. Builds on the actual findings in `docs/TRAVELOS_CURRENT_IDENTITY_INVENTORY.md` — every mapping below is justified against real schema/code, not assumed.

## 1. User mapping

```text
TravelOS SecurityUser (tenant-scoped, email unique PER TENANT)
        ↓
Identity Platform SecurityUser (global, email unique GLOBALLY)
        +
Membership (one per Tenant the person belongs to)
```

**Relationship cardinality**: TravelOS today models identity as **N TravelOS-SecurityUser rows : 1 real person**, where N = however many tenants that person's email happens to appear in (each an independent row, independent password hash, independent `id`). Identity Platform models it as **1 global SecurityUser : N Memberships**. Migrating is therefore an N:1 **reconciliation**, not a straight copy — see §4.

**ID preservation**: TravelOS's own `SecurityUser.id` is **NOT preserved** as the Identity Platform `SecurityUser.id`, for two independent reasons: (1) it is impossible to preserve when N>1 TravelOS rows reconcile to one Identity Platform row (which one "wins" the id?); (2) even in the N=1 case, reusing a TravelOS-generated UUID as an Identity-Platform-generated primary key creates an unnecessary coupling between two systems that must otherwise remain fully independent (per the absolute isolation rule). **Decision: Identity Platform always generates a new `id`.** A mapping table records the correspondence — see §4's `travelos_user_identity_map`.

**Email is an attribute, never the permanent key** — per the brief's own explicit instruction. The mapping table (§4) keys off `(travelos_tenant_id, travelos_user_id)`, a value that is stable even if the person's email later changes in either system.

## 2. Tenant mapping

```text
TravelOS Tenant (tenant.id, tenant.tenantCode)
        ↓
Identity Platform Tenant (Tenant.id, Tenant.tenantCode)
```

**Same ID reuse**: technically possible (both are UUID-keyed, both have a unique `tenantCode`) but **not recommended**. Reusing the same UUID creates an implicit coupling an operator could mistake for a real foreign-key relationship across two independently-owned databases (violates the absolute isolation rule's spirit even though it wouldn't violate it literally, since no actual cross-database FK would exist). **Decision: Identity Platform generates a new `Tenant.id` per TravelOS tenant; `tenantCode` is carried over verbatim** (human-readable, already meaningful to TravelOS's own operators, and Identity Platform's own `Tenant.tenantCode` is likewise unique) — this gives operators a recognizable anchor without a hidden ID coupling. A `travelos_tenant_identity_map` table (§4) records `(travelos_tenant_id, identity_tenant_id, tenantCode)`.

**Isolation guarantee during migration**: the mapping table is the ONLY place the correspondence is recorded; nothing in either system's own runtime queries ever cross-references the other tenant ID directly — every request path resolves through the mapping table (or, post-cutover, through the JWT's own `tenant_id`, which is always an Identity Platform ID once issued by Identity Platform). This is what prevents "TravelOS tenant A resolving to Identity tenant B" (brief §16's explicit requirement): the mapping table has a unique constraint on `travelos_tenant_id`, so exactly one Identity tenant can ever be the resolution target for a given TravelOS tenant, and every lookup goes through it rather than through any inferred/guessed correspondence.

**Tenant status mapping**: TravelOS `Tenant.status` (raw string, values not exhaustively enumerated this pass — **UNKNOWN, requires confirmation before 2E.3**) must map onto Identity Platform's own `Tenant.status` (`ACTIVE`/`SUSPENDED`, per `docs/PRODUCT_INTEGRATION_CONTRACT.md`). A TravelOS tenant that is not active should never be provisioned as an ACTIVE Identity Platform tenant.

**Tenant owner**: not yet determined — TravelOS has no explicit "tenant owner user" field visible in the schema sampled this pass (**UNKNOWN**). Identity Platform has no such concept either (a Tenant's first TENANT_ADMIN membership is the closest analog). No forced mapping is proposed; document as "no current equivalent" per the brief's own instruction not to fabricate one.

## 3. Organization mapping

TravelOS's `Organization`/`OrganizationUnit` hierarchy is richer than, and not congruent with, Identity Platform's `Organization`:

```text
TravelOS Organization (ERP entity: legal name, tax number, currency, cost centers, fiscal years)
        ↓
Identity Platform Organization (lightweight context marker: id, tenantId, organizationCode, organizationName, status)
```

**Recommendation**: map ONE Identity Platform `Organization` row per TravelOS `Organization` row (matched on `organizationCode` within the reconciled tenant), carrying over only `organizationCode`/`organizationName`/`status` — NOT the ERP fields (tax number, currency, cost centers, fiscal years, etc.), which have no Identity Platform equivalent and must remain exclusively in TravelOS's own database. Identity Platform's `Organization` becomes purely an **identity/access-context anchor** for that same real-world organization; TravelOS's own `Organization` row remains the business-data authority. `OrganizationUnit` (the branch/department sub-hierarchy) has **no Identity Platform equivalent at all** — document as such, not mapped, stays entirely TravelOS-owned (Identity Platform's `Organization` is not hierarchical).

**Membership mapping**: TravelOS has no `Membership` table (§ inventory §5) — a user's org-scoped role grant (`SecurityUserRole.organizationId`) is the closest analog. Migration produces one Identity Platform `Membership` row per (reconciled global user, reconciled tenant, reconciled organization) combination actually observed in TravelOS's `SecurityUserRole` data — i.e., Membership existence is DERIVED from role-grant data, not from an explicit TravelOS "membership" record, since none exists.

## 4. Reconciliation / mapping tables

Two mapping tables are proposed as **Identity-Platform-side, migration-scoped, additive** tables (created only if/when 2E.3 actually executes migration — not created by this architecture phase):

```sql
-- Records the Tenant correspondence.
travelos_tenant_identity_map (
  travelos_tenant_id   uuid PRIMARY KEY,   -- TravelOS's own tenant.id, recorded for traceability only (never joined against)
  identity_tenant_id   uuid NOT NULL UNIQUE REFERENCES tenant(id),
  tenant_code          text NOT NULL,
  migrated_at          timestamptz NOT NULL DEFAULT now()
)

-- Records the User correspondence — one row PER (travelos_tenant, travelos_user), since
-- one real person may produce several rows here if they had accounts in several TravelOS tenants.
travelos_user_identity_map (
  travelos_tenant_id     uuid NOT NULL,
  travelos_user_id       uuid NOT NULL,
  identity_user_id       uuid NOT NULL REFERENCES security_user(id),   -- the SAME global id for every row belonging to the same reconciled person
  identity_membership_id uuid NOT NULL REFERENCES membership(id),
  migration_status       text NOT NULL,   -- PENDING / RECONCILED / CONFLICT / SKIPPED
  migrated_at            timestamptz,
  PRIMARY KEY (travelos_tenant_id, travelos_user_id)
)
```

These are the ONLY new tables this architecture phase identifies as potentially necessary — and even these are **not created in Phase 2E.1** (an architecture-only phase); they are documented here as the schema a future 2E.3 migration-execution phase would need, with the exact "why application-only handling is insufficient" justification the brief's own database-change policy (`docs/PHASE_2D12.md`'s frozen policy) requires: reconciliation must be auditable and re-runnable (a partially-completed migration must be able to resume, not re-derive its own prior decisions from scratch), which requires a durable, queryable record — not something safely held in application memory or a one-off script's local state.

## 5. Session mapping

```text
TravelOS SecuritySession + SecurityRefreshToken
        ↓
Identity Platform SecuritySession (legacy internal) — during coexistence (§ cutover plan)
        ↓ (post-cutover)
Identity Platform OAuth Authorization Code + PKCE session (human authentication becomes fully Identity-Platform-owned)
```

No TravelOS session is migrated as data — sessions are inherently transient (short-lived access tokens, revocable refresh tokens). Every TravelOS user simply re-authenticates through Identity Platform once cutover for their tenant/cohort occurs (see `docs/TRAVELOS_AUTH_CUTOVER_PLAN.md`); existing TravelOS sessions are left to expire naturally or are explicitly revoked at cutover, never carried over.

## 6. Application / ServiceAccount mapping

TravelOS has no existing equivalent (inventory §12) — this is pure NEW provisioning, not a migration:

```text
TravelOS web (SPA, apps/web)         → Identity Platform Application, clientType=PUBLIC, grantTypes=[authorization_code], PKCE S256
TravelOS admin (apps/admin)          → a SECOND, separate Application (own client_id) — distinct environment/audience discipline (docs/OAUTH_ARCHITECTURE.md §4)
TravelOS backend (resource server)   → validates tokens via JWKS; does NOT itself need an Application/ServiceAccount registration to VALIDATE tokens (only to ISSUE them, which it will no longer do)
TravelOS backend jobs/workers        → IF any backend-to-backend call needs its own token (not yet confirmed to exist — inventory §17 UNKNOWN), a dedicated ServiceAccount under its own Application
```

See `docs/TRAVELOS_INTEGRATION_ARCHITECTURE.md` §Application topology for the full design.

## 7. Entitlement mapping

```text
TravelOS's own concept: none (no existing cross-product entitlement gate)
        ↓
Identity Platform Product (one row per TravelOS-internal product: "TravelOS-Travel", "TravelOS-Healthcare", "TravelOS-Fitness" — see inventory §13's multi-product finding)
        ↓
TenantProductEntitlement (one row per reconciled Tenant × Product)
```

TravelOS's existing `TenantFeature`/`SubscriptionPlan` system is a DIFFERENT, TravelOS-owned layer (feature-flags WITHIN a product the tenant is already entitled to) — never conflated with `TenantProductEntitlement` (the platform-wide "may this tenant use this product at all" gate). See `docs/PRODUCT_INTEGRATION_CONTRACT.md` §5 for the frozen distinction this must respect.

## 8. Roles / permissions mapping

```text
TravelOS Group A (USER_MANAGE, ROLE_MANAGE, TENANT_MANAGE, SESSION_MANAGE, SECURITY_AUDIT_VIEW, PERMISSION_VIEW, ROLE_VIEW, USER_VIEW)
        ↓
SUPERSEDED by Identity Platform's own platform-operator/tenant-admin surface — NOT migrated as TravelOS roles;
these capabilities simply stop being TravelOS's own concern once Identity Platform owns identity administration

TravelOS Group B (ORGANIZATION_MANAGE, DOCUMENT_MANAGE, BANK_ACCOUNT_MANAGE, TENANT_BRANDING_MANAGE,
                  TENANT_BUSINESS_DEFAULTS_MANAGE, TRAVEL_*, and the not-yet-enumerated healthcare/fitness equivalents)
        ↓
REMAINS TravelOS IAM, unchanged — enforced by TravelOS's own (unmodified) PermissionsGuard/resolveGrants(),
now keyed off the Identity-Platform-validated principal's tenantId/organizationId/scopes instead of a
TravelOS-issued JWT's own tenantId/organizationId

SUPER_ADMIN / TENANT_ADMIN / AGENT (system role templates)
        ↓
TravelOS keeps these AS ITS OWN role templates, minus the Group A permissions they currently carry
(which become meaningless once TravelOS no longer administers identity) — role NAMES are not migrated
into Identity Platform; Identity Platform has its own, separate platform-operator/tenant-admin concept
already (docs/PLATFORM_OPERATOR_ARCHITECTURE.md) that is NOT populated from TravelOS role data
```

**Explicit non-goal, per the brief**: TravelOS business roles never automatically become Identity Platform roles. No migration step copies `security_role`/`security_user_role` rows into Identity Platform.

## 9. Password migration strategy

Both systems already use `argon2.hash(plain, {type: argon2.argon2id})` with **default (unmodified) cost parameters** (inventory §1/§7). Argon2id's PHC-format hash string (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`) is self-describing and portable across library versions/implementations that correctly implement the algorithm — the differing npm package versions (0.45.1 vs 0.41.1) do not, by themselves, indicate incompatibility.

**Recommended strategy: direct hash migration, with a verification step before trusting it at scale.** Specifically:
1. Before 2E.3, take a small sample of real TravelOS password hashes (with the corresponding plaintext known only in a controlled test, e.g. freshly-created test accounts with known passwords) and confirm Identity Platform's `verifyPassword()` accepts them unmodified.
2. If confirmed, `passwordHash` copies directly into the reconciled `SecurityUser.passwordHash` — no forced reset, no compatibility-shim verifier needed.
3. If NOT confirmed (e.g. a hidden custom cost-parameter override discovered at that time), fall back to **just-in-time migration**: keep the TravelOS hash in a clearly-labeled `legacyPasswordHash` field, verify against it on the user's first post-cutover login, and re-hash into Identity Platform's own `passwordHash` at that moment — never a forced reset unless verification is impossible, and never weakening Identity Platform's own Argon2id policy to accommodate a mismatch.

This is a recommendation to validate in 2E.2/2E.3, not something executed in this architecture-only phase.

## 10. Summary diagram

```text
TravelOS                                      Identity Platform
─────────                                      ─────────────────
SecurityUser (tenant-scoped, N per person)  →  SecurityUser (global, 1 per person) + Membership (N)
Tenant                                       →  Tenant (new id, same tenantCode)
Organization (ERP entity)                    →  Organization (context anchor only — ERP fields stay in TravelOS)
OrganizationUnit / CostCenter / FiscalYear   →  NO EQUIVALENT — stays TravelOS-owned
SecurityRole/Permission (Group A)            →  SUPERSEDED by Identity Platform's own admin surface
SecurityRole/Permission (Group B, TRAVEL_*)  →  NO EQUIVALENT — stays TravelOS IAM, unchanged
SecuritySession / SecurityRefreshToken       →  NOT migrated (sessions are transient — re-authenticate)
(no equivalent)                              →  Application / ServiceAccount (new provisioning)
(no equivalent)                              →  Product / TenantProductEntitlement (new provisioning)
TenantFeature / SubscriptionPlan             →  NO EQUIVALENT — stays TravelOS-owned (different layer)
ApiKey / Webhook (outbound integrations)     →  NO EQUIVALENT — stays TravelOS-owned, unrelated
```
