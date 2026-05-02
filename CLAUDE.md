# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**s1-gantt** — Internal project management tool for Soluzione1. Tracks activities (Elenco Attività), projects with Gantt views, project managers, and accounts. Frontend in React, backend in Express + Prisma + PostgreSQL.

## Commands

### Backend (in `backend/`)

```bash
npm run dev        # Start with hot-reload (ts-node-dev)
npm run build      # Compile TypeScript → dist/
npm start          # Run compiled dist/index.js

npx prisma migrate dev --name <name>   # Create + apply a migration
npx prisma migrate deploy              # Apply pending migrations (CI/prod)
npx prisma generate                    # Regenerate Prisma client after schema changes
npx prisma studio                      # Visual DB browser
```

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
docker compose up -d    # Start PostgreSQL on :5432 (container: s1-gantt-db)
docker compose down     # Stop
```

## Architecture

### Frontend

- **React 19 + Vite 8 + TypeScript** — no component library, plain CSS
- **State-based routing**: `App.tsx` holds a `NavPage` union type; pages are rendered via `if/switch`, no react-router
- **CSS design system**: custom tokens defined in `index.css`; each page has its own CSS file with a unique prefix (`tm-` for Team, `ea-` for ElencoAttività, `db-` for Dashboard, etc.) to avoid collisions
- **Auth**: Google OAuth → JWT stored in `localStorage`, sent as `Authorization: Bearer <token>` on all API calls; `LoginPage` handles the `?token=` callback URL
- **Pages**: `LoginPage`, `TeamPage` (Project Managers CRUD), `TeamAccountPage` (Accounts CRUD), `ElencoAttivitaPage` (Activity list with filters, grouped view, detail drawer, CSV export)

### Backend

- **Express 5 + Prisma 6 + PostgreSQL** — TypeScript, single `src/index.ts` entry point
- **Auth routes** (`src/auth.ts`): `GET /auth/google` → Google OAuth, `GET /auth/google/callback` → JWT issue, `GET /auth/me`
- **REST API**: all routes prefixed `/api/`, protected by JWT middleware
  - `GET/POST/PUT/DELETE /api/pm` — Project Managers
  - `GET/POST/PUT/DELETE /api/accounts` — Accounts
  - `GET /api/attivita` — Activities grouped by client+project with sforamento (budget overflow) sort
- **Environment variables** (via `.env` — gitignored): `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `FRONTEND_URL`, `BACKEND_URL`, `PORT`

### Prisma Schema Key Models

- `ProjectManager`, `Account` — internal registry models
- `Attivita` — activity tracking: `cliente`, `progetto`, `attivita`, `giornateVendute`, `giornateConsuntivate`, `stato` (enum `StatoAttivita`), dates, notes
- **Sforamento** (budget overflow): `giornateConsuntivate > giornateVendute`, or consuntivate > 0 when vendute is null
- `User`, `Project`, `Task`, `Milestone`, `TaskDependency`, `ActivityLog` — full Gantt/project models (future features)

### Frontend `.env.local` (gitignored)

```
VITE_API_URL=http://localhost:8080
```

Vite reads this at server start. If missing, the login page shows "VITE_API_URL non impostato".

## Deploy (GCP)

- **Cloud Build triggers**: push to `develop` → deploy to dev Cloud Run; push to `main` → deploy to prod
- **Backend**: Dockerized Node.js on Cloud Run, reads secrets from GCP Secret Manager
- **Frontend**: Dockerized Nginx serving the Vite build, with `VITE_API_URL` injected at build time via Cloud Build substitutions
- **Database**: Cloud SQL PostgreSQL; connection string uses Unix socket format for Cloud Run (`?host=/cloudsql/PROJECT:REGION:INSTANCE`)
- Full setup instructions: `docs/gcp-setup.md`

## Key Conventions

- CSS class prefixes per page avoid global collisions — always use the page's prefix for new classes
- `NavPage` type in `App.tsx` must be updated whenever a new page is added
- Run `npx prisma generate` after every schema change before restarting the backend
- Italian labels for `StatoAttivita` enum values are mapped in `backend/src/index.ts` via `STATO_LABEL` constant, not in the DB
- `FRONTEND_URL` in `backend/.env` must match the Vite dev server port (`:5173`) for OAuth redirects to work
