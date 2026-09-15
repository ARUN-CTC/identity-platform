-- Phase 2B.1: the Platform Operator security boundary
-- (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, docs/adr/ADR-010-platform-operator-security-boundary.md).
-- Forward-only, hand-reviewed, applied via database/scripts/migrate.sh
-- against an existing (already-seeded) Phase 2B database. Idempotent where
-- practical. Includes the SUPER_ADMIN -> Platform Operator data migration
-- (Step 7): every existing SUPER_ADMIN holder becomes a real Platform
-- Operator, with every current platform-only permission granted, so no
-- existing administrator loses access as a result of this migration.

BEGIN;

-- 1. New tables (idempotent — matches database/ddl/006_platform_operator.sql).
CREATE TABLE IF NOT EXISTS platform_operator (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES security_user(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_platform_operator_status ON platform_operator(status);

DROP TRIGGER IF EXISTS trg_platform_operator_set_audit_fields ON platform_operator;
CREATE TRIGGER trg_platform_operator_set_audit_fields
    BEFORE UPDATE ON platform_operator
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

CREATE OR REPLACE FUNCTION fn_protect_last_platform_operator()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    remaining_active INT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('platform_operator_active_count'));

    IF TG_OP = 'DELETE' THEN
        SELECT COUNT(*) INTO remaining_active FROM platform_operator WHERE status = 'ACTIVE' AND id <> OLD.id;
        IF OLD.status = 'ACTIVE' AND remaining_active = 0 THEN
            RAISE EXCEPTION 'Cannot remove the final active Platform Operator.';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE' THEN
        SELECT COUNT(*) INTO remaining_active FROM platform_operator WHERE status = 'ACTIVE' AND id <> NEW.id;
        IF remaining_active = 0 THEN
            RAISE EXCEPTION 'Cannot disable the final active Platform Operator.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_operator_protect_last_active ON platform_operator;
CREATE TRIGGER trg_platform_operator_protect_last_active
    BEFORE UPDATE OR DELETE ON platform_operator
    FOR EACH ROW EXECUTE FUNCTION fn_protect_last_platform_operator();

CREATE TABLE IF NOT EXISTS platform_operator_permission (
    id            UUID PRIMARY KEY DEFAULT generate_uuid(),
    operator_id   UUID NOT NULL REFERENCES platform_operator(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES security_permission(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT uk_platform_operator_permission UNIQUE (operator_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_operator_permission_operator ON platform_operator_permission(operator_id);
CREATE INDEX IF NOT EXISTS idx_platform_operator_permission_permission ON platform_operator_permission(permission_id);

CREATE TABLE IF NOT EXISTS platform_operator_session (
    id          UUID PRIMARY KEY DEFAULT generate_uuid(),
    operator_id UUID NOT NULL REFERENCES platform_operator(id) ON DELETE CASCADE,
    device_info TEXT,
    ip_address  VARCHAR(64),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    revoked_reason VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_platform_operator_session_operator ON platform_operator_session(operator_id);

CREATE TABLE IF NOT EXISTS platform_operator_refresh_token (
    id          UUID PRIMARY KEY DEFAULT generate_uuid(),
    session_id  UUID NOT NULL REFERENCES platform_operator_session(id) ON DELETE CASCADE,
    operator_id UUID NOT NULL REFERENCES platform_operator(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    rotated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    replaced_by_id UUID UNIQUE REFERENCES platform_operator_refresh_token(id)
);
CREATE INDEX IF NOT EXISTS idx_platform_operator_refresh_token_session ON platform_operator_refresh_token(session_id);
CREATE INDEX IF NOT EXISTS idx_platform_operator_refresh_token_operator ON platform_operator_refresh_token(operator_id);

-- 2. security_permission.platform_only + the DB-level "never on a tenant role" guard.
ALTER TABLE security_permission ADD COLUMN IF NOT EXISTS platform_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION fn_prevent_platform_permission_on_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM security_permission WHERE id = NEW.permission_id AND platform_only = TRUE) THEN
        RAISE EXCEPTION 'Permission % is platform-only and cannot be granted to a tenant-scoped role — use platform_operator_permission instead.', NEW.permission_id;
    END IF;
    RETURN NEW;
END;
$$;

-- Mark the four Phase 2B codes platform_only BEFORE creating the trigger,
-- and BEFORE cleaning up existing role grants below — the trigger only
-- fires on new INSERT/UPDATE, so it doesn't retroactively invalidate rows
-- already present; the explicit DELETE further below does that part.
UPDATE security_permission
SET platform_only = TRUE
WHERE permission_code IN ('PRODUCT_VIEW', 'PRODUCT_MANAGE', 'APPLICATION_VIEW', 'APPLICATION_MANAGE');

INSERT INTO security_permission (permission_code, resource, action, description, is_system, platform_only)
VALUES
    ('PLATFORM_OPERATOR_VIEW',  'PLATFORM_OPERATOR','VIEW',   'View Platform Operator records', TRUE, TRUE),
    ('PLATFORM_OPERATOR_MANAGE','PLATFORM_OPERATOR','MANAGE', 'Create, disable, reactivate Platform Operators and grant/revoke their platform permissions', TRUE, TRUE),
    ('PLATFORM_SECURITY_VIEW',  'PLATFORM_SECURITY','VIEW',   'View platform-scoped security/audit events', TRUE, TRUE)
ON CONFLICT (permission_code) DO UPDATE SET platform_only = TRUE;

DROP TRIGGER IF EXISTS trg_security_role_permission_no_platform_only ON security_role_permission;
CREATE TRIGGER trg_security_role_permission_no_platform_only
    BEFORE INSERT OR UPDATE ON security_role_permission
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_platform_permission_on_role();

-- Remove platform_only permissions from every existing tenant-scoped role
-- grant (SUPER_ADMIN's original "every permission" seed, chiefly) — the new
-- trigger only blocks *future* grants; this cleans up what's already there
-- so a tenant role's own permission list is no longer misleading about
-- what it actually still grants (see docs/PHASE_2B.md's Known Issues,
-- resolved here).
DELETE FROM security_role_permission srp
USING security_permission p
WHERE srp.permission_id = p.id AND p.platform_only = TRUE;

UPDATE security_role
SET description = 'Full administrative access within a tenant — does NOT grant platform-level authority; see Platform Operator (docs/PLATFORM_OPERATOR_ARCHITECTURE.md)'
WHERE role_code = 'SUPER_ADMIN' AND tenant_id IS NULL;

-- 3. security_event.scope + the corrected RLS policy.
ALTER TABLE security_event ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'TENANT';
CREATE INDEX IF NOT EXISTS idx_security_event_scope ON security_event(scope);

DROP POLICY IF EXISTS tenant_isolation ON security_event;
CREATE POLICY tenant_isolation ON security_event
    USING (scope = 'PLATFORM' OR tenant_id IS NULL OR tenant_id = current_tenant_id())
    WITH CHECK (
        (scope = 'PLATFORM' AND tenant_id IS NULL)
        OR (scope = 'TENANT' AND tenant_id = current_tenant_id())
    );

-- 4. Data migration: every existing SUPER_ADMIN holder becomes a real
-- Platform Operator, granted every platform_only permission that exists
-- today — see docs/adr/ADR-010-platform-operator-security-boundary.md,
-- "SUPER_ADMIN migration" for why this is the chosen (not merely one of
-- several equally-valid) strategy.
INSERT INTO platform_operator (user_id, status)
SELECT DISTINCT sur.user_id, 'ACTIVE'
FROM security_user_role sur
JOIN security_role r ON r.id = sur.role_id
WHERE r.role_code = 'SUPER_ADMIN' AND r.tenant_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO platform_operator_permission (operator_id, permission_id)
SELECT po.id, p.id
FROM platform_operator po
JOIN security_user_role sur ON sur.user_id = po.user_id
JOIN security_role r ON r.id = sur.role_id AND r.role_code = 'SUPER_ADMIN' AND r.tenant_id IS NULL
CROSS JOIN security_permission p
WHERE p.platform_only = TRUE
ON CONFLICT (operator_id, permission_id) DO NOTHING;

COMMIT;
