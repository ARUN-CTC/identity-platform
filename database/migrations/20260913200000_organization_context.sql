-- Phase 2C: Organization Context & Context Switching
-- (docs/ORGANIZATION_CONTEXT_ARCHITECTURE.md, docs/adr/ADR-012-organization-context.md).
-- A single, narrow RLS policy change on `membership` — see
-- database/ddl/008_organization_context.sql for the full rationale.
-- Idempotent (DROP POLICY IF EXISTS + CREATE), no data change, no other
-- table touched.

BEGIN;

DROP POLICY IF EXISTS tenant_isolation ON membership;
CREATE POLICY tenant_isolation ON membership
    USING (tenant_id = current_tenant_id() OR user_id = current_user_id())
    WITH CHECK (tenant_id = current_tenant_id());

COMMIT;
