-- Phase 2B: Product/Application registration (docs/PHASE_2B.md).
-- Purely additive — two new tables, four new permission codes, no existing
-- table's shape changes. Forward-only, idempotent (IF NOT EXISTS /
-- ON CONFLICT), safe to apply to an already-seeded database.

BEGIN;

CREATE TABLE IF NOT EXISTS product (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),

    name VARCHAR(200) NOT NULL,
    slug VARCHAR(50) NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_product_slug ON product(LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_product_status ON product(status);

DROP TRIGGER IF EXISTS trg_product_set_audit_fields ON product;
CREATE TRIGGER trg_product_set_audit_fields
    BEFORE UPDATE ON product
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

CREATE TABLE IF NOT EXISTS application (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    product_id UUID NOT NULL REFERENCES product(id) ON DELETE CASCADE,

    name VARCHAR(200) NOT NULL,

    client_id VARCHAR(64) NOT NULL,
    client_secret_hash TEXT,
    client_type VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL',
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',

    secret_created_at TIMESTAMPTZ,
    secret_revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_application_client_id UNIQUE (client_id),
    CONSTRAINT uk_application_product_name UNIQUE (product_id, name)
);
CREATE INDEX IF NOT EXISTS idx_application_product ON application(product_id);
CREATE INDEX IF NOT EXISTS idx_application_status ON application(status);

DROP TRIGGER IF EXISTS trg_application_set_audit_fields ON application;
CREATE TRIGGER trg_application_set_audit_fields
    BEFORE UPDATE ON application
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

-- New core permissions (platform-level — see database/seeds/001_permissions.sql's own comment).
INSERT INTO security_permission (permission_code, resource, action, description, is_system)
VALUES
    ('PRODUCT_VIEW',       'PRODUCT',      'VIEW',   'View registered products', TRUE),
    ('PRODUCT_MANAGE',     'PRODUCT',      'MANAGE', 'Register and manage products (platform-level)', TRUE),
    ('APPLICATION_VIEW',   'APPLICATION',  'VIEW',   'View registered applications (OAuth clients)', TRUE),
    ('APPLICATION_MANAGE', 'APPLICATION',  'MANAGE', 'Register and manage applications and their credentials (platform-level)', TRUE)
ON CONFLICT (permission_code) DO NOTHING;

-- Backfill SUPER_ADMIN (grants every permission) and re-affirm TENANT_ADMIN
-- does NOT get the four new platform-level codes — same idempotent
-- INSERT ... SELECT ... ON CONFLICT DO NOTHING pattern 002_system_roles.sql
-- already uses.
INSERT INTO security_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM security_role r
CROSS JOIN security_permission p
WHERE r.role_code = 'SUPER_ADMIN' AND r.tenant_id IS NULL AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL AND p.permission_code IN ('PRODUCT_VIEW', 'PRODUCT_MANAGE', 'APPLICATION_VIEW', 'APPLICATION_MANAGE')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
