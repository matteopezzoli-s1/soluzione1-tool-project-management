#!/bin/sh
set -e

echo "🔄 Avvio migrations Prisma..."
npx prisma migrate deploy --schema /app/prisma/schema.prisma

echo "✅ Migrations completate."
echo "🚀 Avvio server Node.js..."
exec node dist/index.js