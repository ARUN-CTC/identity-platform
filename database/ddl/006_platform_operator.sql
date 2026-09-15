-- Phase 2B.1 — the Platform Operator security boundary
-- (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, docs/adr/ADR-010-platform-operator-security-boundary.md).
--
-- Structurally separate from every tenant-scoped table: platform_operator,
-- platform_operator_permission, platform_operator_session, and
-- platform_operator_refresh_token carry NO tenant_id and have NO RLS —
-- platform authority is not, and must never become, a tenant-scoped grant
-- (the exact problem this phase fixes: SUPER_ADMIN's authority used to be
-- reachable only through a tenant_id-bearing security_user_role row).
--
-- No FK from platform_operator back into any tenant-scoped table other
-- than security_user (a global Identity, already tenant-free since
-- Phase 2A) — this is deliberate: nothing here should ever need to know
-- which tenant an operator happens to also have Memberships in, because it
-- must not have any bearing on their platform authority.

CREATE TABLE platform_operator (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES security_user(id) ON DELETE CASCADE,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | DISABLED

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX idx_platform_operator_status ON platform_operator(status);

CREATE TRIGGER trg_platform_operator_set_audit_fields
    BEFORE UPDATE ON platform_operator
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

-- Security invariant #7: the platform must never be left with zero ACTIVE
-- operators. Enforced here, not just in application code (Step 19/30) —
-- pg_advisory_xact_lock serializes concurrent status-changing transactions
-- on this table so two simultaneous "disable the last two active operators"
-- requests cannot both succeed (the second recomputes the count only after
-- the first has committed or rolled back).
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

CREATE TRIGGER trg_platform_operator_protect_last_active
    BEFORE UPDATE OR DELETE ON platform_operator
    FOR EACH ROW EXECUTE FUNCTION fn_protect_last_platform_operator();

-- Direct permission grants — deliberately no platform_role/platform_operator_role
-- intermediary (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, "Why direct grants,
-- not roles"): least-privilege, per-operator permission sets, no redundant
-- entity for what would today be a single meaningful "role" anyway.
CREATE TABLE platform_operator_permission (
    id            UUID PRIMARY KEY DEFAULT generate_uuid(),
    operator_id   UUID NOT NULL REFERENCES platform_operator(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES security_permission(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,

    CONSTRAINT uk_platform_operator_permission UNIQUE (operator_id, permission_id)
);
CREATE INDEX idx_platform_operator_permission_operator ON platform_operator_permission(operator_id);
CREATE INDEX idx_platform_operator_permission_permission ON platform_operator_permission(permission_id);

-- Platform Operator session/refresh-token pair — structurally mirrors
-- security_session/security_refresh_token, deliberately NOT reusing those
-- tables: a platform session has no tenant_id, ever, and security_session's
-- own RLS (apply_tenant_rls, NOT NULL tenant_id) would have to be weakened
-- to allow that, which would risk the tenant-session isolation model for
-- every existing caller. A separate table costs nothing and risks nothing.
CREATE TABLE platform_operator_session (
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
CREATE INDEX idx_platform_operator_session_operator ON platform_operator_session(operator_id);

CREATE TABLE platform_operator_refresh_token (
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
CREATE INDEX idx_platform_operator_refresh_token_session ON platform_operator_refresh_token(session_id);
CREATE INDEX idx_platform_operator_refresh_token_operator ON platform_operator_refresh_token(operator_id);

-- security_permission gains a platform_only flag (Security Invariant #1:
-- platform authority must never be reachable as an ordinary tenant-scoped
-- role grant). Enforced at the database level, not just by convention: a
-- trigger on security_role_permission rejects attaching a platform_only
-- permission to ANY tenant-scoped role, full stop.
ALTER TABLE security_permission ADD COLUMN platform_only BOOLEAN NOT NULL DEFAULT FALSE;

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

CREATE TRIGGER trg_security_role_permission_no_platform_only
    BEFORE INSERT OR UPDATE ON security_role_permission
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_platform_permission_on_role();

-- security_event gains a scope discriminator (Step 15: platform-level
-- events must be genuinely distinguishable from tenant events, not
-- fake-attributed to whichever tenant an admin happened to be signed into).
-- A PLATFORM-scope row has tenant_id NULL by construction and is writable
-- through the ordinary application connection (unlike the old
-- apply_tenant_rls_nullable policy, which only ever allowed a NULL
-- tenant_id to be *read*, never written, by the app role) — the new policy
-- below replaces that one for this table only.
ALTER TABLE security_event ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'TENANT';
CREATE INDEX idx_security_event_scope ON security_event(scope);

DROP POLICY IF EXISTS tenant_isolation ON security_event;
CREATE POLICY tenant_isolation ON security_event
    USING (scope = 'PLATFORM' OR tenant_id IS NULL OR tenant_id = current_tenant_id())
    WITH CHECK (
        (scope = 'PLATFORM' AND tenant_id IS NULL)
        OR (scope = 'TENANT' AND tenant_id = current_tenant_id())
    );
