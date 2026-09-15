-- Phase 2D.3: ServiceAccount & Tenant Grant Foundation
-- (docs/PHASE_2D3.md, docs/adr/ADR-015-service-tenant-authorization.md as
-- amended). Purely additive — two new tables, four new permission codes,
-- no existing table's shape changes. Forward-only, idempotent, safe to
-- apply to an already-seeded database.

BEGIN;

CREATE TABLE IF NOT EXISTS service_account (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    application_id UUID NOT NULL REFERENCES application(id) ON DELETE CASCADE,

    name VARCHAR(200) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

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
CREATE INDEX IF NOT EXISTS idx_service_account_application ON service_account(application_id);
CREATE INDEX IF NOT EXISTS idx_service_account_status ON service_account(status);

DROP TRIGGER IF EXISTS trg_service_account_set_audit_fields ON service_account;
CREATE TRIGGER trg_service_account_set_audit_fields
    BEFORE UPDATE ON service_account
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

CREATE TABLE IF NOT EXISTS service_account_tenant_grant (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    service_account_id UUID NOT NULL REFERENCES service_account(id) ON DELETE CASCADE,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_service_account_tenant_grant UNIQUE (service_account_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_service_account_tenant_grant_tenant ON service_account_tenant_grant(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_account_tenant_grant_service_account ON service_account_tenant_grant(service_account_id);
CREATE INDEX IF NOT EXISTS idx_service_account_tenant_grant_status ON service_account_tenant_grant(status);

DROP TRIGGER IF EXISTS trg_service_account_tenant_grant_set_audit_fields ON service_account_tenant_grant;
CREATE TRIGGER trg_service_account_tenant_grant_set_audit_fields
    BEFORE UPDATE ON service_account_tenant_grant
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

-- Idempotent: apply_tenant_rls() unconditionally creates a policy named
-- "tenant_isolation" — guard against re-running this migration against a
-- database that already has it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_account_tenant_grant' AND policyname = 'tenant_isolation'
    ) THEN
        CALL apply_tenant_rls('service_account_tenant_grant');
    END IF;
END
$$;

-- New platform-only permissions (see database/seeds/001_permissions.sql's
-- own comment on platform_only).
INSERT INTO security_permission (permission_code, resource, action, description, is_system, platform_only)
VALUES
    ('SERVICE_ACCOUNT_VIEW',               'SERVICE_ACCOUNT',              'VIEW',   'View registered service accounts (machine principals)', TRUE, TRUE),
    ('SERVICE_ACCOUNT_MANAGE',             'SERVICE_ACCOUNT',              'MANAGE', 'Register and manage service accounts and their credentials (platform-level)', TRUE, TRUE),
    ('SERVICE_ACCOUNT_TENANT_GRANT_VIEW',   'SERVICE_ACCOUNT_TENANT_GRANT', 'VIEW',   'View which tenants a service account is authorized to act on', TRUE, TRUE),
    ('SERVICE_ACCOUNT_TENANT_GRANT_MANAGE', 'SERVICE_ACCOUNT_TENANT_GRANT', 'MANAGE', 'Grant, suspend, revoke, and reactivate a service account''s tenant authorization', TRUE, TRUE)
ON CONFLICT (permission_code) DO UPDATE SET platform_only = TRUE;

COMMIT;
