-- Organization domain — see database/prisma/schema/organization.prisma.
-- Trimmed from TravelOS: no currency/language/timezone FKs, no cost
-- center/working-hours/holiday-calendar relations. See
-- docs/TRAVELOS_COUPLING.md.

CREATE TABLE organization_type (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    type_code VARCHAR(50) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX idx_org_type_name ON organization_type(type_name);
CALL apply_standard_triggers('organization_type');

CREATE TABLE organization (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    organization_type_id UUID NOT NULL REFERENCES organization_type(id),
    organization_code VARCHAR(30) NOT NULL,
    organization_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(200),
    email VARCHAR(255),
    phone VARCHAR(30),
    website VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    remarks TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_org_code UNIQUE (tenant_id, organization_code)
);
CREATE INDEX idx_org_tenant ON organization(tenant_id);
CREATE INDEX idx_org_type ON organization(organization_type_id);
CREATE INDEX idx_org_status ON organization(status);
CALL apply_standard_triggers('organization');
CALL apply_tenant_rls('organization');

CREATE TABLE organization_unit_type (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    type_code VARCHAR(50) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL,
    hierarchy_level INT NOT NULL,
    allow_children BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX idx_org_unit_type_level ON organization_unit_type(hierarchy_level);
CALL apply_standard_triggers('organization_unit_type');

CREATE TABLE organization_unit (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    organization_unit_type_id UUID NOT NULL REFERENCES organization_unit_type(id),
    unit_code VARCHAR(30) NOT NULL,
    unit_name VARCHAR(200) NOT NULL,
    description TEXT,
    manager_user_id UUID,
    parent_unit_id UUID REFERENCES organization_unit(id),
    email VARCHAR(255),
    phone VARCHAR(30),
    display_order INT NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    remarks TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_unit_code UNIQUE (organization_id, unit_code)
);
CREATE INDEX idx_unit_tenant ON organization_unit(tenant_id);
CREATE INDEX idx_unit_org ON organization_unit(organization_id);
CREATE INDEX idx_unit_type ON organization_unit(organization_unit_type_id);
CREATE INDEX idx_unit_parent ON organization_unit(parent_unit_id);
CREATE INDEX idx_unit_manager ON organization_unit(manager_user_id);
CREATE INDEX idx_unit_status ON organization_unit(status);
CALL apply_standard_triggers('organization_unit');
CALL apply_tenant_rls('organization_unit');

-- Closure table for the organization_unit hierarchy — composite PK, no surrogate id.
CREATE TABLE organization_unit_hierarchy (
    ancestor_unit_id UUID NOT NULL REFERENCES organization_unit(id) ON DELETE CASCADE,
    descendant_unit_id UUID NOT NULL REFERENCES organization_unit(id) ON DELETE CASCADE,
    hierarchy_depth INT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenant(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_org_hierarchy PRIMARY KEY (ancestor_unit_id, descendant_unit_id)
);
CREATE INDEX idx_hierarchy_descendant ON organization_unit_hierarchy(descendant_unit_id);
CREATE INDEX idx_hierarchy_depth ON organization_unit_hierarchy(hierarchy_depth);
CREATE INDEX idx_hierarchy_tenant ON organization_unit_hierarchy(tenant_id);
CALL apply_tenant_rls('organization_unit_hierarchy');
