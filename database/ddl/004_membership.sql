-- Membership — the Identity <-> Organization link introduced in Phase 2A
-- (docs/PHASE_2A.md, docs/adr/ADR-002-tenant-organization-model.md).
-- security_user became a global Identity in 003_security.sql; this table is
-- what now represents "this user belongs to this organization (and,
-- transitively, this tenant)" — a fact that used to be implicit in
-- security_user.tenant_id.
--
-- tenant_id is denormalized from organization.tenant_id, purely so RLS and
-- tenant-scoped queries don't need a join — the same pattern
-- security_user_role already uses for the same reason.
--
-- No deleted_at/deleted_by/soft-delete trigger: a Membership's lifecycle is
-- fully expressed by `status` (INVITED -> ACTIVE <-> SUSPENDED -> REMOVED).
-- REMOVED is the terminal state — modeling it as a second, separate
-- soft-delete flag alongside status would let the two disagree with each
-- other for no benefit. Only the update-half of apply_standard_triggers()
-- is attached (below), not the procedure itself, since apply_standard_triggers()
-- also attaches a soft-delete-on-DELETE trigger that assumes a deleted_at
-- column this table deliberately doesn't have.
CREATE TABLE membership (
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

    -- A user has at most one Membership row per organization, ever — status
    -- transitions (including REMOVED -> re-invited) reuse the same row
    -- rather than accumulating duplicate historical rows. See
    -- docs/PHASE_2A.md, "Membership uniqueness" for why this is a plain
    -- unique constraint, not a partial one scoped by status.
    CONSTRAINT uk_membership_user_org UNIQUE (user_id, organization_id)
);
CREATE INDEX idx_membership_tenant ON membership(tenant_id);
CREATE INDEX idx_membership_org ON membership(organization_id);
CREATE INDEX idx_membership_user ON membership(user_id);
CREATE INDEX idx_membership_status ON membership(status);

CREATE TRIGGER trg_membership_set_audit_fields
    BEFORE UPDATE ON membership
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

CALL apply_tenant_rls('membership');
