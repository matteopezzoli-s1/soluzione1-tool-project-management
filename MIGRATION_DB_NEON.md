# Migrazione database: GCP Cloud SQL → Neon Postgres

Guida passo-passo per migrare i dati da Cloud SQL (istanza `soluzione1-progetti-interni:europe-west1:s1-progetti-interni`) a Neon, in preparazione della migrazione completa backend/frontend a Cloudflare Workers.

**Tutti i comandi in questo documento vanno eseguiti manualmente da te.** Nessuno script qui viene lanciato automaticamente. Cloud Run/Cloud SQL restano attivi e invariati finché non confermi che i dati su Neon sono corretti.

Fai prima l'ambiente **dev**, verifica, e solo dopo ripeti per **prod**.

---

## 0. Prerequisiti locali

```bash
# Cloud SQL Auth Proxy (per connetterti in sicurezza a Cloud SQL da locale)
brew install cloud-sql-proxy   # oppure scarica il binario da Google

# Client Postgres (pg_dump/pg_restore/psql) — versione >= 15
brew install libpq
brew link --force libpq
```

---

## 1. Crea il progetto Neon

Via [console Neon](https://console.neon.tech) o via `neonctl` (richiede `npm i -g neonctl` e `neonctl auth`):

```bash
neonctl projects create --name "s1-tool-projectmanagement" --region-id aws-eu-central-1
```

Prendi nota del `project-id` restituito, ti servirà nei comandi successivi.

### 1.1 Crea i due database/branch: dev e prod

Neon organizza i dati per **branch**, ognuno con i propri database. Approccio consigliato: un branch `dev` e un branch `production` separati (così puoi anche fare branch temporanei per test senza toccare prod).

```bash
PROJECT_ID="<il-project-id-restituito-sopra>"

# Branch dev (di solito Neon crea già un branch "main" all'atto della creazione progetto — puoi rinominarlo o crearne uno dedicato)
neonctl branches create --project-id "$PROJECT_ID" --name "s1-tpm-dev"
neonctl branches create --project-id "$PROJECT_ID" --name "s1-tpm-prod"

# Database dentro ciascun branch
neonctl databases create --project-id "$PROJECT_ID" --branch "s1-tpm-dev"  --name "s1-tpm-dev"
neonctl databases create --project-id "$PROJECT_ID" --branch "s1-tpm-prod" --name "s1-tpm-prod"
```

### 1.2 Crea il ruolo applicativo

```bash
neonctl roles create --project-id "$PROJECT_ID" --branch "s1-tpm-dev"  --name "s1-tpm"
neonctl roles create --project-id "$PROJECT_ID" --branch "s1-tpm-prod" --name "s1-tpm"
```

Neon genera la password automaticamente. Recuperala con:

```bash
neonctl connection-string --project-id "$PROJECT_ID" --branch "s1-tpm-dev"  --role-name "s1-tpm" --database-name "s1-tpm-dev"
neonctl connection-string --project-id "$PROJECT_ID" --branch "s1-tpm-prod" --role-name "s1-tpm" --database-name "s1-tpm-prod"
```

Il ruolo creato tramite Neon ha di default tutti i permessi necessari (owner) sul proprio database — non serve un `GRANT` manuale separato.

> **Pooled vs direct connection**: Neon espone due varianti di connection string — quella con `-pooler` nel host (via PgBouncer, per il traffico applicativo runtime) e quella diretta (per migrations/DDL/`pg_dump`/`pg_restore`, che non deve passare dal pooler in transaction mode). Salvale entrambe: la pooled diventerà `DATABASE_URL`, la diretta `DIRECT_URL` (vedi sezione 4).

---

## 2. Estrai le credenziali Cloud SQL attuali

Le credenziali di prod/dev sono in Secret Manager, non nel repo:

```bash
gcloud config set project soluzione1-progetti-interni

# Dev
gcloud secrets versions access latest --secret=database-url-dev
# Prod
gcloud secrets versions access latest --secret=database-url-prod
```

Il formato è `postgresql://UTENTE:PASSWORD@/NOME_DB?host=/cloudsql/soluzione1-progetti-interni:europe-west1:s1-progetti-interni` — utente, password e nome DB ti serviranno per il proxy.

---

## 3. Avvia il Cloud SQL Auth Proxy ed esegui il dump/restore

In un terminale separato, avvia il proxy verso l'istanza (resta in foreground):

```bash
cloud-sql-proxy soluzione1-progetti-interni:europe-west1:s1-progetti-interni --port 5433
```

In un altro terminale, esegui la migrazione con lo script incluso nel repo ([scripts/migrate-to-neon.sh](./scripts/migrate-to-neon.sh)), che fa `pg_dump` (formato custom) → `pg_restore` su Neon → conteggio righe di verifica:

```bash
# --- Ambiente DEV ---
SOURCE_DATABASE_URL="postgresql://UTENTE_DEV:PASSWORD_DEV@127.0.0.1:5433/NOME_DB_DEV" \
TARGET_DATABASE_URL="<connection string diretta Neon per s1-tpm-dev, da neonctl connection-string sopra>" \
./scripts/migrate-to-neon.sh
```

Verifica l'output di conteggio righe (sorgente vs target). Solo se combacia, ripeti per prod:

```bash
# --- Ambiente PROD (solo dopo aver verificato dev) ---
SOURCE_DATABASE_URL="postgresql://UTENTE_PROD:PASSWORD_PROD@127.0.0.1:5433/NOME_DB_PROD" \
TARGET_DATABASE_URL="<connection string diretta Neon per s1-tpm-prod>" \
./scripts/migrate-to-neon.sh
```

> Se l'istanza dev e prod condividono lo stesso host Cloud SQL ma database diversi, ti basta cambiare `NOME_DB` nella `SOURCE_DATABASE_URL` — il proxy resta lo stesso.

### 3.1 Se il dump fallisce per estensioni/permessi

Cloud SQL a volte include righe di `CREATE EXTENSION` per estensioni non disponibili su Neon (raro per schemi Prisma semplici come questo, che non usano estensioni custom). Se `pg_restore` si lamenta di un'estensione mancante, rilancia con `--no-owner --no-acl` (già presenti nello script) e, se necessario, filtra manualmente le righe `CREATE EXTENSION` dal dump prima del restore.

---

## 4. Verifica integrità dati post-migrazione

Oltre al conteggio automatico incluso nello script, esegui un confronto puntuale sulle tabelle chiave:

```bash
# Sostituisci CONN con la connection string appropriata (sorgente o target)
psql "$CONN" -c "
  SELECT 'project_managers' AS tabella, count(*) FROM project_managers
  UNION ALL SELECT 'accounts', count(*) FROM accounts
  UNION ALL SELECT 'clienti', count(*) FROM clienti
  UNION ALL SELECT 'progetti', count(*) FROM progetti
  UNION ALL SELECT 'attivita', count(*) FROM attivita
  UNION ALL SELECT 'gantt_milestones', count(*) FROM gantt_milestones
  UNION ALL SELECT 'stato_attivita_config', count(*) FROM stato_attivita_config
  UNION ALL SELECT 'stato_progetto_config', count(*) FROM stato_progetto_config;
"
```

> Nomi tabella verificati contro i `@@map(...)` in [backend/prisma/schema.prisma](./backend/prisma/schema.prisma). Se aggiungi/rimuovi modelli prima della migrazione, aggiorna questa query di conseguenza.

Controlla anche a campione qualche riga con date/valori numerici (es. `giornateVendute`, `giornateConsuntivate`, `inizio`, `deadline`) per assicurarti che tipi e timezone siano stati preservati correttamente.

Solo dopo che i conteggi e i controlli a campione corrispondono, procedi ad aggiornare `DATABASE_URL`/`DIRECT_URL` negli ambienti applicativi (non fatto automaticamente da questa fase — Cloud Run continua a puntare a Cloud SQL finché non lo decidi tu).

---

## 5. Dopo la conferma (fuori scope di questa fase, per riferimento futuro)

Una volta validati i dati su Neon:

1. Aggiorna i secrets `database-url-dev` / `database-url-prod` su GCP Secret Manager (o, se nel frattempo si è già passati a Cloudflare Workers, le variabili/binding equivalenti — es. `DATABASE_URL` + Hyperdrive binding).
2. Aggiorna `backend/.env` locale con la connection string Neon pooled.
3. Rimuovi `--add-cloudsql-instances` da `cloudbuild-backend.yaml` una volta che nessun ambiente usa più Cloud SQL.
4. Solo a migrazione confermata su tutti gli ambienti, valuta la dismissione dell'istanza Cloud SQL (operazione distruttiva, da fare per ultima e con backup).

Il codice applicativo (`backend/prisma/schema.prisma`, istanziazione `PrismaClient`) è già stato aggiornato in questa fase per usare `@prisma/adapter-pg`, compatibile sia con la connessione diretta a Neon sia con Cloudflare Hyperdrive in futuro — vedi commit collegato a questo documento.
