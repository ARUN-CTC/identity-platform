#!/usr/bin/env bash
# Applies versioned, forward-only SQL migrations from database/migrations/
# to a database that already has data. Not used to build a fresh database
# (build-schema.sh + seed.sh does that). Phase 1 baseline: no migrations
# exist yet — see database/migrations/README.md.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL must be set}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);"

shopt -s nullglob
files=(migrations/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
    echo "No migrations found in migrations/ — nothing to do."
    exit 0
fi

for f in "${files[@]}"; do
    name="$(basename "$f")"
    already=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'")
    if [[ "$already" == "1" ]]; then
        continue
    fi
    echo "==> Applying $name"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f" \
        -c "INSERT INTO schema_migrations (filename) VALUES ('$name');"
done
echo "Done."
