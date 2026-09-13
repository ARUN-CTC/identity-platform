-- Core reusable database functions/procedures. Copied near-verbatim from
-- TravelOS's shared layer (packages/database/shared/functions/,
-- shared/triggers/, shared/policies/) — classified REUSABLE, the single
-- most valuable architectural asset extracted in Phase 1. See
-- docs/IDENTITY_SOURCE_INVENTORY.md.

-- Single point of control for primary-key UUID generation.
CREATE OR REPLACE FUNCTION generate_uuid()
RETURNS UUID
LANGUAGE SQL
AS $$
    SELECT uuid_generate_v4();
$$;

-- Multi-tenant isolation via Postgres Row-Level Security. The application
-- sets two session-local GUCs per connection/transaction before running
-- queries:
--   SELECT set_config('app.current_tenant_id', '<uuid>', true);
--   SELECT set_config('app.current_user_id', '<uuid>', true);
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
$$;

CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$;

-- Attaches the standard tenant-isolation RLS policy to any table with a
-- NOT NULL tenant_id column.
CREATE OR REPLACE PROCEDURE apply_tenant_rls(p_table_name TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p_table_name);

    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
            USING (tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id())',
        p_table_name
    );
END;
$$;

-- Variant for tables where tenant_id is nullable and NULL represents a
-- platform-wide row every tenant may read (e.g. a system role template).
-- Read access: NULL-tenant rows or the caller's own tenant. Write access:
-- only the caller's own tenant's rows — NULL-tenant rows are expected to be
-- seeded/managed out of band, not written by ordinary application requests.
CREATE OR REPLACE PROCEDURE apply_tenant_rls_nullable(p_table_name TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p_table_name);

    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
            USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
            WITH CHECK (tenant_id = current_tenant_id())',
        p_table_name
    );
END;
$$;

-- Keeps updated_at/version in sync on UPDATE.
CREATE OR REPLACE FUNCTION fn_set_audit_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    NEW.version := COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$;

-- Rewrites a DELETE into an UPDATE setting deleted_at/deleted_by, so
-- accidental hard deletes can't bypass the soft-delete convention.
CREATE OR REPLACE FUNCTION fn_enforce_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE format(
        'UPDATE %I SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2',
        TG_TABLE_NAME
    )
    USING current_setting('app.current_user_id', true)::UUID, OLD.id;

    RETURN NULL;
END;
$$;

-- Attaches the standard trigger set (audit fields + soft-delete
-- enforcement) to a table carrying the standard created_at/updated_at/
-- deleted_at/deleted_by/version columns.
-- Usage, after CREATE TABLE: CALL apply_standard_triggers('security_user');
CREATE OR REPLACE PROCEDURE apply_standard_triggers(p_table_name TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_set_audit_fields ON %1$I', p_table_name);
    EXECUTE format(
        'CREATE TRIGGER trg_%1$s_set_audit_fields
            BEFORE UPDATE ON %1$I
            FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields()',
        p_table_name
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_soft_delete ON %1$I', p_table_name);
    EXECUTE format(
        'CREATE TRIGGER trg_%1$s_soft_delete
            BEFORE DELETE ON %1$I
            FOR EACH ROW EXECUTE FUNCTION fn_enforce_soft_delete()',
        p_table_name
    );
END;
$$;
