# TPM — Tool Project Management

Tool interno Soluzione1 per la gestione di progetti e attività con viste Gantt, milestone, scadenze e KPI.

## Stack

| Layer | Tecnologie |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript (no component library) |
| Backend | Express 5 + Prisma 6 + TypeScript |
| Database | PostgreSQL (Docker in locale, Cloud SQL in produzione) |
| Auth | Google OAuth 2.0 → JWT |
| Deploy | Google Cloud Run + Cloud Build |

## Struttura del repository

```
soluzione1-tool-project-management/
├── backend/          # API REST Express + Prisma
│   ├── prisma/       # Schema e migrations
│   └── src/          # index.ts (entry point), auth.ts, services/
├── frontend/         # App React
│   └── src/
│       ├── pages/    # LoginPage, DashboardPage, ElencoAttivitaPage, GanttPage, ...
│       └── components/
├── docs/             # gcp-setup.md
├── docker-compose.yml
└── DEV_SETUP.md      # Guida ambiente locale
```

## Avvio rapido (sviluppo locale)

> Istruzioni dettagliate con variabili d'ambiente e troubleshooting: [DEV_SETUP.md](./DEV_SETUP.md)

**Prerequisiti**: Node.js 20+, Docker, credenziali Google OAuth configurate su Google Cloud Console.

```bash
# 1. Database
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env   # compilare con le credenziali Google e JWT_SECRET
npm install
npx prisma db push
npx prisma generate
npm run dev            # → http://localhost:8080

# 3. Frontend (altro terminale)
cd frontend
cp .env.example .env.local   # VITE_API_URL=http://localhost:8080
npm install
npm run dev            # → http://localhost:5173
```

### Porte locali

| Servizio | Porta |
|----------|-------|
| PostgreSQL | 5432 |
| Backend | 8080 |
| Frontend | 5173 |

## Comandi principali

### Backend (`backend/`)

```bash
npm run dev                  # Dev server con hot-reload
npm run build                # Compila TypeScript → dist/
npm start                    # Avvia dist/index.js

npx prisma db push           # Sincronizza schema al DB (locale)
npx prisma generate          # Rigenera il client Prisma (dopo ogni modifica allo schema)
npx prisma studio            # Browser visuale del DB
npx prisma migrate deploy    # Applica migrations pendenti (CI/produzione)
```

> Non usare `npx prisma migrate dev` in locale — usa sempre `npx prisma db push`.

### Frontend (`frontend/`)

```bash
npm run dev      # Vite dev server
npm run build    # Build di produzione → dist/
npm run lint     # ESLint
npm run preview  # Serve la build di produzione in locale
```

## Funzionalità principali

- **Dashboard** — KPI (attività attive, clienti, in scadenza, in ritardo), lista scadenze, scorciatoie
- **Elenco Attività** — filtri, raggruppamento per cliente/progetto, drawer di dettaglio, export CSV
- **Gantt** — timeline interattiva con drag & drop delle date, zoom, critical path, CRUD milestone, navigazione da tastiera
- **Team / Account** — CRUD Project Manager e Account interni
- **Clienti / Progetti** — anagrafica clienti e progetti
- **Impostazioni** — stati attività e stati progetto configurabili

## API principali

Tutti gli endpoint richiedono `Authorization: Bearer <jwt>`.

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/api/attivita` | Attività raggruppate per cliente+progetto |
| POST/PUT/DELETE | `/api/attivita[/:id]` | CRUD attività |
| PATCH | `/api/attivita/:id/dates` | Aggiorna solo `inizio`/`deadline` (Gantt drag) |
| GET/POST | `/api/gantt/milestones` | Milestone Gantt |
| PUT/DELETE | `/api/gantt/milestones/:id` | Aggiorna/elimina milestone |
| GET/POST | `/api/stati-attivita` | Stati attività configurabili |
| GET/POST | `/api/stati-progetto` | Stati progetto configurabili |
| GET | `/auth/me` | Utente corrente |

## Deploy (Google Cloud Platform)

- **Push su `develop`** → Cloud Build deploya su Cloud Run (ambiente dev)
- **Push su `main`** → Cloud Build deploya su Cloud Run (produzione)
- **Database**: Cloud SQL PostgreSQL, connessione via Unix socket su Cloud Run
- **Segreti**: gestiti con GCP Secret Manager (non `.env`)

Guida completa: [docs/gcp-setup.md](./docs/gcp-setup.md)

## Convenzioni

- I prefissi CSS (`db-`, `dash-`, `ea-`, `gp-`, `tm-`) evitano collisioni tra pagine — usare sempre il prefisso della pagina corrente per le nuove classi.
- Quando si aggiunge una nuova pagina, aggiornare il tipo `NavPage` in `frontend/src/App.tsx`.
- Il campo `stato` delle attività è una chiave stringa che referenzia `StatoAttivitaConfig.chiave`, non un enum.
- **Sforamento**: `giornateConsuntivate > giornateVendute`, o consuntivate > 0 quando vendute è null.
