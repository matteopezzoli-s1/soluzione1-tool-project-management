# CI/CD — GitHub Actions → Cloudflare Workers

Pipeline per TPM (Tool Project Management). Un solo ambiente cloud esiste: **produzione**. Non c'è un ambiente "dev" cloud separato — `develop` (branch di default del repo) e ogni altro branch sono solo lavoro in corso / PR review, senza alcun deploy.

> **Verifica di partenza**: al momento della stesura, questo repo **non aveva nessun workflow GitHub Actions** (`.github/workflows` inesistente, verificato via API GitHub) — nessuna automazione di documentazione o altro. I due workflow qui sotto sono stati creati da zero. Il guard `[skip ci]` in entrambi è comunque già cablato, così se in futuro viene aggiunta un'automazione che committa direttamente (es. un bot di documentazione), basta includere `[skip ci]` nel messaggio di commit per non innescare build/deploy involontari — nessuna modifica ai workflow sarà necessaria a quel punto.

## Workflow creati

| File | Trigger | Cosa fa |
|---|---|---|
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | push/PR su **qualsiasi branch** (incluso `develop`) | build + lint backend e frontend. **Mai un deploy.** |
| [.github/workflows/deploy-prod.yml](.github/workflows/deploy-prod.yml) | push su **`main`** (solo) | `prisma migrate deploy` → `wrangler deploy` (backend) → build Vite → `wrangler pages deploy` (frontend) |

`deploy-prod.yml` applica prima le migration sul DB di produzione (Neon `s1-tpm-prod`): se la migration falisce, il job si ferma con errore visibile e **non arriva a deployare il Worker** — niente schema disallineato in produzione. Il deploy del frontend parte solo se quello del backend è andato a buon fine (`needs: deploy-backend`).

---

## 1. Secret da creare su GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**.

| Nome secret | Cosa contiene | Dove si trova |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Token API Cloudflare con permessi minimi | Vedi sezione 2 sotto |
| `CLOUDFLARE_ACCOUNT_ID` | `35a1e0009c737f6885e7515d79008c25` (Board@soluzione1.it's Account) | `wrangler whoami` in locale, o dashboard Cloudflare in alto a destra |
| `NEON_PROD_DIRECT_URL` | Connection string **diretta** (non pooled, senza `-pooler` nell'host) del progetto Neon `s1-tpm-prod` | Console Neon → progetto `s1-tpm-prod` → Connect → "Direct connection" |

> ⚠️ **`NEON_PROD_DIRECT_URL` non è nella richiesta originale ma è indispensabile**: `prisma migrate deploy` nel job `deploy-backend` deve autenticarsi contro Neon per applicare le migration, e le migration richiedono sempre la connessione diretta (mai il pooler in transaction mode). Senza questo secret il passo di migration fallisce.

---

## 2. Creare il token API Cloudflare (permessi minimi)

Dashboard Cloudflare → icona profilo (in alto a destra) → **My Profile → API Tokens → Create Token → Create Custom Token**.

Permessi da assegnare (**non** "Account – Administrator"):

| Risorsa | Permesso | Perché |
|---|---|---|
| Account → **Workers Scripts** | Edit | Deploy del backend (`wrangler deploy`) |
| Account → **Cloudflare Pages** | Edit | Deploy del frontend (`wrangler pages deploy`) — **non era nella richiesta originale ma è obbligatorio**, altrimenti il job `deploy-frontend` fallisce con "Authentication error" |

Non serve **Workers Routes** (nessuna zona/dominio è collegata a questo account Cloudflare al momento — il Worker gira su `*.workers.dev` — vedi nota in fondo). Se in futuro si collega un dominio custom, andrà aggiunto anche quel permesso.

**Account Resources**: limita a "Board@soluzione1.it's Account" (non "All accounts").

Copia il token generato (mostrato una sola volta) e incollalo nel secret `CLOUDFLARE_API_TOKEN` su GitHub.

---

## 3. Branch protection su `main`

Repo → **Settings → Branches → Add branch protection rule**.

- Branch name pattern: `main`
- ✅ **Require a pull request before merging**
- ✅ **Require approvals** (almeno 1)
- ✅ **Require status checks to pass before merging** → seleziona i job `backend` e `frontend` di `ci.yml`, così una PR non può essere mergiata se la build è rotta
- (Opzionale ma consigliato) ✅ **Do not allow bypassing the above settings** — evita che un push diretto salti la pipeline anche per gli admin

Questo garantisce che ogni merge su `main` (quindi ogni deploy in produzione) sia passato da una PR review, non da un push diretto.

---

## 4. `wrangler dev` in locale — non tocca mai produzione

Il dev locale (sul Mac di Matteo, o di chiunque lavori al progetto) non richiede né push né alcun token Cloudflare:

- `npm run dev` (in `backend/`) → server Node via `@hono/node-server`, punta al Postgres Docker locale (`s1-tpm-db`) tramite `DATABASE_URL` in `backend/.env`
- `npm run dev:worker` → `wrangler dev`, runtime Workers **in locale**. Il binding `HYPERDRIVE` di default in `wrangler.toml` ha un `localConnectionString` che punta allo stesso Postgres Docker locale — `wrangler dev` (senza `--remote`) lo usa sempre, non contatta mai la vera risorsa Hyperdrive/Neon di produzione

La vera config Hyperdrive → Neon esiste solo sotto `[env.production]` in `wrangler.toml`, ed è quella che il workflow `deploy-prod.yml` attiva con `wrangler deploy --env production`. Nessun comando locale, nemmeno `wrangler dev`, la raggiunge mai.

---

## 5. Backup manuale Neon prima di merge con migration "dati sensibili"

`deploy-prod.yml` applica automaticamente `prisma migrate deploy` sul DB Neon di produzione ad ogni push su `main` — nessuna conferma manuale, nessuno step di pausa. Per le migration che **spostano/trasformano dati esistenti** (non solo `CREATE TABLE`/`ADD COLUMN` additivi), le tabelle `_backup_*` create dalla migration stessa (dentro la stessa transazione, vedi es. `20260711164615_migrate_pm_account_to_users`) sono già una prima rete di sicurezza — ma vivono nello stesso DB e non proteggono da un errore di infrastruttura (es. un rollback di Neon andato male, o la necessità di ripristinare uno stato precedente all'intera migration).

Prima di mergiare su `main` una PR che include una migration di questo tipo, esegui **manualmente** un backup esterno del DB Neon di produzione:

```bash
# Richiede la connection string diretta di Neon prod (stessa usata da NEON_PROD_DIRECT_URL),
# recuperabile da Neon Console → Project → Connection Details → "Direct connection".
pg_dump "postgresql://<user>:<password>@<host>/<db>?sslmode=require" \
  --format=custom \
  --file="neon_prod_backup_$(date +%Y%m%d_%H%M%S).dump"
```

Conserva il file `.dump` fuori dal repo (es. locale o storage aziendale), non committarlo. Per un ripristino completo in caso di problemi:

```bash
pg_restore --clean --if-exists -d "postgresql://<user>:<password>@<host>/<db>?sslmode=require" neon_prod_backup_<timestamp>.dump
```

In alternativa, Neon offre anche gli **snapshot/branch point-in-time restore** nativi (Neon Console → Branches → "Restore"), utilizzabili come rete di sicurezza aggiuntiva senza dover gestire un file `.dump` — consigliato in aggiunta al `pg_dump` manuale per le migration più delicate.

### Rollback dopo una migration "dati sensibili"

Se dopo il deploy emerge un problema con una migration di questo tipo (es. `20260711164615_migrate_pm_account_to_users`), ci sono due livelli di ripristino, dal più mirato al più drastico:

1. **Ripristino mirato dalle tabelle `_backup_*`** (nessun downtime, resta nello stesso DB) — utile se il problema è nei dati spostati ma lo schema successivo (nuove colonne/FK) va tenuto:
   ```sql
   -- Esempio: ripristinare account_id su clienti/attivita ai valori pre-migrazione
   UPDATE clienti c SET account_id = b.account_id FROM _backup_clienti_fk b WHERE c.id = b.id;
   UPDATE attivita a SET account_id = b.account_id FROM _backup_attivita_fk b WHERE a.id = b.id;
   UPDATE progetti p SET po_id = b.po_id FROM _backup_progetti_fk b WHERE p.id = b.id;
   -- I dati originali di project_managers/accounts restano leggibili in:
   --   SELECT * FROM _backup_project_managers;
   --   SELECT * FROM _backup_accounts;
   ```
   Le tabelle `_backup_*` non vengono mai droppate automaticamente: restano nel DB come audit trail finché qualcuno non le rimuove esplicitamente.

2. **Ripristino completo da `pg_dump`** (rollback totale, riporta il DB allo stato pre-deploy, **downtime**):
   ```bash
   pg_restore --clean --if-exists -d "postgresql://<user>:<password>@<host>/<db>?sslmode=require" neon_prod_backup_<timestamp>.dump
   ```
   Dopo un ripristino completo, verifica che `backend/prisma/migrations` sul branch deployato corrisponda allo stato del DB ripristinato (altrimenti il prossimo `prisma migrate deploy` potrebbe tentare di riapplicare migration già presenti nel dump — la guard di idempotenza nella migration stessa previene danni, ma verifica comunque `prisma migrate status` prima di un nuovo deploy).

---

## Nota sul dominio Worker

Il backend di produzione gira oggi su `https://tpm-backend-production.soluzione1.workers.dev` — sottodominio `*.workers.dev` legato all'account Cloudflare (non un dominio custom, perché nessuna zona DNS è collegata all'account). Se il sottodominio account cambia di nuovo in futuro (come già successo una volta), va aggiornato **sia** `BACKEND_URL` sotto `[env.production]` in `backend/wrangler.toml` **sia** `PROD_BACKEND_URL` in `.github/workflows/deploy-prod.yml`, poi va rilanciato il deploy.

## Pipeline Google Cloud Build (rimossa)

Il deploy su Cloudflare è confermato stabile in produzione: `cloudbuild-backend.yaml`, `cloudbuild-frontend.yaml` e `docs/gcp-setup.md` sono stati rimossi. Cloudflare (Workers + Pages, vedi `.github/workflows/deploy-prod.yml`) è l'unica pipeline di deploy.
