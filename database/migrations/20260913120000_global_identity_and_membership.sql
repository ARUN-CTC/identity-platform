-- Phase 2A: global Identity + Membership model.
-- docs/PHASE_2A.md, docs/adr/ADR-002-tenant-organization-model.md
--
-- Forward-only, hand-reviewed, applied via database/scripts/migrate.sh
-- against an existing (already-seeded) Identity Platform database. Idempotent
-- where practical (IF NOT EXISTS / ON CONFLICT / conditional DROPs) so a
-- retried or partially-applied run doesn't error out. No production tenant
-- data exists anywhere yet (Phase 1/2 dev-only) — this migration is written
-- to be technically correct for a populated database regardless, but is
-- not being asked to solve production-scale backfill concerns.

BEGIN;

-- 1. Safety check: the new global email uniqueness must not silently drop
--    data. If any two *different* users already share an email across
--    tenants, stop here rather than let one of them win an arbitrary
--    ON CONFLICT/constraint race — see docs/PHASE_2A_ROLLBACK.md.
DO $$
DECLARE
    dupe_count INT;
BEGIN
    SELECT COUNT(*) INTO dupe_count FROM (
        SELECT email FROM security_user WHERE deleted_at IS NULL
        GROUP BY email HAVING COUNT(*) > 1
    ) d;
    IF dupe_count > 0 THEN
        RAISE EXCEPTION
            'Cannot migrate to global Identity: % email(s) are already shared by more than one security_user row. Resolve manually (merge or rename) before re-running this migration.',
            dupe_count;
    END IF;
END
$$;

-- 2. Create membership (idempotent — matches database/ddl/004_membership.sql).
CREATE TABLE IF NOT EXISTS membership (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_membership_user_org UNIQUE (user_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_membership_tenant ON membership(tenant_id);
CREATE INDEX IF NOT EXISTS idx_membership_org ON membership(organization_id);
CREATE INDEX IF NOT EXISTS idx_membership_user ON membership(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_status ON membership(status);

DROP TRIGGER IF EXISTS trg_membership_set_audit_fields ON membership;
CREATE TRIGGER trg_membership_set_audit_fields
    BEFORE UPDATE ON membership
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON membership;
CREATE POLICY tenant_isolation ON membership
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- 3. Backfill membership from every existing security_user_role grant row —
--    the only place "this user belongs to this org/tenant" was previously
--    implied. An org-scoped grant backfills a membership into exactly that
--    organization; a tenant-wide grant (organization_id IS NULL) backfills a
--    membership into every organization already in that tenant (the most
--    faithful available reading of "this user administers the whole
--    tenant" in a world where every tenant had at least one organization).
INSERT INTO membership (tenant_id, organization_id, user_id, status)
SELECT DISTINCT sur.tenant_id, sur.organization_id, sur.user_id, 'ACTIVE'
FROM security_user_role sur
WHERE sur.organization_id IS NOT NULL
ON CONFLICT (user_id, organization_id) DO NOTHING;

INSERT INTO membership (tenant_id, organization_id, user_id, status)
SELECT DISTINCT sur.tenant_id, o.id, sur.user_id, 'ACTIVE'
FROM security_user_role sur
JOIN organization o ON o.tenant_id = sur.tenant_id
WHERE sur.organization_id IS NULL
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- 4. security_user becomes a global Identity: drop RLS (a global row has no
--    single tenant_id to filter by — see docs/PHASE_2A.md, "Global Identity
--    RLS posture"), drop the old FK/unique/index, drop the column, add the
--    new global-uniqueness constraint.
DROP POLICY IF EXISTS tenant_isolation ON security_user;
ALTER TABLE security_user DISABLE ROW LEVEL SECURITY;
ALTER TABLE security_user NO FORCE ROW LEVEL SECURITY;

ALTER TABLE security_user DROP CONSTRAINT IF EXISTS uk_security_user_email;
DROP INDEX IF EXISTS idx_security_user_tenant;
ALTER TABLE security_user DROP CONSTRAINT IF EXISTS security_user_tenant_id_fkey;
ALTER TABLE security_user DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE security_user ADD CONSTRAINT uk_security_user_email UNIQUE (email);

-- 5. security_user_invitation_token gains organization_id. Backfilled from
--    the user's (now sole, per the safety check above and the fact that no
--    invitation flow has ever created a second one) tenant-wide membership,
--    falling back to any membership in the token's own tenant_id. Any row
--    that still can't be resolved blocks the migration rather than silently
--    guessing — see docs/PHASE_2A_ROLLBACK.md.
ALTER TABLE security_user_invitation_token ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE security_user_invitation_token t
SET organization_id = m.organization_id
FROM membership m
WHERE t.organization_id IS NULL
  AND m.user_id = t.user_id
  AND m.tenant_id = t.tenant_id;

DO $$
DECLARE
    unresolved INT;
BEGIN
    SELECT COUNT(*) INTO unresolved FROM security_user_invitation_token WHERE organization_id IS NULL;
    IF unresolved > 0 THEN
        RAISE EXCEPTION
            '% security_user_invitation_token row(s) could not be backfilled with an organization_id — resolve manually before re-running this migration.',
            unresolved;
    END IF;
END
$$;

ALTER TABLE security_user_invitation_token ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE security_user_invitation_token
    ADD CONSTRAINT security_user_invitation_token_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_security_user_invitation_token_org ON security_user_invitation_token(organization_id);

COMMIT;
