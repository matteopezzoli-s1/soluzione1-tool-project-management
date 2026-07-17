# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**TPM (Tool Project Management)** — Internal project management tool for Soluzione1. Tracks activities, projects with Gantt views, milestones, and a unified user directory (PM/PO, Account, Board, DevHub roles). Frontend in React, backend in Hono + Prisma + PostgreSQL.

## Commands

### Backend (in `backend/`)

```bash
npm run dev        # Node dev server con hot-reload (nodemon + ts-node, src/server.ts)
npm run dev:worker # Dev server su runtime Cloudflare Workers (wrangler dev, src/worker.ts)
npm run build      # Compile TypeScript → dist/
npm start          # Run compiled dist/server.js
npm run deploy     # Deploy su Cloudflare Workers (wrangler deploy)

npx prisma db push             # Sync schema to DB without migration history (use this locally)
npx prisma migrate deploy      # Apply pending migrations (CI/prod only)
npx prisma generate            # Regenerate Prisma client after schema changes
npx prisma studio              # Visual DB browser

npm run db:sync                # db push + generate + seed in one go — the go-to command for a fresh local DB
```

> ⚠️ Do NOT use `npx prisma migrate dev` locally — it causes conflicts with existing modified migrations. Always use `npx prisma db push` for local schema sync.
> After any change to `schema.prisma`, run `npx prisma generate` before restarting the backend.

### Frontend (in `frontend/`)

```bash
npm run dev        # Vite dev server on :5173
npm run build      # Production build → dist/
npm run lint       # ESLint
npm run preview    # Serve production build locally
```

### Local DB

```bash
docker compose up -d    # Start PostgreSQL on :5433 (container: s1-tpm-db)
docker compose down     # Stop
```

## Architecture

### Frontend

- **React 19 + Vite + TypeScript** — no component library, plain CSS
- **State-based routing**: `App.tsx` holds a `NavPage` union type; pages are rendered via conditionals, no react-router
- **CSS design system**: custom tokens in `index.css`; each page has its own CSS file with a unique prefix to avoid collisions:
  - `db-` — App shell / sidebar / header
  - `dash-` — DashboardPage
  - `ea-` — ElencoAttivitaPage
  - `gp-` — GanttPage
  - `ut-` — UtentiPage
- **Auth**: Google OAuth → JWT stored in `localStorage`, sent as `Authorization: Bearer <token>` on all API calls
- **Pages**:
  - `LoginPage` — Google OAuth entry point
  - `DashboardPage` — KPI cards (attività attive, clienti, in scadenza, in ritardo), liste scadenze, scorciatoie
  - `ElencoAttivitaPage` — Activity list with filters, grouped view, detail drawer, CSV export; due viste: "Standard" e "Ordini bucket" (tipo `BUCKET`, con righe espandibili sul rapportino mensile consuntivate/fatturate)
  - `GanttPage` — Custom Gantt timeline: drag & drop dates, zoom levels, critical path, milestone CRUD, keyboard nav
  - `UtentiPage` — unified user directory CRUD (replaces the old separate PM/Account pages): role chips (`ACCOUNT`/`PM`/`BOARD`/`DEVHUB`), multi-role assignment via fixed toggle-chips (roles are an application-level enum, not a user-editable list)
  - `ClientiPage` / `ProgettiPage` — CRUD for Clients and Projects
  - `ImpostazioniPage` — layout a due pannelli (nav laterale a gruppi "Stati e tag" / "Integrazioni" + contenuto): stati attività/progetti/roadmap, tag roadmap, Notifiche Presale (con sotto-gruppo "Configurazione SAIOT")
  - `ConsuntiviZohoPage` (prefisso CSS `cz-`) — pagina di primo livello per ruoli Board/PM/Account: selezione progetti Zoho + import consuntivazioni con preview diff (modal condiviso `components/ZohoImportModal.tsx`, prefisso `zi-`) + sezione "Storico import" (sessioni degli ultimi 5 giorni con delta giornate per attività e utente che ha importato)

### Backend

- **Hono + Prisma 6 + PostgreSQL** — TypeScript, runtime-agnostic route definitions in `src/app.ts`, with two entry points: `src/server.ts` (Node, dev locale via `@hono/node-server`) and `src/worker.ts` (Cloudflare Workers, produzione — legge la connessione DB da un binding Hyperdrive)
- **Auth routes** (`src/auth.ts` + `app.ts`): `GET /auth/google` → Google OAuth, `GET /auth/google/callback` → **upsert `User` per email** (email esistente → collega `googleId`/aggiorna nome/avatar mantenendo i ruoli già assegnati; email nuova → crea l'utente con `roles: []`) → firma il JWT con `userId`, `GET /auth/me` → legge l'utente dal DB (non solo dal token) e ritorna `{ id, email, name, firstName, lastName, avatarUrl, roles }`
- **REST API**: all routes protected by JWT middleware

  **Legacy routes (no `/api/` prefix):**
  - `GET/POST /clienti` — Clients
  - `PUT/DELETE /clienti/:id`
  - `GET/POST /progetti` — Projects (include `po`, `responsabileDevHub` — solo per `tipo: "PRODOTTO"`)
  - `PUT/DELETE /progetti/:id`

  **Current routes (`/api/` prefix):**
  - `GET /api/users` — lista utenti, ordinata per `lastName`/`firstName`/`name`; `?role=ACCOUNT|PM|BOARD|DEVHUB` filtra per ruolo (usato per popolare le tendine)
  - `POST /api/users` — crea utente (`firstName`, `lastName`, `email?`, `roles: UserRole[]`); `409` su email duplicata
  - `PUT /api/users/:id` — aggiorna anagrafica + ruoli
  - `DELETE /api/users/:id` — **guard "in uso"**: `409` con conteggio dettagliato se l'utente è PM di attività, PO/Responsabile DevHub di progetti, o account di clienti/attività
  - `GET /api/attivita` — Activities grouped by cliente+progetto with sforamento sort
  - `POST /api/attivita` — Create activity
  - `PUT /api/attivita/:id` — Update activity
  - `DELETE /api/attivita/:id` — Delete activity
  - `PATCH /api/attivita/:id/dates` — Update only `inizio` and `deadline` (used by Gantt drag & drop)
  - `PUT /api/attivita/:id/fatturato-mensile` — rapportino PM sugli ordini bucket: upsert delle giornate fatturate per mese (`{mesi: [{mese: "YYYY-MM", giornateFatturate}]}`) e riallineamento di `Attivita.giornateFatturate` alla somma dei mesi (per i bucket il totale è derivato, non editato a mano)
  - `GET/POST /api/stati-attivita` — Configurable activity states
  - `PUT/DELETE /api/stati-attivita/:id`
  - `GET/POST /api/stati-progetto` — Configurable project states
  - `PUT/DELETE /api/stati-progetto/:id`
  - **Zoho Projects — import consuntivazioni** (tutte con middleware `requireRole('BOARD', 'PM', 'ACCOUNT')`, primo enforcement server-side dei ruoli; rispondono `503` se le env `ZOHO_*` mancano):
    - `GET /api/zoho/projects` — lista progetti attivi da Zoho + flag `selected` (selezione persistita in `AppConfig`, chiave `zoho_selected_projects`)
    - `PUT /api/zoho/selection` — salva gli id dei progetti selezionati per l'import
    - `POST /api/zoho/consuntivi/:projectId` — ore consuntivate di UN progetto aggregate per codice `GO-ORDV-YYYY-N` (join timelog → tasklist → milestone, scansione mensile — vedi `services/zohoService.ts`); il frontend itera sui progetti selezionati e somma i codici (rate limit Zoho ~100 req/2min + limiti subrequest Workers)
    - `POST /api/zoho/import/preview` — diff codici aggregati vs attività (match su `riferimentoOrdineVendita` = codice senza prefisso `GO-ORDV-`, come l'import CSV manuale)
    - `POST /api/zoho/import/confirm` — conferma dell'import: applica gli aggiornamenti (stessa semantica di `bulk-consuntivato`, valori "prima" riletti dal DB), salva il breakdown mensile in `AttivitaConsuntivoMese` (upsert per attività+mese, preservando le fatturate compilate dal PM) e registra una `ZohoImportSession` con i delta per attività (solo righe con delta ≠ 0)
    - `GET /api/zoho/import/sessions` — storico sessioni import degli ultimi 5 giorni (utente + righe delta); entrambe le route eliminano le sessioni più vecchie di 5 giorni
  - **Google Drive** (`components/DriveLinkField.tsx` prefisso `dlf-`, `lib/googleDrive.ts`, `lib/useDriveConfig.ts`): campi link "dual-mode" (URL manuale o Google Picker) su Roadmap analisi e i 3 link presale. `GET/PUT /api/config/google-drive` — radici dei drive condivisi (`AppConfig`: `gdrive_dev_*` Sviluppo per roadmap+presale analisi/stima, `gdrive_comm_*` Commerciale per trattativa; PUT solo `requireRole('BOARD')`, estrazione ID da URL cartella/shared drive). Il Picker (scope `drive` completo — app interna Workspace, serve per creare doc e risolvere cartelle; tutto client-side, nessun token server) compare solo se `VITE_GOOGLE_CLIENT_ID` + `VITE_GOOGLE_API_KEY` sono valorizzate; la fase Stima apre il picker vincolato alla cartella dell'analisi (`Attivita.presaleDriveFolderId`, salvata dal picker o risolta via Drive API anche per link incollati a mano) e ha il bottone "Crea nuovo doc" che crea il Google Doc dell'analisi di dettaglio direttamente in quella cartella (`createDriveDoc` in `lib/googleDrive.ts`); solo Stima — sull'offerta (drive Commerciale) si sceglie sempre la cartella a mano. Validazione link http(s) su `analisiUrl` + link presale: **solo valori nuovi/modificati** (i valori storici non-URL sono tollerati finché non toccati e mostrati come "link non valido" in UI)
  - `GET /api/gantt/milestones` — Gantt milestones (optional `?activityId=` filter)
  - `POST /api/gantt/milestones` — Create milestone
  - `PUT /api/gantt/milestones/:id` — Update milestone
  - `DELETE /api/gantt/milestones/:id` — Delete milestone

  > `/pm` e `/accounts` (alias di sola lettura verso `/api/users?role=PM|ACCOUNT`, introdotti durante la migrazione da `ProjectManager`/`Account` a `User`) sono stati rimossi una volta aggiornato il frontend — vedi sezione Prisma Schema Key Models.

- **Environment variables** (via `.env` — gitignored): `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `FRONTEND_URL`, `BACKEND_URL`, `PORT`, più `ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET`/`ZOHO_REFRESH_TOKEN`/`ZOHO_PORTAL_ID` (+ opzionali `ZOHO_ACCOUNTS_URL`/`ZOHO_PROJECTS_API_URL`, default datacenter EU) per l'import consuntivazioni da Zoho Projects. NB: `npm run dev` carica `.env` via dotenv-cli **all'avvio** — dopo una modifica a `.env` serve riavviare il dev server (nodemon non lo rilegge)
- **Local JWT secret**: `dev-local-secret-cambia-in-prod` (the value in local `.env` — different from what DEV_SETUP.md may say)

### Prisma Schema Key Models

- `User` — **unified people directory** (was split across `ProjectManager` + `Account` until the 2026-07 migration; those models no longer exist). Fields: `googleId`/`email`/`name` (all nullable — a user can exist purely as anagrafica, never having logged in), `firstName`, `lastName`, `avatarUrl`, `roles: UserRole[]` (Postgres array, default `[]`). `enum UserRole { ACCOUNT PM BOARD DEVHUB }` — **4 fixed application roles**, not a user-editable list; a user can hold multiple roles at once (e.g. `{PM, ACCOUNT}`). Relations: `progettiPO` (PO of a Progetto), `progettiDevHub` (Responsabile DevHub of a Progetto), `attivitaPM` (PM of an Attivita, via `AttivitaPM` join table), `clientiAccount` (Account of a Cliente), `attivitaAccount` (Account of an Attivita), plus the pre-existing OAuth/Gantt relations (`ownedProjects`, `memberships`, `assignedTasks`, etc.)
  - This iteration only wires roles as anagrafica + dropdown filters (`?role=` query param) — **no permission enforcement** based on role yet.
  - Login (`/auth/google/callback`) upserts by email: never overwrites existing `roles`, only fills `firstName`/`lastName` if empty.
- `Cliente`, `Progetto` — client and project registry. `Progetto.responsabileDevHubId` (nullable, `User` with role `DEVHUB`) — new field, only meaningful for `tipo: "PRODOTTO"`, alongside the existing `poId` (nullable, `User` with role `PM`)
- `Attivita` — activity tracking: `cliente`, `progetto`, `attivita`, `stato` (string key → `StatoAttivitaConfig`), dates (`inizio`, `deadline`), `giornateVendute`, `giornateConsuntivate`, notes, `accountId` → `User` (role `ACCOUNT`), `pms` → `AttivitaPM` join table → `User` (role `PM`, many-to-many)
- `AttivitaConsuntivoMese` — dettaglio mensile di un'attività (`mese` "YYYY-MM", unique su attività+mese): `giornateConsuntivate` alimentate dall'import Zoho (che aggrega i timelog per mese), `giornateFatturate` compilate dal PM dal rapportino nella vista "Ordini bucket" di ElencoAttivitaPage (righe espandibili; il totale fatturate dell'attività è la somma dei mesi). `GET /api/attivita` include `consuntiviMese` solo con `?tipo=BUCKET`
- `StatoAttivitaConfig` — configurable activity states with `chiave`, `label`, `colore`, `isArchiviato`, `ordine`
- `StatoProgettoConfig` — configurable project states (same shape)
- `GanttMilestone` — milestone linked to an `Attivita`: `title`, `date`, `color`, `icon`
- `Project`, `Task`, `Milestone`, `TaskDependency`, `ActivityLog` etc. — full Gantt/project models present in schema (future features, not yet exposed via API), all keyed off the same unified `User`
- **Sforamento** (budget overflow): `giornateConsuntivate > giornateVendute`, or consuntivate > 0 when vendute is null

### Frontend `.env.local` (gitignored)

```
VITE_API_URL=http://localhost:8080
```

Vite reads this at server start. If missing, the login page shows "VITE_API_URL non impostato".

Opzionali per il Google Drive Picker (il bottone "Scegli da Drive" compare solo se entrambe valorizzate):

```
VITE_GOOGLE_CLIENT_ID=<stesso OAuth client del login>
VITE_GOOGLE_API_KEY=<API key Google Cloud con Picker API abilitata>
```

## Deploy (Cloudflare)

- **GitHub Actions trigger**: only push to `main` deploys (`.github/workflows/deploy-prod.yml`); `develop` and other branches only run CI (`ci.yml` — build + typecheck, no deploy)
- **Backend**: Cloudflare Workers (`wrangler deploy --env production`), reads secrets via `wrangler secret put`
- **Frontend**: Cloudflare Pages (`wrangler pages deploy`), with `VITE_API_URL` injected at build time
- **Database**: Neon PostgreSQL, reached from the Worker via the `HYPERDRIVE` binding configured in `backend/wrangler.toml`
- Full setup instructions: `CI_CD_SETUP.md`

## Key Conventions

- CSS class prefixes per page avoid global collisions — always use the page's prefix for new classes
- `NavPage` type in `App.tsx` must be updated whenever a new page is added
- Run `npx prisma generate` after every schema change before restarting the backend
- Use `npx prisma db push` (not `migrate dev`) for local schema changes
- Activity states (`stato` field) are stored as string keys referencing `StatoAttivitaConfig.chiave` — not hardcoded enum values
- `FRONTEND_URL` in `backend/.env` must match the Vite dev server port (`:5173`) for OAuth redirects to work
- `User.roles` is a fixed 4-value application enum (`ACCOUNT`/`PM`/`BOARD`/`DEVHUB`) — render it as toggle-chips/checkboxes in the UI, never as a free-text or user-editable list
- Use `npm run db:sync` (in `backend/`) to bring a fresh local DB up to date in one step: `prisma db push && prisma generate && prisma db seed`
