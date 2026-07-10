#!/usr/bin/env bash
#
# migrate-to-neon.sh — Migrazione dati Cloud SQL (PostgreSQL) → Neon
#
# ⚠️  QUESTO SCRIPT NON VIENE ESEGUITO AUTOMATICAMENTE.
#     È pensato per essere letto, adattato con le tue credenziali e lanciato
#     A MANO da terminale, un ambiente (dev o prod) alla volta.
#
# Prerequisiti (vedi MIGRATION_DB_NEON.md per i dettagli):
#   - cloud-sql-proxy in esecuzione verso l'istanza Cloud SQL sorgente
#   - progetto Neon "s1-tool-projectmanagement" già creato, con branch/database
#     "s1-tpm-dev" e "s1-tpm-prod" e ruolo "s1-tpm"
#   - client `pg_dump` / `pg_restore` versione >= 15 (coerente con Postgres Neon)
#
# Uso:
#   SOURCE_DATABASE_URL="postgresql://user:pass@127.0.0.1:5432/dbname" \
#   TARGET_DATABASE_URL="postgresql://s1-tpm:pass@ep-xxxx.neon.tech/s1-tpm-dev?sslmode=require" \
#   ./scripts/migrate-to-neon.sh

set -euo pipefail

: "${SOURCE_DATABASE_URL:?Devi impostare SOURCE_DATABASE_URL (Cloud SQL, via cloud-sql-proxy)}"
: "${TARGET_DATABASE_URL:?Devi impostare TARGET_DATABASE_URL (Neon)}"

DUMP_FILE="${DUMP_FILE:-/tmp/s1-tpm-dump-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo manual).dump}"

echo "▶ Sorgente : ${SOURCE_DATABASE_URL%%@*}@***"
echo "▶ Target   : ${TARGET_DATABASE_URL%%@*}@***"
echo "▶ Dump file: $DUMP_FILE"
echo
read -r -p "Confermi di voler procedere? (scrivi 'si' per continuare) " CONFIRM
if [ "$CONFIRM" != "si" ]; then
  echo "Annullato."
  exit 1
fi

echo "▶ Step 1/3 — pg_dump da Cloud SQL (formato custom, comprime e permette restore parallelo)"
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$DUMP_FILE"

echo "▶ Step 2/3 — pg_restore su Neon"
pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --jobs=4 \
  --verbose \
  "$DUMP_FILE"

echo "▶ Step 3/3 — Conteggio righe per tabella (sorgente vs target)"
echo "--- Sorgente ---"
psql "$SOURCE_DATABASE_URL" -c "
  SELECT relname AS tabella, n_live_tup AS righe
  FROM pg_stat_user_tables
  ORDER BY relname;
"
echo "--- Target (Neon) ---"
psql "$TARGET_DATABASE_URL" -c "
  SELECT relname AS tabella, n_live_tup AS righe
  FROM pg_stat_user_tables
  ORDER BY relname;
"

echo
echo "✅ Migrazione completata. Confronta manualmente le due tabelle di conteggio sopra."
echo "   Dump conservato in: $DUMP_FILE (cancellalo quando hai verificato che tutto torna)"
