-- Extensions required by this database. Trimmed from TravelOS's own list
-- (packages/database/shared/extensions/001_extensions.sql) to only what the
-- extracted identity tables actually use — see docs/TRAVELOS_COUPLING.md.
-- citext/pg_trgm/btree_gist (TravelOS: search + fiscal-year overlap checks)
-- are not needed by anything in this schema and were dropped.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
