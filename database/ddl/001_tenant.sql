-- Tenant — see database/prisma/schema/tenant.prisma for the model this
-- mirrors and docs/TRAVELOS_COUPLING.md for why this is a rewrite, not a
-- copy, of TravelOS's own tenant table.

CREATE TABLE tenant (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),

    tenant_code VARCHAR(30) NOT NULL UNIQUE,
    tenant_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(200),
    email VARCHAR(255),
    phone VARCHAR(30),
    status VARCHAR(30) NOT NULL DEFAULT 'PROVISIONING',

    activated_at TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);

CREATE INDEX idx_tenant_status ON tenant(status);

CALL apply_standard_triggers('tenant');
-- Tenant itself has no tenant_id column (it IS the tenant boundary) — no RLS applied.
