#!/bin/sh
# =============================================================================
# backend/entrypoint.sh
# Eseguito all'avvio del container Cloud Run.
# Lancia le Prisma migrations prima di avviare il server.
# =============================================================================

set -e

echo "🔄 Avvio migrations Prisma..."
npx prisma migrate deploy

echo "✅ Migrations completate."
echo "🚀 Avvio server Node.js..."

# ⚠️  Aggiorna il path se il tuo entry point è diverso (es. dist/server.js)
exec node dist/index.js
