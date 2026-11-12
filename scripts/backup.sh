#!/usr/bin/env bash
# Daily backup of the PostgreSQL database and media files.
# Cron example (03:30 every day):
#   30 3 * * * /opt/raseel/scripts/backup.sh >> /var/log/raseel-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd)

docker compose exec -T postgres pg_dump -U raseel -d raseel --format=custom \
  > "$BACKUP_DIR/raseel-db-$STAMP.dump"

docker compose run --rm --no-deps -T --user 0 --entrypoint tar -v "$BACKUP_DIR:/backup" worker \
  czf "/backup/raseel-media-$STAMP.tar.gz" -C /data media

find "$BACKUP_DIR" -name 'raseel-*' -mtime +"$KEEP_DAYS" -delete
echo "Backup written to $BACKUP_DIR ($STAMP)"
