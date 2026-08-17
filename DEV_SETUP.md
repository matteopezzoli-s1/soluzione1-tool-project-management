# Dev Environment — TPM (Locale)

> Questo file descrive **esclusivamente l'ambiente di sviluppo locale**.  
> In produzione/staging le porte, gli URL e i redirect URI OAuth cambieranno — sarà necessario aggiornare le variabili d'ambiente del server e aggiungere i nuovi URI autorizzati su Google Cloud Console.

## Porte

| Servizio   | Porta |
|------------|-------|
| PostgreSQL | 5433  |
| Backend    | 8080  |
| Frontend   | 5173  |

---

## Avvio completo (ordine obbligatorio)

### 1. Database (Docker)
```bash
docker compose up -d
```
Verifica: `docker ps` deve mostrare `s1-tpm-db` in stato `Up`.

### 2. Backend
```bash
cd backend && npm run dev
```
Il comando usa `dotenv -e .env -- nodemon src/server.ts`.  
Verifica: il log deve stampare:
```
[tpm] Backend → http://localhost:8080
[tpm] Callback → http://localhost:8080/auth/google/callback
```

### 3. Frontend
```bash
cd frontend && npm run dev
```
Oppure tramite `preview_start` con il server "frontend" da `.claude/launch.json`.

---

## Variabili d'ambiente

### `backend/.env`
```
DATABASE_URL="postgresql://tpm:tpm_dev_pwd@localhost:5433/s1-tpm-dev"
JWT_SECRET="dev-local-secret-cambia-in-prod"
PORT=8080

GOOGLE_CLIENT_ID="<vedi Google Cloud Console>"
GOOGLE_CLIENT_SECRET="<vedi Google Cloud Console>"
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:8080

# Import consuntivi da Zoho Projects (senza, le route /api/zoho/* danno 503)
ZOHO_CLIENT_ID="<Zoho API Console → Self Client>"
ZOHO_CLIENT_SECRET="<Zoho API Console → Self Client>"
ZOHO_REFRESH_TOKEN="<vedi sotto>"
ZOHO_PORTAL_ID="20080726048"
ZOHO_ACCOUNTS_URL=https://accounts.zoho.eu
ZOHO_PROJECTS_API_URL=https://projectsapi.zoho.eu
```
> **ATTENZIONE**: `BACKEND_URL` deve essere `http://localhost:8080` — è l'URL usato per costruire il callback OAuth Google. Cambiarlo rompe il login.

> Dopo ogni modifica a `backend/.env` va **riavviato** il dev server: `dotenv-cli` legge il file solo all'avvio e nodemon non lo rilegge.

#### Refresh token Zoho (datacenter EU)

Il token porta con sé gli scope fissati al momento della generazione: per cambiarli va rifatto. Servono tutti e cinque — l'API v3 ricava la milestone dal timelog con la catena log → task → tasklist → phase, e senza `tasks.READ` l'import risponde `401 INVALID_OAUTHSCOPE`.

1. [api-console.zoho.eu](https://api-console.zoho.eu) → Self Client esistente → **Generate Code**, scope:
   ```
   ZohoProjects.projects.READ,ZohoProjects.tasklists.READ,ZohoProjects.milestones.READ,ZohoProjects.timesheets.READ,ZohoProjects.tasks.READ
   ```
   Durata 10 minuti, poi copia il grant code (usabile una volta sola).
2. Scambialo con il refresh token:
   ```bash
   cd backend && CODE='<grant code>' && set -a && . ./.env && set +a && curl -s -X POST "https://accounts.zoho.eu/oauth/v2/token" -d grant_type=authorization_code -d client_id="$ZOHO_CLIENT_ID" -d client_secret="$ZOHO_CLIENT_SECRET" -d code="$CODE"
   ```
   Nella risposta controlla che `scope` contenga tutti e cinque, poi metti `refresh_token` in `ZOHO_REFRESH_TOKEN`.
3. In produzione lo stesso valore va caricato come secret del Worker: `npx wrangler secret put ZOHO_REFRESH_TOKEN --env production`.

### `frontend/.env.local`
```
VITE_API_URL=http://localhost:8080
```
> Deve puntare alla porta del backend. Se non esiste, crearlo — il file è in `.gitignore`.

---

## Checklist avvio

```
[ ] docker ps → s1-tpm-db Up
[ ] curl http://localhost:8080/health → { ok: true }  (o 200)
[ ] curl -I http://localhost:8080/auth/google → HTTP 302 verso accounts.google.com
[ ] frontend su http://localhost:5173 → pagina login visibile
[ ] login Google → redirect a /auth/google/callback → token JWT → app caricata
```

---

## Google OAuth — dettagli configurazione

- **Client ID**: vedi Google Cloud Console → API e servizi → Credenziali
- **Redirect URI autorizzato** (configurato su Google Cloud Console):  
  `http://localhost:8080/auth/google/callback`
- Se si cambia porta del backend, aggiornare anche l'URI su [console.cloud.google.com](https://console.cloud.google.com) → API e servizi → Credenziali.
- In produzione aggiungere un secondo URI autorizzato con l'URL reale del backend (es. `https://api.tuodominio.com/auth/google/callback`) — non rimuovere quello locale, così entrambi gli ambienti funzionano in parallelo.

---

## Errori comuni

| Errore | Causa | Fix |
|--------|-------|-----|
| `GOOGLE_CLIENT_ID non configurato` | `backend/.env` mancante o PORT sbagliata | Verifica che `backend/.env` esista e abbia `GOOGLE_CLIENT_ID` |
| `redirect_uri_mismatch` (Google 400) | `BACKEND_URL` punta a porta diversa da quella registrata | Rimettere `BACKEND_URL=http://localhost:8080` in `backend/.env` |
| Frontend non raggiunge il backend | `VITE_API_URL` errato o mancante | Creare/correggere `frontend/.env.local` con `VITE_API_URL=http://localhost:8080` |
| DB connection refused | Container Docker non avviato | `docker compose up -d` |
| Migrations non applicate | Nuovo ambiente / schema cambiato | `cd backend && npx prisma db push && npx prisma generate` |
