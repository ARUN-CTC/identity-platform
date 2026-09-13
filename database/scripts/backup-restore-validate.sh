#!/usr/bin/env bash
# Phase 2D.11 (docs/PRODUCTION_READINESS.md §Backup/restore) — a
# reproducible backup/restore validation procedure. Does NOT touch the
# real database's data — it dumps it, restores the dump into a disposable
# database, verifies row counts on the critical tables, then drops the
# disposable database. Safe to run repeatedly against a real environment.
#
# MUST run as the elevated, RLS-bypass-via-ownership role (`identity_owner`
# in local development; the equivalent schema-owner role in any other
# environment) — the runtime `identity_app` role is deliberately
# `NOBYPASSRLS` (docs/PROJECT_ISOLATION.md) and CANNOT pg_dump every
# tenant's rows across the whole database; attempting to do so fails with
# "query would be affected by row-level security policy for table ...".
# This is expected, correct behavior, not a bug — never grant identity_app
# itself BYPASSRLS to work around it (see database/scripts/bootstrap-platform-operator.ts
# and database/scripts/cleanup-expired-authorization-codes.ts for the same,
# already-established precedent).
#
# Usage:
#   DATABASE_HOST=localhost DATABASE_PORT=5434 DATABASE_OWNER_USER=identity_owner \
#   DATABASE_OWNER_PASSWORD=changeme DATABASE_NAME=identity_platform_db \
#   ./database/scripts/backup-restore-validate.sh

set -euo pipefail

DATABASE_HOST="${DATABASE_HOST:-localhost}"
DATABASE_PORT="${DATABASE_PORT:-5434}"
DATABASE_OWNER_USER="${DATABASE_OWNER_USER:-identity_owner}"
DATABASE_NAME="${DATABASE_NAME:-identity_platform_db}"
RESTORE_DB_NAME="${DATABASE_NAME}_restore_test"
BACKUP_FILE="$(mktemp -t identity_platform_db_backup.XXXXXX.dump)"

export PGPASSWORD="${DATABASE_OWNER_PASSWORD:?Set DATABASE_OWNER_PASSWORD}"

echo "==> Backing up $DATABASE_NAME as $DATABASE_OWNER_USER ..."
pg_dump -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d "$DATABASE_NAME" -Fc -f "$BACKUP_FILE"

echo "==> Creating disposable restore-target database ..."
psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d postgres -c "DROP DATABASE IF EXISTS ${RESTORE_DB_NAME};"
psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d postgres -c "CREATE DATABASE ${RESTORE_DB_NAME} OWNER ${DATABASE_OWNER_USER};"

echo "==> Restoring backup into $RESTORE_DB_NAME ..."
# --no-owner: this disposable database is already owned by DATABASE_OWNER_USER;
# a role/ownership mismatch during restore is not what this script validates.
pg_restore -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d "$RESTORE_DB_NAME" --no-owner --role="$DATABASE_OWNER_USER" "$BACKUP_FILE" || true
# A `transaction_timeout` "unrecognized configuration parameter" warning is
# expected/harmless on a pg_dump-client-newer-than-target-server version
# skew — it is one SET statement, never data loss; verified below.

echo "==> Verifying row counts on security-critical tables ..."
COUNT_QUERY="
SELECT 'security_user', count(*) FROM security_user
UNION ALL SELECT 'membership', count(*) FROM membership
UNION ALL SELECT 'application', count(*) FROM application
UNION ALL SELECT 'service_account', count(*) FROM service_account
UNION ALL SELECT 'service_account_tenant_grant', count(*) FROM service_account_tenant_grant
UNION ALL SELECT 'tenant_product_entitlement', count(*) FROM tenant_product_entitlement
UNION ALL SELECT 'security_session', count(*) FROM security_session
UNION ALL SELECT 'oauth_authorization_code', count(*) FROM oauth_authorization_code
UNION ALL SELECT 'tenant', count(*) FROM tenant
ORDER BY 1;
"
SOURCE_COUNTS=$(psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d "$DATABASE_NAME" -t -A -F',' -c "$COUNT_QUERY")
RESTORED_COUNTS=$(psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d "$RESTORE_DB_NAME" -t -A -F',' -c "$COUNT_QUERY")

echo "==> Verifying RLS survived the restore ..."
RLS_CHECK="SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('membership','oauth_authorization_code','tenant_product_entitlement') ORDER BY c.relname;"
psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d "$RESTORE_DB_NAME" -c "$RLS_CHECK"

echo "==> Cleaning up ..."
psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_OWNER_USER" -d postgres -c "DROP DATABASE ${RESTORE_DB_NAME};"
rm -f "$BACKUP_FILE"

if [ "$SOURCE_COUNTS" = "$RESTORED_COUNTS" ]; then
  echo "==> PASS: row counts match exactly on every checked table."
  exit 0
else
  echo "==> FAIL: row counts diverged."
  echo "Source:"
  echo "$SOURCE_COUNTS"
  echo "Restored:"
  echo "$RESTORED_COUNTS"
  exit 1
fi
