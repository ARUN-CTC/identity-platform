-- Phase 2D.7 — OAuth Authorization Code (docs/PHASE_2D7.md,
-- docs/OAUTH_AUTHORIZATION_CODE_PKCE.md). See the Prisma model's own doc
-- comment (database/prisma/schema/oauth-authorization-code.prisma) for the
-- full design rationale — TENANT-scoped (apply_tenant_rls), single-use,
-- short-lived, hash-only storage of a cryptographically random opaque
-- value, exactly the same convention already established for
-- security_refresh_token / security_password_reset_token /
-- security_user_invitation_token. No updated_at/version/audit trigger — a
-- row has exactly one possible mutation ever (consumed_at, set once, via
-- the atomic conditional UPDATE in AuthorizationCodesRepository.tryConsume)
-- and no general update path exists, matching security_refresh_token's own
-- precedent (also no updated_at/version).

CREATE TABLE oauth_authorization_code (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    code_hash TEXT NOT NULL UNIQUE,

    application_id UUID NOT NULL REFERENCES application(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES security_user(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    organization_id UUID REFERENCES organization(id) ON DELETE SET NULL,

    redirect_uri TEXT NOT NULL,
    audience TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',

    -- PKCE (RFC 7636) — only S256 is ever persisted. Enforced at issuance by
    -- AuthorizeService; this CHECK is defense in depth, not the primary
    -- control.
    code_challenge TEXT NOT NULL,
    code_challenge_method VARCHAR(10) NOT NULL DEFAULT 'S256',

    -- Phase 2D.8 — OIDC nonce, present only when `openid` was requested
    -- (scopes @> ARRAY['openid'] is the authoritative flag; no separate
    -- boolean column). Bound at issuance, carried unmodified into the ID
    -- Token at /token.
    nonce TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,

    CONSTRAINT chk_oauth_authorization_code_challenge_method CHECK (code_challenge_method = 'S256')
);
CREATE INDEX idx_oauth_authorization_code_expires_at ON oauth_authorization_code(expires_at);
CREATE INDEX idx_oauth_authorization_code_application ON oauth_authorization_code(application_id);
CREATE INDEX idx_oauth_authorization_code_tenant ON oauth_authorization_code(tenant_id);

CALL apply_tenant_rls('oauth_authorization_code');
