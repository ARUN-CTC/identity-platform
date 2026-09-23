-- Phase 2UI.5A: OAuth Browser Session & Authorization Completion
-- (docs/PHASE_2UI5A.md, docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md).
-- Purely additive — two new nullable columns on the existing
-- security_session table, and one new, RLS-free table. No existing column
-- altered/removed, no other table touched. Forward-only, idempotent, safe
-- to apply to an already-seeded database.

BEGIN;

ALTER TABLE security_session ADD COLUMN IF NOT EXISTS browser_session_secret_hash TEXT;
ALTER TABLE security_session ADD COLUMN IF NOT EXISTS browser_session_secret_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS oauth_pending_authorization (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    reference_hash TEXT NOT NULL UNIQUE,

    response_type TEXT,
    client_id TEXT,
    redirect_uri TEXT NOT NULL,
    scope TEXT,
    state TEXT,
    code_challenge TEXT,
    code_challenge_method TEXT,
    audience TEXT,
    organization_id UUID,
    nonce TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_authorization_expires_at ON oauth_pending_authorization(expires_at);

COMMIT;
