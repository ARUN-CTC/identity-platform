-- Minimal, product-agnostic permission catalog. Trimmed from TravelOS's own
-- catalog (packages/database/domains/security/seeds/001_permissions.sql +
-- per-domain grants scattered across the whole product) down to the codes
-- that have nothing to do with travel/booking/communications — see
-- docs/IDENTITY_SOURCE_INVENTORY.md, "B. REFACTOR REQUIRED".

INSERT INTO security_permission (permission_code, resource, action, description, is_system)
VALUES
    ('TENANT_MANAGE',      'TENANT',       'MANAGE', 'Manage tenant lifecycle and configuration', TRUE),
    ('USER_VIEW',          'USER',         'VIEW',   'View users within the tenant', TRUE),
    ('USER_MANAGE',        'USER',         'MANAGE', 'Create, update, deactivate users', TRUE),
    ('ROLE_VIEW',          'ROLE',         'VIEW',   'View roles', TRUE),
    ('ROLE_MANAGE',        'ROLE',         'MANAGE', 'Create, update, delete roles and assign permissions', TRUE),
    ('PERMISSION_VIEW',    'PERMISSION',   'VIEW',   'View the permission catalog', TRUE),
    ('SESSION_MANAGE',     'SESSION',      'MANAGE', 'View and revoke sessions', TRUE),
    ('ORGANIZATION_MANAGE','ORGANIZATION', 'MANAGE', 'Manage organizations and organization units', TRUE),
    ('SECURITY_AUDIT_VIEW','SECURITY_AUDIT','VIEW',  'View security/audit events and login attempts', TRUE)
ON CONFLICT (permission_code) DO NOTHING;
