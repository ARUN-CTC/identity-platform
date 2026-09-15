-- Bootstrap DEV tenant + admin user for local development only.
-- Password hash is argon2id for the literal password 'ChangeMe123!' —
-- dev-only, change immediately in any environment that isn't a throwaway
-- local database. Placeholder email/tenant code (no real personal data —
-- see docs/TRAVELOS_COUPLING.md, bootstrap seed row).
--
-- PHASE 2A: security_user is now a global Identity (no tenant_id column) —
-- the admin's membership in the DEV tenant is expressed via a `membership`
-- row, not by the user row itself. See docs/PHASE_2A.md.
INSERT INTO tenant (tenant_code, tenant_name, status, activated_at)
VALUES ('DEV', 'Development Tenant', 'ACTIVE', NOW())
ON CONFLICT (tenant_code) DO NOTHING;

INSERT INTO organization_type (type_code, type_name, description)
VALUES ('DEFAULT', 'Default Organization Type', 'Seeded default for local development')
ON CONFLICT (type_code) DO NOTHING;

INSERT INTO organization (tenant_id, organization_type_id, organization_code, organization_name)
SELECT t.id, ot.id, 'DEV-ORG', 'Development Organization'
FROM tenant t, organization_type ot
WHERE t.tenant_code = 'DEV' AND ot.type_code = 'DEFAULT'
ON CONFLICT (tenant_id, organization_code) DO NOTHING;

INSERT INTO security_user (email, username, password_hash, first_name, last_name, status, email_verified_at)
VALUES (
    'admin@example.com', 'admin',
    '$argon2id$v=19$m=65536,t=3,p=4$RZ4PlH1HsosTENZJQGsYTQ$AdIp3Fh9nQeqyJctEtMewpyqKfrNeqkKE7AG+FI2jzU',
    'Dev', 'Admin', 'ACTIVE', NOW()
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO membership (tenant_id, organization_id, user_id, status)
SELECT o.tenant_id, o.id, u.id, 'ACTIVE'
FROM organization o
JOIN tenant t ON t.id = o.tenant_id AND t.tenant_code = 'DEV'
CROSS JOIN security_user u
WHERE o.organization_code = 'DEV-ORG' AND u.email = 'admin@example.com'
ON CONFLICT (user_id, organization_id) DO NOTHING;

INSERT INTO security_user_role (tenant_id, user_id, role_id)
SELECT t.id, u.id, r.id
FROM security_user u
CROSS JOIN security_role r
CROSS JOIN tenant t
WHERE u.email = 'admin@example.com'
  AND t.tenant_code = 'DEV'
  AND r.role_code = 'TENANT_ADMIN' AND r.tenant_id IS NULL
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;
