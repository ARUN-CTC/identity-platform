-- Minimal, product-agnostic permission catalog. Trimmed from TravelOS's own
-- catalog (packages/database/domains/security/seeds/001_permissions.sql +
-- per-domain grants scattered across the whole product) down to the codes
-- that have nothing to do with travel/booking/communications — see
-- docs/IDENTITY_SOURCE_INVENTORY.md, "B. REFACTOR REQUIRED".

INSERT INTO security_permission (permission_code, resource, action, description, is_system, platform_only)
VALUES
    ('TENANT_MANAGE',      'TENANT',       'MANAGE', 'Manage tenant lifecycle and configuration', TRUE, FALSE),
    ('USER_VIEW',          'USER',         'VIEW',   'View users within the tenant', TRUE, FALSE),
    ('USER_MANAGE',        'USER',         'MANAGE', 'Create, update, deactivate users', TRUE, FALSE),
    ('ROLE_VIEW',          'ROLE',         'VIEW',   'View roles', TRUE, FALSE),
    ('ROLE_MANAGE',        'ROLE',         'MANAGE', 'Create, update, delete roles and assign permissions', TRUE, FALSE),
    ('PERMISSION_VIEW',    'PERMISSION',   'VIEW',   'View the permission catalog', TRUE, FALSE),
    ('SESSION_MANAGE',     'SESSION',      'MANAGE', 'View and revoke sessions', TRUE, FALSE),
    ('ORGANIZATION_MANAGE','ORGANIZATION', 'MANAGE', 'Manage organizations and organization units', TRUE, FALSE),
    ('SECURITY_AUDIT_VIEW','SECURITY_AUDIT','VIEW',  'View security/audit events and login attempts', TRUE, FALSE),
    -- Phase 2B.1 (docs/PLATFORM_OPERATOR_ARCHITECTURE.md): platform_only = TRUE
    -- for every code below — none of these may ever be granted to a
    -- tenant-scoped Role (enforced by trg_security_role_permission_no_platform_only,
    -- database/ddl/006_platform_operator.sql), only via
    -- platform_operator_permission to a Platform Operator.
    ('PRODUCT_VIEW',            'PRODUCT',          'VIEW',   'View registered products', TRUE, TRUE),
    ('PRODUCT_MANAGE',          'PRODUCT',          'MANAGE', 'Register and manage products (platform-level)', TRUE, TRUE),
    ('APPLICATION_VIEW',        'APPLICATION',      'VIEW',   'View registered applications (OAuth clients)', TRUE, TRUE),
    ('APPLICATION_MANAGE',      'APPLICATION',      'MANAGE', 'Register and manage applications and their credentials (platform-level)', TRUE, TRUE),
    ('PLATFORM_OPERATOR_VIEW',  'PLATFORM_OPERATOR','VIEW',   'View Platform Operator records', TRUE, TRUE),
    ('PLATFORM_OPERATOR_MANAGE','PLATFORM_OPERATOR','MANAGE', 'Create, disable, reactivate Platform Operators and grant/revoke their platform permissions', TRUE, TRUE),
    ('PLATFORM_SECURITY_VIEW',  'PLATFORM_SECURITY','VIEW',   'View platform-scoped security/audit events', TRUE, TRUE),
    -- Phase 2B.2 (docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md): which tenants
    -- may use which products is a platform-level decision, same class as
    -- Product/Application registration itself — never a tenant's own
    -- self-service action (Security Invariant #13).
    ('PRODUCT_ENTITLEMENT_VIEW',  'PRODUCT_ENTITLEMENT', 'VIEW',   'View tenant product entitlements', TRUE, TRUE),
    ('PRODUCT_ENTITLEMENT_MANAGE','PRODUCT_ENTITLEMENT', 'MANAGE', 'Create and change the lifecycle status of tenant product entitlements', TRUE, TRUE),
    -- Phase 2D.3 (docs/SERVICE_AUTHENTICATION_ARCHITECTURE.md): machine
    -- identities and their tenant authorization are platform-level
    -- administration, same class as everything else in this block — never
    -- a tenant's own self-service action.
    ('SERVICE_ACCOUNT_VIEW',               'SERVICE_ACCOUNT',              'VIEW',   'View registered service accounts (machine principals)', TRUE, TRUE),
    ('SERVICE_ACCOUNT_MANAGE',             'SERVICE_ACCOUNT',              'MANAGE', 'Register and manage service accounts and their credentials (platform-level)', TRUE, TRUE),
    ('SERVICE_ACCOUNT_TENANT_GRANT_VIEW',   'SERVICE_ACCOUNT_TENANT_GRANT', 'VIEW',   'View which tenants a service account is authorized to act on', TRUE, TRUE),
    ('SERVICE_ACCOUNT_TENANT_GRANT_MANAGE', 'SERVICE_ACCOUNT_TENANT_GRANT', 'MANAGE', 'Grant, suspend, revoke, and reactivate a service account''s tenant authorization', TRUE, TRUE),
    -- Phase 2D (tenant registry security remediation —
    -- tenant-manage-unscoped-registry-vulnerability): the tenant REGISTRY
    -- (list every tenant, read/update/activate/suspend/delete ANY tenant by
    -- id) is a platform-level administration surface, same class as every
    -- other block above — never a tenant's own self-service action.
    -- TENANT_MANAGE (above, platform_only = FALSE) remains tenant-grantable
    -- but now gates ONLY `/tenants/me` (the caller's own tenant, resolved
    -- from their own auth context) — it can no longer reach any other
    -- tenant's record through any route.
    ('PLATFORM_TENANT_VIEW',   'PLATFORM_TENANT', 'VIEW',   'View any tenant in the platform-wide tenant registry', TRUE, TRUE),
    ('PLATFORM_TENANT_MANAGE', 'PLATFORM_TENANT', 'MANAGE', 'Create, update, and change the lifecycle status of any tenant in the platform-wide tenant registry', TRUE, TRUE)
ON CONFLICT (permission_code) DO NOTHING;
