-- Phase 2B.2: Product Entitlement (docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md,
-- docs/adr/ADR-011-product-entitlement-model.md). Purely additive — one new
-- table, two new permission codes, no existing table's shape changes.
-- Forward-only, idempotent, safe to apply to an already-seeded database.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_product_entitlement (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    product_id UUID NOT NULL REFERENCES product(id),

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_tenant_product_entitlement UNIQUE (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_product_entitlement_tenant ON tenant_product_entitlement(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_product_entitlement_product ON tenant_product_entitlement(product_id);
CREATE INDEX IF NOT EXISTS idx_tenant_product_entitlement_status ON tenant_product_entitlement(status);

DROP TRIGGER IF EXISTS trg_tenant_product_entitlement_set_audit_fields ON tenant_product_entitlement;
CREATE TRIGGER trg_tenant_product_entitlement_set_audit_fields
    BEFORE UPDATE ON tenant_product_entitlement
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

-- Idempotent: apply_tenant_rls() unconditionally creates a policy named
-- "tenant_isolation" — guard against re-running this migration against a
-- database that already has it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_product_entitlement' AND policyname = 'tenant_isolation'
    ) THEN
        CALL apply_tenant_rls('tenant_product_entitlement');
    END IF;
END
$$;

-- New platform-only permissions (see database/seeds/001_permissions.sql's
-- own comment on platform_only).
INSERT INTO security_permission (permission_code, resource, action, description, is_system, platform_only)
VALUES
    ('PRODUCT_ENTITLEMENT_VIEW',   'PRODUCT_ENTITLEMENT', 'VIEW',   'View tenant product entitlements', TRUE, TRUE),
    ('PRODUCT_ENTITLEMENT_MANAGE', 'PRODUCT_ENTITLEMENT', 'MANAGE', 'Create and change the lifecycle status of tenant product entitlements', TRUE, TRUE)
ON CONFLICT (permission_code) DO UPDATE SET platform_only = TRUE;

COMMIT;
