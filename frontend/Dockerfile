# =============================================================================
# frontend/Dockerfile
# Multi-stage build — Node 20 Alpine + Nginx Alpine
#
# Stage 1 (builder): installa dipendenze e lancia `vite build`
#                    VITE_API_URL viene iniettato come ARG a build-time
#
# Stage 2 (runner):  Nginx Alpine serve i file statici su porta 8080
#                    Cloud Run richiede porta 8080 (non 80)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Vite
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# VITE_API_URL è iniettato da Cloud Build come --build-arg
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Installa dipendenze
COPY package*.json ./
RUN npm ci

# Copia sorgenti e lancia la build
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Nginx — serve i file statici
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Rimuovi configurazione Nginx di default
RUN rm /etc/nginx/conf.d/default.conf

# Copia la configurazione custom (porta 8080, SPA routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia il bundle prodotto da Vite
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
