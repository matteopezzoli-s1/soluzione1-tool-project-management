#!/bin/sh
set -e

echo "🔄 Avvio migrations Prisma..."
npx prisma migrate deploy --config dist/prisma.config.js

echo "✅ Migrations completate."
echo "🚀 Avvio server Node.js..."
exec node dist/index.js