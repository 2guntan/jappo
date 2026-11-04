#!/bin/sh
# Restore a pg_dump -Fc archive into a database (SPEC §18.4). DESTRUCTIVE for the target database.
# Usage: PGHOST=… PGUSER=… PGPASSWORD=… infra/backup/restore.sh <dump-file> <target-db> [--yes]
set -eu
FILE=${1:?dump file}
TARGET=${2:?target database}
if [ "${3:-}" != "--yes" ]; then
  echo "This drops and recreates database '$TARGET'. Re-run with --yes to confirm." >&2
  exit 2
fi
pg_restore --list "$FILE" > /dev/null
psql -v ON_ERROR_STOP=1 -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$TARGET' and pid <> pg_backend_pid();" > /dev/null
psql -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists \"$TARGET\";" -c "create database \"$TARGET\";"
psql -v ON_ERROR_STOP=1 -d "$TARGET" -c "create extension if not exists postgis;" > /dev/null
pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET" "$FILE"
psql -v ON_ERROR_STOP=1 -d "$TARGET" -At -c "select 'audit rows: ' || count(*) from audit_log;"
echo "restored $FILE into $TARGET"
