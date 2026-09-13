#!/usr/bin/env bash
# Builds the Identity Platform schema from scratch: extensions/functions,
# then DDL (tenant -> organization -> security, in that dependency order),
# then the identity_app runtime role. Never touches seed data — see seed.sh.
#
# Requires DATABASE_URL set to an elevated/owner role (able to CREATE
# EXTENSION, CREATE ROLE, etc.) — never the identity_app runtime role.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${DATABASE_URL:?DATABASE_URL must be set}"

run_dir() {
    local dir="$1"
    for f in "$dir"/*.sql; do
        [[ -e "$f" ]] || continue
        echo "==> $f"
        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
    done
}

run_dir "shared"
run_dir "ddl"
echo "Schema build complete."
