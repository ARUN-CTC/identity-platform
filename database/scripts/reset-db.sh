#!/usr/bin/env bash
# Drops and recreates the public schema, then rebuilds it via
# build-schema.sh and seed.sh. Destructive — prompts for confirmation
# unless --yes is passed. Mirrors TravelOS's own scripts/reset-db.sh
# pattern (this project's own database only — see docs/PROJECT_ISOLATION.md).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

: "${DATABASE_URL:?DATABASE_URL must be set}"

if [[ "${1:-}" != "--yes" ]]; then
    read -r -p "This will drop and recreate the public schema on ${DATABASE_URL}. Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

./build-schema.sh
./seed.sh
