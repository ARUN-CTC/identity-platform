-- Phase 2D.2: Application / OAuth Client Foundation
-- (docs/PHASE_2D2.md, docs/adr/ADR-018-application-trust-client-types.md).
-- Purely additive: four new columns on `application`, each deny-by-default
-- (empty array / the client_type-derived auth method) so no existing
-- Application silently gains a new capability by this migration alone — an
-- operator must explicitly configure grant_types/allowed_scopes/audiences
-- before any future /token implementation would treat an existing
-- Application as eligible for anything. No other table touched, no data
-- migrated beyond correcting token_endpoint_auth_method for existing PUBLIC
-- clients (whose correct derived value is 'none', not the column default).
-- Idempotent: guarded so a second run is a safe no-op.

BEGIN;

ALTER TABLE application ADD COLUMN IF NOT EXISTS grant_types TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE application ADD COLUMN IF NOT EXISTS allowed_scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE application ADD COLUMN IF NOT EXISTS audiences TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE application ADD COLUMN IF NOT EXISTS token_endpoint_auth_method VARCHAR(30) NOT NULL DEFAULT 'client_secret_basic';

-- Backfill: existing PUBLIC clients must read 'none', never the
-- CONFIDENTIAL-shaped column default — derived strictly from client_type,
-- never left to whatever the column's own DEFAULT happens to be.
UPDATE application SET token_endpoint_auth_method = 'none' WHERE client_type = 'PUBLIC' AND token_endpoint_auth_method <> 'none';

COMMIT;
