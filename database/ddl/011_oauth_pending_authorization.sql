-- Phase 2UI.5A: OAuth Browser Session & Authorization Completion
-- (docs/PHASE_2UI5A.md, docs/OAUTH_BROWSER_SESSION_ARCHITECTURE.md).
-- No tenant_id, no RLS — a genuinely tenant-less, pre-authentication
-- record (see that document's own §7 for why).

CREATE TABLE oauth_pending_authorization (
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
CREATE INDEX idx_oauth_pending_authorization_expires_at ON oauth_pending_authorization(expires_at);
