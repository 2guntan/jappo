#!/bin/sh
# Nightly PostgreSQL backup (SPEC §18.4): pg_dump -Fc, upload to the MinIO bucket `backups`, 30-day retention.
# Env: PGHOST PGUSER PGPASSWORD PGDATABASE; optional S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY BACKUP_BUCKET RETENTION_DAYS; BACKUP_DIR (local copy).
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=${BACKUP_DIR:-/tmp/jappo-backups}
mkdir -p "$DIR"
FILE="$DIR/jappo-$STAMP.dump"
pg_dump -Fc --no-owner --no-privileges -f "$FILE"
pg_restore --list "$FILE" > /dev/null # the archive must be readable
echo "backup written: $FILE ($(wc -c < "$FILE") bytes)"
if [ -n "${S3_ENDPOINT:-}" ] && command -v mc > /dev/null 2>&1; then
  mc alias set jappo "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > /dev/null
  mc mb --ignore-existing "jappo/${BACKUP_BUCKET:-backups}" > /dev/null
  mc cp "$FILE" "jappo/${BACKUP_BUCKET:-backups}/"
  mc rm --recursive --force --older-than "${RETENTION_DAYS:-30}d" "jappo/${BACKUP_BUCKET:-backups}/" > /dev/null || true
  rm -f "$FILE"
  echo "uploaded to ${BACKUP_BUCKET:-backups}"
else
  find "$DIR" -name 'jappo-*.dump' -mtime +"${RETENTION_DAYS:-30}" -delete
fi
