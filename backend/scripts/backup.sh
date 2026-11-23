#!/usr/bin/env bash
# =============================================================================
# backup.sh — Daily PostgreSQL backup using pg_dump
#
# Usage:
#   ./backup.sh
#
# Environment variables (can also be in a .env file sourced before running):
#   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS
#   BACKUP_DIR   — where to store backups (default: /var/backups/pathlab)
#   KEEP_DAYS    — how many days to keep daily backups (default: 30)
#
# Cron example (runs at 2:00 AM every day):
#   0 2 * * * /path/to/pathlab/backend/scripts/backup.sh >> /var/log/pathlab-backup.log 2>&1
#
# Docker Compose note:
#   If your app runs in Docker, run this from the HOST, pointing at the
#   exposed Postgres port (5432), or exec into the db container:
#   docker exec pathlab-db-1 pg_dump -U $DB_USER $DB_NAME | gzip > backup.sql.gz
# =============================================================================
set -euo pipefail

# ── Load .env if it exists (project root) ────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

# ── Config ────────────────────────────────────────────────────────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-pathlab}"
DB_USER="${DB_USER:-pathlab}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pathlab}"
KEEP_DAYS="${KEEP_DAYS:-30}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${DB_NAME}_${TIMESTAMP}.sql.gz"
DEST="$BACKUP_DIR/$FILENAME"

# ── Create backup directory ───────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting backup → $DEST"

# ── Run pg_dump ───────────────────────────────────────────────────────────────
# PGPASSWORD is used to avoid a password prompt; never logged.
PGPASSWORD="$DB_PASS" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --no-password \
  --format=plain \
  --clean \
  --if-exists \
  "$DB_NAME" | gzip > "$DEST"

echo "[$(date -Iseconds)] Backup complete: $DEST ($(du -sh "$DEST" | cut -f1))"

# ── Rotate old backups ────────────────────────────────────────────────────────
echo "[$(date -Iseconds)] Removing backups older than $KEEP_DAYS days…"
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+$KEEP_DAYS" -delete
echo "[$(date -Iseconds)] Rotation done. Remaining backups:"
ls -lh "$BACKUP_DIR" | tail -10
