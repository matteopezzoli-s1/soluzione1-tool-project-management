#!/bin/sh
set -e

echo "📁 Contenuto /app/dist:"
ls -la /app/dist || echo "ERRORE: cartella dist non trovata"

echo "🚀 Avvio server Node.js..."
exec node dist/index.js