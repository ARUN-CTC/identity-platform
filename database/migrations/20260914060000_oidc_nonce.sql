-- Phase 2D.8: OIDC Provider (docs/PHASE_2D8.md, docs/OIDC_PROVIDER.md).
-- Purely additive — one nullable column on the existing
-- oauth_authorization_code table (Phase 2D.7). No new table, no existing
-- column altered/removed, no other table touched. Forward-only, idempotent.

BEGIN;

ALTER TABLE oauth_authorization_code ADD COLUMN IF NOT EXISTS nonce TEXT;

COMMIT;
