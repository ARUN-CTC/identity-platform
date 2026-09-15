-- Phase 2B.2 — Product Entitlement (docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md,
-- docs/adr/ADR-011-product-entitlement-model.md).
--
-- tenant_product_entitlement answers exactly one question: is this Tenant
-- permitted to use this Product? Nothing more — not membership (Phase 2A),
-- not authorization (Phase 1/2A RBAC), not billing (explicitly out of
-- scope). Tenant-level, not Organization-level (see the ADR for why
-- tenant-level is primary and organization-level was evaluated and
-- deferred, not built).
--
-- Tenant-scoped, so it gets ordinary RLS (apply_tenant_rls) exactly like
-- `organization`/`membership` — a Platform Operator (who has no ambient
-- tenant context) manages these through an explicit, server-validated
-- "act as this tenant" context (PrismaContextService.runInContext's
-- actingAsTenantId parameter, already used throughout this codebase for
-- pre-authenticated/cross-context flows — see
-- docs/PRODUCT_ENTITLEMENT_ARCHITECTURE.md, "Platform Operator + RLS"), not
-- by weakening RLS or granting BYPASSRLS.
CREATE TABLE tenant_product_entitlement (
    id UUID PRIMARY KEY DEFAULT generate_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    product_id UUID NOT NULL REFERENCES product(id),

    -- ACTIVE | SUSPENDED | REVOKED. No PENDING — nothing in this phase ever
    -- produces or consumes a pending-approval state (docs/PRODUCT_ENTITLEMENT_LIFECYCLE.md,
    -- "Why no PENDING"); a new entitlement is created directly ACTIVE, the
    -- same convention Product/Application already use.
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 1,

    -- Idempotency / duplicate-entitlement prevention (Step 24, Step 39) —
    -- one entitlement row per (tenant, product), ever. A revoked
    -- entitlement is reactivated in place (see the lifecycle doc), never
    -- superseded by a second row for the same pair.
    CONSTRAINT uk_tenant_product_entitlement UNIQUE (tenant_id, product_id)
);
CREATE INDEX idx_tenant_product_entitlement_tenant ON tenant_product_entitlement(tenant_id);
CREATE INDEX idx_tenant_product_entitlement_product ON tenant_product_entitlement(product_id);
CREATE INDEX idx_tenant_product_entitlement_status ON tenant_product_entitlement(status);

CREATE TRIGGER trg_tenant_product_entitlement_set_audit_fields
    BEFORE UPDATE ON tenant_product_entitlement
    FOR EACH ROW EXECUTE FUNCTION fn_set_audit_fields();

CALL apply_tenant_rls('tenant_product_entitlement');
