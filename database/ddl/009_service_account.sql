-- Phase 2D.3 — ServiceAccount & Tenant Grant Foundation
-- (docs/PHASE_2D3.md, docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md,
-- docs/adr/ADR-015-service-tenant-authorization.md as amended).
--
-- Two new tables:
--
-- 1. `service_account` — the machine principal. PLATFORM-level, exactly
--    like `application`/`product`: no tenant_id, no RLS. A ServiceAccount
--    belongs to exactly one Application (1 Application : N ServiceAccounts,
--    docs/PRODUCT_REGISTRATION.md §2.4/§3) and authenticates itself with its
--    OWN credential — distinct from, never conflated with, the Application's
--    own client_secret (docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md §2).
--    `id` (a UUID, high-entropy, non-sequential, never reused) IS the stable
--    public identifier a future service-issued token's `sub` claim will
--    carry — no separate "service_account_id-as-a-string" column is needed;
--    a UUID primary key already satisfies every requirement a bespoke
--    opaque string would (globally unique, non-secret, high entropy, never
--    derived from a sequential counter).
--
-- 2. `service_account_tenant_grant` — the explicit, durable, revocable
--    record of which Tenants a ServiceAccount may act on. TENANT-scoped,
--    ordinary apply_tenant_rls (same reasoning docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md
--    §7 already gives for `tenant_product_entitlement`: every access to
--    this table is always made with an explicit, already-known,
--    existence-checked tenantId — named in the request path
--    (/v1/platform/tenants/:tenantId/service-account-grants), never
--    discovered cross-tenant — so the ordinary actingAsTenantId pattern
--    applies cleanly with no need for Phase 2C's own narrow self-visibility
--    RLS relaxation, which existed to solve a DIFFERENT problem (a human
--    discovering their OWN cross-tenant memberships with no tenant context
--    at all yet) that does not arise here: every caller of this table is a
--    Platform Operator, who never has an ambient tenant context to begin
--    with and always names the target tenant explicitly, exactly like
--    tenant_product_entitlement already does.
--
-- A valid ServiceAccountTenantGrant means "this service MAY act for this
-- tenant" — nothing more. It does NOT mean "this service may access every
-- Product" (that remains tenant_product_entitlement's own, independent
-- question, unchanged, un-duplicated) and it carries no organization_id
-- (organization context remains a human/Membership concern — a service
-- identity never inherits one).

CREATE TABLE service_account (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    application_id UUID NOT NULL REFERENCES application(id) ON DELETE CASCADE,

    name VARCHAR(200) NOT NULL,

    -- ACTIVE | SUSPENDED | DISABLED — same vocabulary as application.status,
    -- deliberately: a ServiceAccount is architecturally analogous to an
    -- Application (a platform-registered principal, not a human Identity).
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    -- The ServiceAccount's OWN credential — never Application.client_secret_hash,
    -- never shared with it. Always generated at creation (a machine
    -- principal has no "public, no-secret" variant the way a PUBLIC OAuth
    -- client does — PKCE has no analog for server-to-server auth). Hash
    -- only, same SHA-256-over-high-entropy-random-value approach already
    -- used for application.client_secret_hash (src/common/utils/client-credential.util.ts)
    -- — reused, not reinvented.
    credential_hash TEXT NOT NULL,
    credential_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    credential_revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_service_account_application_name UNIQUE (application_id, name)
);
CREATE INDEX idx_service_account_application ON service_account(application_id);
CREATE INDEX idx_service_account_status ON service_account(status);

CREATE TRIGGER trg_service_account_set_audit_fields
    BEFORE UPDATE ON service_account
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

CREATE TABLE service_account_tenant_grant (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    service_account_id UUID NOT NULL REFERENCES service_account(id) ON DELETE CASCADE,

    -- ACTIVE | SUSPENDED | REVOKED — same vocabulary, same lifecycle shape,
    -- as tenant_product_entitlement.status. REVOKED -> ACTIVE is reachable
    -- only via a dedicated reactivate action (application-layer, mirroring
    -- docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md exactly), never the generic
    -- status PATCH.
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    -- At most one grant row per (service_account, tenant), ever — the
    -- actual concurrency guarantee (Step 15/35), not merely an
    -- application-level pre-check. A revoked grant is reactivated in
    -- place, never superseded by a second row for the same pair.
    CONSTRAINT uk_service_account_tenant_grant UNIQUE (service_account_id, tenant_id)
);
CREATE INDEX idx_service_account_tenant_grant_tenant ON service_account_tenant_grant(tenant_id);
CREATE INDEX idx_service_account_tenant_grant_service_account ON service_account_tenant_grant(service_account_id);
CREATE INDEX idx_service_account_tenant_grant_status ON service_account_tenant_grant(status);

CREATE TRIGGER trg_service_account_tenant_grant_set_audit_fields
    BEFORE UPDATE ON service_account_tenant_grant
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

CALL apply_tenant_rls('service_account_tenant_grant');
