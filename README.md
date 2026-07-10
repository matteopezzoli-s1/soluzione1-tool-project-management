# TPM — Tool Project Management

Tool interno Soluzione1 per la gestione di progetti e attività con viste Gantt, milestone, scadenze e KPI.

## Stack

| Layer | Tecnologie |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript (no component library) |
| Backend | Hono + Prisma 6 + TypeScript (Node in locale, Cloudflare Workers in produzione) |
| Database | PostgreSQL (Docker in locale su :5433, Neon in produzione via Hyperdrive) |
| Auth | Google OAuth 2.0 → JWT |
| Deploy | Cloudflare Workers (backend) + Cloudflare Pages (frontend), via GitHub Actions |

## Struttura del repository

```
soluzione1-tool-project-management/
├── backend/          # API REST Hono + Prisma
│   ├── prisma/       # Schema e migrations
│   ├── wrangler.toml # Config Cloudflare Worker (Hyperdrive, env.production)
│   └── src/          # app.ts (route), server.ts (dev Node), worker.ts (Cloudflare), auth.ts, services/
├── frontend/         # App React
│   └── src/
│       ├── pages/    # LoginPage, DashboardPage, ElencoAttivitaPage, GanttPage, ProgettiPage, RoadmapPage, ...
│       └── components/
├── docker-compose.yml
├── DEV_SETUP.md      # Guida ambiente locale
└── CI_CD_SETUP.md    # Guida CI/CD e deploy su Cloudflare
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
| PostgreSQL | 5433 |
| Backend | 8080 |
| Frontend | 5173 |

## Comandi principali

### Backend (`backend/`)

```bash
npm run dev                  # Dev server Node con hot-reload (nodemon + ts-node, src/server.ts)
npm run dev:worker           # Dev server su runtime Cloudflare Workers (wrangler dev, src/worker.ts)
npm run build                # Compila TypeScript → dist/
npm start                    # Avvia dist/server.js
npm run deploy               # Deploy su Cloudflare Workers (wrangler deploy)

npx prisma db push           # Sincronizza schema al DB (locale)
npx prisma generate          # Rigenera il client Prisma (dopo ogni modifica allo schema)
npx prisma studio            # Browser visuale del DB
npx prisma migrate deploy    # Applica migrations pendenti (CI/produzione, contro Neon)
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
- **Gantt** — timeline interattiva con drag & drop delle date, zoom, critical path, CRUD milestone, navigazione da tastiera (attualmente nascosta dalla navigazione, pagina e routing restano attivi per un riuso futuro)
- **Team / Account** — CRUD PM/PO e Account interni
- **Clienti / Progetti & Prodotti** — anagrafica clienti, progetti cliente e prodotti interni (stessa struttura dati, distinti dal campo `tipo`)
- **Roadmap Prodotti** — pianificazione delle iniziative sui prodotti interni per anno/trimestre, vista Lista e Kanban con drag & drop per la priorità, link Google Drive per l'analisi
- **Impostazioni** — stati attività, stati progetto e stati roadmap configurabili

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
| GET/POST/PUT/DELETE | `/progetti[/:id]` | CRUD progetti/prodotti (`?tipo=CLIENTE\|PRODOTTO`) |
| GET/POST/PUT/DELETE | `/api/roadmap-items[/:id]` | CRUD attività roadmap prodotti |
| PATCH | `/api/roadmap-items/:id/posizione` | Aggiorna priorità/trimestre (drag & drop roadmap) |
| GET/POST/PUT/DELETE | `/api/stati-roadmap[/:id]` | Stati roadmap configurabili |
| GET | `/auth/me` | Utente corrente |

## Deploy (Cloudflare)

Unico ambiente cloud esistente: solo `main` deploya (vedi [`.github/workflows/deploy-prod.yml`](./.github/workflows/deploy-prod.yml)). `develop` e gli altri branch passano solo dalla CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml): build + typecheck), nessun deploy.

- **Push su `main`** → GitHub Actions applica le migration Prisma sul DB di produzione (Neon), poi deploya il backend su **Cloudflare Workers** (`wrangler deploy --env production`) e il frontend su **Cloudflare Pages** (`wrangler pages deploy`)
- **Database**: Neon PostgreSQL, raggiunto dal Worker tramite binding **Hyperdrive** (config in `backend/wrangler.toml`)
- **Segreti**: `wrangler secret put` per il Worker, GitHub Actions secrets per la pipeline CI/CD (non `.env`)

Guida completa: [CI_CD_SETUP.md](./CI_CD_SETUP.md)

## Convenzioni

- I prefissi CSS (`db-`, `dash-`, `ea-`, `gp-`, `tm-`, `pr-`, `rm-`, `imp-`) evitano collisioni tra pagine — usare sempre il prefisso della pagina corrente per le nuove classi.
- Quando si aggiunge una nuova pagina, aggiornare il tipo `NavPage` in `frontend/src/App.tsx`.
- Il campo `stato` delle attività/progetti/roadmap è una chiave stringa che referenzia la relativa config (`StatoAttivitaConfig`, `StatoProgettoConfig`, `StatoRoadmapConfig`), non un enum.
- Progetti e Prodotti condividono la stessa tabella (`Progetto`), distinti dal campo `tipo` (`CLIENTE`/`PRODOTTO`) — pensato per un futuro import da un'unica fonte esterna senza dover mappare due entità diverse.
- **Sforamento**: `giornateConsuntivate > giornateVendute`, o consuntivate > 0 quando vendute è null.
