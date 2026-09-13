# Versioned migrations

Same convention as TravelOS's own `packages/database/migrations/history`
(a genuinely reusable practice, not product-specific): this directory holds
changes to a database that **already has data**. It is never used to build
a database from scratch — that remains `db:build-schema` + `db:seed`.

Empty in Phase 1 — there is no existing Identity Platform database to
migrate yet. The convention is documented here so Phase 2+ has a place to
put forward-only, hand-reviewed SQL changes from day one, matching the
`<UTC-timestamp>_<description>.sql` naming and "no down-migrations, write a
new forward fix instead" rule TravelOS itself uses.
