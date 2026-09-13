-- System role templates (tenant_id NULL) — shared across every tenant via
-- apply_tenant_rls_nullable(), assignable through security_user_role.
--
-- Role names changed from TravelOS's own (SUPER_ADMIN/TENANT_ADMIN/AGENT):
-- AGENT was TravelOS's own operational-tier naming (a travel agency's
-- day-to-day staff), not a generic identity concept. Replaced with MEMBER —
-- see docs/TRAVELOS_COUPLING.md, "B. REFACTOR REQUIRED". SUPER_ADMIN/
-- TENANT_ADMIN are already product-neutral and unchanged.
INSERT INTO security_role (tenant_id, role_code, role_name, description, is_system)
VALUES
    (NULL, 'SUPER_ADMIN',  'Super Administrator', 'Full platform-level access across every tenant', TRUE),
    (NULL, 'TENANT_ADMIN', 'Tenant Administrator', 'Manages users, roles, and configuration within one tenant', TRUE),
    (NULL, 'MEMBER',       'Member', 'Standard tenant member with no administrative access by default', TRUE)
ON CONFLICT (role_code) WHERE tenant_id IS NULL DO NOTHING;

-- SUPER_ADMIN: every permission in the catalog.
INSERT INTO security_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM security_role r
CROSS JOIN security_permission p
WHERE r.role_code = 'SUPER_ADMIN' AND r.tenant_id IS NULL AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- TENANT_ADMIN: everything except the platform-level TENANT_MANAGE grant —
-- tenant lifecycle itself stays a platform-operator action, not something a
-- tenant's own admin can grant themselves. Mirrors the same reasoning
-- TravelOS's own seed documents (packages/database/domains/security/seeds/002_system_roles.sql).
INSERT INTO security_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM security_role r
CROSS JOIN security_permission p
WHERE r.role_code = 'TENANT_ADMIN' AND r.tenant_id IS NULL AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL AND p.permission_code <> 'TENANT_MANAGE'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- MEMBER: no grants by default. A product built on this platform seeds its
-- own least-privilege grants for its own operational role(s), the same way
-- every TravelOS product domain seeds AGENT's own TRAVEL_* grants
-- separately from this file.
