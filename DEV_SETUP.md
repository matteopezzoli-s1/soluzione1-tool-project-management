# Dev Environment — s1 Gantt (Locale)

> Questo file descrive **esclusivamente l'ambiente di sviluppo locale**.  
> In produzione/staging le porte, gli URL e i redirect URI OAuth cambieranno — sarà necessario aggiornare le variabili d'ambiente del server e aggiungere i nuovi URI autorizzati su Google Cloud Console.

## Porte

| Servizio   | Porta |
|------------|-------|
| PostgreSQL | 5432  |
| Backend    | 8080  |
| Frontend   | 5173  |

---

## Avvio completo (ordine obbligatorio)

### 1. Database (Docker)
```bash
docker compose up -d
```
Verifica: `docker ps` deve mostrare `s1-gantt-db` in stato `Up`.

### 2. Backend
```bash
cd backend && npm run dev
```
Il comando usa `dotenv -e .env -- nodemon src/index.ts`.  
Verifica: il log deve stampare:
```
[s1-gantt] Backend → http://localhost:8080
[s1-gantt] Callback → http://localhost:8080/auth/google/callback
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
DATABASE_URL="postgresql://gantt:gantt_dev_pwd@localhost:5432/s1-gantt-dev"
JWT_SECRET="dev_jwt_secret_local"
PORT=8080

GOOGLE_CLIENT_ID="<vedi Google Cloud Console>"
GOOGLE_CLIENT_SECRET="<vedi Google Cloud Console>"
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:8080
```
> **ATTENZIONE**: `BACKEND_URL` deve essere `http://localhost:8080` — è l'URL usato per costruire il callback OAuth Google. Cambiarlo rompe il login.

### `frontend/.env.local`
```
VITE_API_URL=http://localhost:8080
```
> Deve puntare alla porta del backend. Se non esiste, crearlo — il file è in `.gitignore`.

---

## Checklist avvio

```
[ ] docker ps → s1-gantt-db Up
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
| Migrations non applicate | Nuovo ambiente / schema cambiato | `cd backend && npx prisma migrate deploy` |
