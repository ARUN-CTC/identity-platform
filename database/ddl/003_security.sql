-- Security (IAM) domain — see database/prisma/schema/security.prisma.
-- Copied near-verbatim from TravelOS (packages/database/domains/security/ddl),
-- classified REUSABLE. See docs/IDENTITY_SOURCE_INVENTORY.md.
--
-- PHASE 2A (docs/PHASE_2A.md, ADR-002): security_user became a global
-- Identity — no tenant_id column any more, email is globally unique. Its
-- relationship to a tenant/organization is exclusively through the
-- `membership` table (created further down this file). Deliberately no RLS
-- on this table: RLS here is a tenant_id-column mechanism
-- (database/shared/002_functions.sql), and a global identity has no single
-- tenant_id to filter by — exactly the same reasoning security_permission
-- already documents for itself ("global catalog ... no RLS"), just for
-- identity rows instead of permission rows. Tenant-boundary enforcement for
-- *who can see which users* moves to the application layer, joined through
-- membership (see UsersRepository) — see docs/PHASE_2A.md, "Global Identity
-- RLS posture" for the full reasoning and its tested consequences.
CREATE TABLE security_user (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),

    email VARCHAR(255) NOT NULL,
    username VARCHAR(50),

    password_hash TEXT,
    password_changed_at TIMESTAMPTZ,

    first_name VARCHAR(100),
    last_name VARCHAR(100),

    status VARCHAR(30) NOT NULL DEFAULT 'PROVISIONED',

    email_verified_at TIMESTAMPTZ,
    failed_login_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_security_user_email UNIQUE (email)
);
CALL apply_standard_triggers('security_user');

CREATE TABLE security_role (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID REFERENCES tenant(id),

    role_code VARCHAR(100) NOT NULL,
    role_name VARCHAR(200) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
-- Two partial unique indexes, not one plain composite index: a plain
-- UNIQUE(tenant_id, role_code) would NOT actually enforce "one SUPER_ADMIN
-- platform-wide" — Postgres treats every NULL tenant_id as distinct from
-- every other NULL for uniqueness purposes, so nothing would stop two
-- system-role rows both named SUPER_ADMIN. System role templates
-- (tenant_id IS NULL) are unique by role_code across the whole platform; a
-- tenant's own custom roles are unique by (tenant_id, role_code).
CREATE UNIQUE INDEX uk_security_role_system_code ON security_role(role_code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX uk_security_role_tenant_code ON security_role(tenant_id, role_code) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_security_role_tenant ON security_role(tenant_id);
CALL apply_standard_triggers('security_role');
CALL apply_tenant_rls_nullable('security_role');

CREATE TABLE security_permission (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    permission_code VARCHAR(100) NOT NULL UNIQUE,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX idx_security_permission_resource ON security_permission(resource);
CALL apply_standard_triggers('security_permission');
-- Global catalog, no tenant_id column — no RLS.

CREATE TABLE security_role_permission (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    role_id UUID NOT NULL REFERENCES security_role(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES security_permission(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT uk_security_role_permission UNIQUE (role_id, permission_id)
);
CREATE INDEX idx_security_role_permission_role ON security_role_permission(role_id);
CREATE INDEX idx_security_role_permission_permission ON security_role_permission(permission_id);
-- No tenant_id column (role_id already carries tenant scoping transitively) — no RLS.

-- PHASE 2A: user_id now references a global Identity. This row no longer by
-- itself proves "user_id belongs to tenant_id" — a grant is only effective
-- when the user also holds an ACTIVE membership row covering tenant_id (for
-- a tenant-wide grant, organization_id NULL here) or this exact
-- organization_id. Enforced in application code (UserRolesRepository),
-- documented as a known limitation in docs/PHASE_2A.md rather than a second
-- DB-level check, to avoid duplicating the same invariant in two places.
CREATE TABLE security_user_role (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),

    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES security_role(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organization(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT uk_security_user_role UNIQUE (user_id, role_id, organization_id)
);
CREATE INDEX idx_security_user_role_tenant ON security_user_role(tenant_id);
CREATE INDEX idx_security_user_role_user ON security_user_role(user_id);
CREATE INDEX idx_security_user_role_role ON security_user_role(role_id);
CREATE INDEX idx_security_user_role_organization ON security_user_role(organization_id);
CALL apply_tenant_rls('security_user_role');

CREATE TABLE security_session (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organization(id) ON DELETE SET NULL,

    device_info TEXT,
    ip_address VARCHAR(64),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,

    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(100),

    remember_me BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_security_session_tenant ON security_session(tenant_id);
CREATE INDEX idx_security_session_user ON security_session(user_id);
CREATE INDEX idx_security_session_organization ON security_session(organization_id);
CALL apply_tenant_rls('security_session');

CREATE TABLE security_refresh_token (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    session_id UUID NOT NULL REFERENCES security_session(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,

    token_hash TEXT NOT NULL UNIQUE,

    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    rotated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    replaced_by_id UUID UNIQUE REFERENCES security_refresh_token(id)
);
CREATE INDEX idx_security_refresh_token_tenant ON security_refresh_token(tenant_id);
CREATE INDEX idx_security_refresh_token_session ON security_refresh_token(session_id);
CREATE INDEX idx_security_refresh_token_user ON security_refresh_token(user_id);
CALL apply_tenant_rls('security_refresh_token');

CREATE TABLE security_password_reset_token (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,

    token_hash TEXT NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);
CREATE INDEX idx_security_password_reset_token_tenant ON security_password_reset_token(tenant_id);
CREATE INDEX idx_security_password_reset_token_user ON security_password_reset_token(user_id);
CALL apply_tenant_rls('security_password_reset_token');

-- PHASE 2A: organization_id (required) — an invitation onboards a global
-- Identity into one specific Organization's Membership, not "into a tenant"
-- in the abstract. See docs/PHASE_2A.md.
CREATE TABLE security_user_invitation_token (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

    token_hash TEXT NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);
CREATE INDEX idx_security_user_invitation_token_tenant ON security_user_invitation_token(tenant_id);
CREATE INDEX idx_security_user_invitation_token_user ON security_user_invitation_token(user_id);
CREATE INDEX idx_security_user_invitation_token_org ON security_user_invitation_token(organization_id);
CALL apply_tenant_rls('security_user_invitation_token');

CREATE TABLE security_login_attempt (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID REFERENCES tenant(id),
    user_id UUID REFERENCES security_user(id),

    identifier VARCHAR(255) NOT NULL,
    success BOOLEAN NOT NULL,
    failure_reason VARCHAR(100),

    ip_address VARCHAR(64),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_security_login_attempt_tenant ON security_login_attempt(tenant_id);
CREATE INDEX idx_security_login_attempt_identifier ON security_login_attempt(identifier, created_at);
CREATE INDEX idx_security_login_attempt_ip ON security_login_attempt(ip_address, created_at);
CALL apply_tenant_rls_nullable('security_login_attempt');

CREATE TABLE security_event (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID REFERENCES tenant(id),
    actor_user_id UUID REFERENCES security_user(id),

    event_type VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,

    metadata JSONB,
    ip_address VARCHAR(64),
    user_agent TEXT,
    correlation_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_security_event_tenant ON security_event(tenant_id);
CREATE INDEX idx_security_event_actor ON security_event(actor_user_id);
CREATE INDEX idx_security_event_type ON security_event(event_type, created_at);
CALL apply_tenant_rls_nullable('security_event');
