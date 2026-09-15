-- Bootstrap DEV Platform Operator for local development only
-- (docs/PLATFORM_OPERATOR_ARCHITECTURE.md). Deliberately a SEPARATE global
-- Identity from the DEV tenant admin (003_bootstrap_dev_tenant.sql) — this
-- seed exists specifically to demonstrate, from the very first `db:reset`,
-- that Tenant Admin and Platform Operator are two independent security
-- boundaries: admin@example.com has no platform_operator row, and
-- platform-operator@example.com has no Membership/organization role
-- anywhere.
--
-- Password hash is the same argon2id dev-only hash as the DEV tenant admin
-- (literal password 'ChangeMe123!') — dev-only, change immediately in any
-- environment that isn't a throwaway local database. Production bootstrap
-- uses database/scripts/bootstrap-platform-operator.ts instead (reads
-- credentials from environment variables, never hardcoded — see
-- docs/PLATFORM_OPERATOR_ARCHITECTURE.md, "Bootstrap").
INSERT INTO security_user (email, username, password_hash, first_name, last_name, status, email_verified_at)
VALUES (
    'platform-operator@example.com', 'platform-operator',
    '$argon2id$v=19$m=65536,t=3,p=4$RZ4PlH1HsosTENZJQGsYTQ$AdIp3Fh9nQeqyJctEtMewpyqKfrNeqkKE7AG+FI2jzU',
    'Dev', 'PlatformOperator', 'ACTIVE', NOW()
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO platform_operator (user_id, status)
SELECT u.id, 'ACTIVE'
FROM security_user u
WHERE u.email = 'platform-operator@example.com'
ON CONFLICT (user_id) DO NOTHING;

-- Grants every platform_only permission — this is the one seeded operator
-- meant to demonstrate full platform authority end to end; a real
-- deployment would grant a new operator only the specific codes their job
-- actually requires (least privilege — see PlatformOperatorsService's own
-- grant-ceiling enforcement).
INSERT INTO platform_operator_permission (operator_id, permission_id)
SELECT po.id, p.id
FROM platform_operator po
JOIN security_user u ON u.id = po.user_id AND u.email = 'platform-operator@example.com'
CROSS JOIN security_permission p
WHERE p.platform_only = TRUE AND p.deleted_at IS NULL
ON CONFLICT (operator_id, permission_id) DO NOTHING;
