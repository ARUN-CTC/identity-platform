-- Phase 2D.7: OAuth Authorization Code (docs/PHASE_2D7.md,
-- docs/OAUTH_AUTHORIZATION_CODE_PKCE.md). Purely additive — one new table,
-- no existing table's shape changes. Forward-only, idempotent, safe to
-- apply to an already-seeded database.

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_authorization_code (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    code_hash TEXT NOT NULL UNIQUE,

    application_id UUID NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    organization_id UUID REFERENCES organization(id) ON DELETE SET NULL,

    redirect_uri TEXT NOT NULL,
    audience TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',

    code_challenge TEXT NOT NULL,
    code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,

    CONSTRAINT chk_oauth_authorization_code_challenge_method CHECK (code_challenge_method = 'S256')
);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_code_expires_at ON oauth_authorization_code(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_code_application ON oauth_authorization_code(application_id);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_code_tenant ON oauth_authorization_code(tenant_id);

-- Idempotent: apply_tenant_rls() unconditionally creates a policy named
-- "tenant_isolation" — guard against re-running this migration against a
-- database that already has it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oauth_authorization_code' AND policyname = 'tenant_isolation'
    ) THEN
        CALL apply_tenant_rls('oauth_authorization_code');
    END IF;
END
$$;

COMMIT;
