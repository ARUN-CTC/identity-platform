-- Phase 2C — Organization Context & Context Switching
-- (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md, docs/adr/ADR-012-organization-context.md).
--
-- The one genuinely new database problem this phase introduces: resolving
-- "which Tenant does Organization X belong to, for a specific global
-- Identity" BEFORE any tenant RLS context can be established — the
-- classic chicken-and-egg every other pre-tenant-context flow in this
-- codebase avoids by having an already-tenant-free lookup path (Tenant/
-- security_user have no RLS at all; login/refresh/Platform-Operator flows
-- always already know the target tenant before querying anything
-- RLS-protected). Organization-context selection is different: the caller
-- supplies only organizationId, and the server must discover the tenant —
-- but `membership` (like `organization`) is normally tenant-RLS-gated, so
-- with no tenant GUC set yet, ordinary RLS would hide every row, including
-- the caller's own.
--
-- Fix: membership's RLS gains a narrow, READ-ONLY self-visibility clause —
-- a caller can always see their OWN membership rows (`user_id =
-- current_user_id()`), regardless of which tenant GUC (if any) happens to
-- be set. This is safe because it can never reveal another Identity's
-- membership (the OR clause only ever matches the CURRENT connection's own
-- authenticated user_id, itself only ever set by PrismaContextService from
-- a verified request context — never client-supplied) and because writes
-- are NOT relaxed: WITH CHECK is unchanged, so membership rows can still
-- only ever be *written* under the correct tenant's own GUC. Once the
-- tenant is discovered this way, every subsequent query in the same
-- context-switch operation runs with that now-known, validated tenantId
-- as an explicit GUC override (PrismaContextService.runInContext's
-- existing actingAsTenantId parameter) — fully RLS-enforced from that
-- point on, no further relaxation needed anywhere else.
DROP POLICY IF EXISTS tenant_isolation ON membership;
CREATE POLICY tenant_isolation ON membership
    USING (tenant_id = current_tenant_id() OR user_id = current_user_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- No other schema change is required: security_session.organization_id
-- already exists (Phase 1 anticipated exactly this — see
-- database/ddl/003_security.sql's own comment on that column), and no new
-- table is needed — organization context is represented entirely through
-- the existing Session row plus the access token's claims (code-only
-- change, docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md).
