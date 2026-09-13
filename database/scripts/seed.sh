#!/usr/bin/env bash
# Loads seed data (permission catalog, system roles, dev bootstrap tenant)
# in filename order. Requires DATABASE_URL set to an elevated/owner role.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL must be set}"

for f in seeds/*.sql; do
    [[ -e "$f" ]] || continue
    echo "==> $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "Seed complete."
