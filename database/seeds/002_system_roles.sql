-- System role templates (tenant_id NULL) — shared across every tenant via
-- apply_tenant_rls_nullable(), assignable through security_user_role.
--
-- Role names changed from TravelOS's own (SUPER_ADMIN/TENANT_ADMIN/AGENT):
-- AGENT was TravelOS's own operational-tier naming (a travel agency's
-- day-to-day staff), not a generic identity concept. Replaced with MEMBER —
-- see docs/TRAVELOS_COUPLING.md, "B. REFACTOR REQUIRED". SUPER_ADMIN/
-- TENANT_ADMIN are already product-neutral and unchanged.
-- PHASE 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md, ADR-010): SUPER_ADMIN
-- is no longer where platform-level authority lives — that's
-- platform_operator_permission now, granted independently of any tenant.
-- SUPER_ADMIN remains a legitimate, very broad TENANT-scoped role (every
-- non-platform-only permission), kept rather than deleted/renamed so any
-- existing tenant-scoped assignment of it keeps working exactly as before
-- for tenant-level permissions — see the migration for how existing
-- SUPER_ADMIN holders are additionally granted real Platform Operator
-- status.
INSERT INTO security_role (tenant_id, role_code, role_name, description, is_system)
VALUES
    (NULL, 'SUPER_ADMIN',  'Super Administrator', 'Full administrative access within a tenant — does NOT grant platform-level authority; see Platform Operator (docs/PLATFORM_OPERATOR_ARCHITECTURE.md)', TRUE),
    (NULL, 'TENANT_ADMIN', 'Tenant Administrator', 'Manages users, roles, and configuration within one tenant', TRUE),
    (NULL, 'MEMBER',       'Member', 'Standard tenant member with no administrative access by default', TRUE)
ON CONFLICT (role_code) WHERE tenant_id IS NULL DO NOTHING;

-- SUPER_ADMIN: every permission in the catalog EXCEPT platform_only ones —
-- trg_security_role_permission_no_platform_only would reject the excluded
-- ones anyway; the AND clause here just avoids relying on that trigger to
-- silently no-op what would otherwise look like an error during seeding.
INSERT INTO security_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM security_role r
CROSS JOIN security_permission p
WHERE r.role_code = 'SUPER_ADMIN' AND r.tenant_id IS NULL AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL AND p.platform_only = FALSE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- TENANT_ADMIN: everything except TENANT_MANAGE (tenant lifecycle stays a
-- platform-operator action) and every platform_only code (excluded for the
-- same reason SUPER_ADMIN excludes them above).
INSERT INTO security_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM security_role r
CROSS JOIN security_permission p
WHERE r.role_code = 'TENANT_ADMIN' AND r.tenant_id IS NULL AND r.deleted_at IS NULL
  AND p.deleted_at IS NULL AND p.platform_only = FALSE
  AND p.permission_code <> 'TENANT_MANAGE'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- MEMBER: no grants by default. A product built on this platform seeds its
-- own least-privilege grants for its own operational role(s), the same way
-- every TravelOS product domain seeds AGENT's own TRAVEL_* grants
-- separately from this file.
