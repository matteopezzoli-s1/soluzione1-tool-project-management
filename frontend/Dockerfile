# =============================================================================
# backend/Dockerfile
# Multi-stage build — Node 20 Alpine
#
# Stage 1 (prod-deps): installa solo dipendenze di produzione + genera Prisma client
# Stage 2 (builder):   compila TypeScript → dist/
# Stage 3 (runner):    immagine finale minimale, utente non-root
#
# ⚠️  Assumi che il backend sia TypeScript con script "build" in package.json.
#     Se usi plain JS, rimuovi lo stage "builder" e copia i file .js direttamente.
# ⚠️  L'entry point è `node dist/index.js` — aggiornalo se il tuo file
#     principale ha un nome diverso (es. dist/server.js, dist/app.js).
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dipendenze di produzione + Prisma Client
# -----------------------------------------------------------------------------
FROM node:20-alpine AS prod-deps

WORKDIR /app

# Copia solo i file necessari per installare le dipendenze
COPY package*.json ./
COPY prisma ./prisma/

# Installa solo prod deps e genera il Prisma client
RUN npm ci --omit=dev && \
    npx prisma generate

# -----------------------------------------------------------------------------
# Stage 2: Compilazione TypeScript
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copia sorgenti e schema Prisma
COPY . .

# Genera Prisma client e compila TypeScript
RUN npx prisma generate && \
    npm run build

# -----------------------------------------------------------------------------
# Stage 3: Immagine di produzione minimale
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Variabili d'ambiente di default (sovrascritte da Cloud Run)
ENV NODE_ENV=production
ENV PORT=8080

# Utente non-root per sicurezza
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeuser --ingroup nodejs

# Copia artifacts dagli stage precedenti
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=builder   /app/dist ./dist
COPY package*.json ./

# Copia e rendi eseguibile l'entrypoint
COPY entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

# Cambia ownership
RUN chown -R nodeuser:nodejs /app

USER nodeuser

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
