-- Product / Application registration — Phase 2B (docs/PHASE_2B.md,
-- docs/PHASE_2B_DOMAIN_MODEL.md). Both tables are PLATFORM-level: neither
-- carries a tenant_id column, and neither gets RLS — a Product (TravelOS,
-- Healthcare, Gym) and its Applications do not belong to any one Tenant, the
-- same way organization_type/security_permission are global catalogs, not
-- tenant-partitioned data. See docs/TRUST_BOUNDARY.md, "Platform-level vs
-- tenant-level".
--
-- No deleted_at/deleted_by/soft-delete trigger on either table: Phase 2B
-- deliberately has no delete endpoint for Product or Application (status
-- transitions — ACTIVE/SUSPENDED/DISABLED — are the lifecycle mechanism,
-- not deletion, since other data may already reference these rows the
-- moment a real product/application registration exists). Only the
-- update-half of apply_standard_triggers() is attached manually, same
-- pattern Phase 2A's `membership` table already established for the same
-- reason.

CREATE TABLE product (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),

    name VARCHAR(200) NOT NULL,
    slug VARCHAR(50) NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1
);
-- Case-insensitive uniqueness (Step 12) — "TravelOS" and "travelos" must not
-- both be registerable as distinct products.
CREATE UNIQUE INDEX uk_product_slug ON product(LOWER(slug));
CREATE INDEX idx_product_status ON product(status);

CREATE TRIGGER trg_product_set_audit_fields
    BEFORE UPDATE ON product
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

-- Application — the registered, credentialed consumer of the Identity
-- Platform's API for one Product (docs/PHASE_2B_DOMAIN_MODEL.md — this is
-- also what OAuth/OIDC terminology calls a "client"; Phase 2B treats the two
-- names as the same one entity, not two).
CREATE TABLE application (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    product_id UUID NOT NULL REFERENCES product(id) ON DELETE CASCADE,

    name VARCHAR(200) NOT NULL,

    -- Public, non-secret identifier — safe to log, safe to put in a URL.
    client_id VARCHAR(64) NOT NULL,
    -- Hash only — see docs/PHASE_2B.md, "Client credential handling". NULL
    -- for PUBLIC clients (e.g. a future SPA using PKCE — no secret to hash).
    client_secret_hash TEXT,
    client_type VARCHAR(20) NOT NULL DEFAULT 'CONFIDENTIAL',
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    -- Reserved for future OAuth2/OIDC use (docs/adr/ADR-007) — stored since
    -- Phase 2B; enforced starting Phase 2D.2 (docs/PHASE_2D2.md) by
    -- RedirectUriPolicy/OriginPolicy (src/modules/applications/policies) —
    -- exact-match allow-lists, never wildcard/fuzzy matching.
    redirect_uris TEXT[] NOT NULL DEFAULT '{}',
    allowed_origins TEXT[] NOT NULL DEFAULT '{}',

    -- Phase 2D.2 (docs/adr/ADR-018-application-trust-client-types.md,
    -- docs/APPLICATION_AUTHORIZATION.md) — the OAuth client's own
    -- configuration allow-lists. Deny-by-default: an empty array authorizes
    -- nothing, consistent with every other allow-list in this schema
    -- (Membership, TenantProductEntitlement). Not yet consumed by any
    -- token-issuing endpoint (none exists yet) — validated at registration
    -- time and ready for the future /authorize, /token implementations to
    -- consume via the same policy classes, never a second, divergent copy
    -- of these rules.
    grant_types TEXT[] NOT NULL DEFAULT '{}',
    allowed_scopes TEXT[] NOT NULL DEFAULT '{}',
    audiences TEXT[] NOT NULL DEFAULT '{}',
    -- Derived strictly from client_type at creation (ADR-018) — CONFIDENTIAL
    -- -> client_secret_basic, PUBLIC -> none. Never independently
    -- client-settable; stored explicitly (not merely re-derived on every
    -- read) so a future /token implementation can read it directly.
    token_endpoint_auth_method VARCHAR(30) NOT NULL DEFAULT 'client_secret_basic',

    secret_created_at TIMESTAMPTZ,
    secret_revoked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT uk_application_client_id UNIQUE (client_id),
    CONSTRAINT uk_application_product_name UNIQUE (product_id, name)
);
CREATE INDEX idx_application_product ON application(product_id);
CREATE INDEX idx_application_status ON application(status);

CREATE TRIGGER trg_application_set_audit_fields
    BEFORE UPDATE ON application
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();
