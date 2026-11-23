#!/usr/bin/env bash
# =============================================================================
# restore.sh — Restore a PathLab PostgreSQL backup
#
# Usage:
#   ./restore.sh /var/backups/pathlab/pathlab_20241115_020000.sql.gz
#
# ⚠️  WARNING: This will DROP and recreate the database.
#     Make a fresh backup of the current state before running.
# =============================================================================
set -euo pipefail

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: File not found: $BACKUP_FILE"
  exit 1
fi

# ── Load .env ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../.env"
if [[ -f "$ENV_FILE" ]]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-pathlab}"
DB_USER="${DB_USER:-pathlab}"

echo "============================================================"
echo "  PathLab Database Restore"
echo "  Source : $BACKUP_FILE"
echo "  Target : $DB_NAME on $DB_HOST:$DB_PORT"
echo "============================================================"
echo "⚠️  This will OVERWRITE the current database."
read -r -p "Type YES to continue: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Aborted."
  exit 0
fi

echo "[$(date -Iseconds)] Restoring…"

# Decompress and pipe into psql
PGPASSWORD="$DB_PASS" gunzip -c "$BACKUP_FILE" | \
  psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --no-password

echo "[$(date -Iseconds)] ✅ Restore complete."
echo ""
echo "Post-restore checklist:"
echo "  1. Restart the app:  npm run dev  (or docker compose restart app)"
echo "  2. Run migrations if the backup predates recent schema changes:"
echo "     cd backend && npm run migrate"
echo "  3. Verify data: psql -U $DB_USER $DB_NAME -c 'SELECT COUNT(*) FROM patients;'"
