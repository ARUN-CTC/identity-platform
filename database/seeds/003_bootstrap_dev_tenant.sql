-- Bootstrap DEV tenant + admin user for local development only.
-- Password hash is argon2id for the literal password 'ChangeMe123!' —
-- dev-only, change immediately in any environment that isn't a throwaway
-- local database. Placeholder email/tenant code (no real personal data —
-- see docs/TRAVELOS_COUPLING.md, bootstrap seed row).
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

INSERT INTO security_user (tenant_id, email, username, password_hash, first_name, last_name, status, email_verified_at)
SELECT t.id, 'admin@example.com', 'admin',
       '$argon2id$v=19$m=65536,t=3,p=4$RZ4PlH1HsosTENZJQGsYTQ$AdIp3Fh9nQeqyJctEtMewpyqKfrNeqkKE7AG+FI2jzU',
       'Dev', 'Admin', 'ACTIVE', NOW()
FROM tenant t
WHERE t.tenant_code = 'DEV'
ON CONFLICT (tenant_id, email) WHERE deleted_at IS NULL DO NOTHING;

INSERT INTO security_user_role (tenant_id, user_id, role_id)
SELECT u.tenant_id, u.id, r.id
FROM security_user u
CROSS JOIN security_role r
WHERE u.tenant_id = (SELECT id FROM tenant WHERE tenant_code = 'DEV')
  AND u.email = 'admin@example.com'
  AND r.role_code = 'TENANT_ADMIN' AND r.tenant_id IS NULL
ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;
