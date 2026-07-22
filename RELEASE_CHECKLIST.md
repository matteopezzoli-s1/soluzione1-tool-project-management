# Checklist di rilascio — develop → main (big-bang 2026-07)

Rilascio cumulativo di tutto il lavoro su `develop` mai andato in produzione:
Contratti Assistenza · Consuntivi Zoho (import + storico) · Presale con mail SAIOT ·
PM singolo per attività · Google Drive picker · match ordini `GO-OR??-YYYY-N` ·
**Prodotti interni** (handoff roadmap → attività) · rinomine pagine/nav.

Il deploy parte SOLO al push su `main` (`.github/workflows/deploy-prod.yml`):
`prisma migrate deploy` su Neon (connessione diretta) → deploy Worker → build+deploy frontend.
Le migration girano PRIMA del nuovo Worker: per qualche minuto il codice vecchio gira
sullo schema nuovo — è previsto, le migration sono additive/compatibili.

> Query da eseguire nel **SQL Editor della console Neon** (progetto di produzione),
> oppure via `psql` con la NEON_PROD_DIRECT_URL.

---

## 0 · Pre-deploy — verifiche sul DB di produzione (STOP se qualcosa non torna)

**0.1 Backup istantaneo.** Su Neon crea un branch del database (Branches → New branch
da `main`, es. `pre-release-2026-07`). È il vero paracadute: ripristino immediato.

**0.2 Quali migration mancano in prod** (per sapere cosa girerà):

```sql
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY finished_at DESC
LIMIT 15;
```

Confronta con `backend/prisma/migrations/`: tutto ciò che in prod non compare verrà
applicato in sequenza (attese: da `zoho_import_sessions` o successive fino a
`prodotti_interni_roadmap_to_attivita`, a seconda dell'ultimo deploy).

**0.3 Chiavi degli stati roadmap** — la migration `prodotti_interni` e il nuovo codice
assumono le chiavi `BACKLOG / ANALISI / DA_INIZIARE / IN_CORSO / COMPLETATO`
(+ eventuale `BLOCCATO`/`STANDBY` che verrà dismesso):

```sql
SELECT chiave, label, ordine, is_archiviato
FROM stato_roadmap_config
ORDER BY ordine;
```

- ✅ Chiavi come sopra → ok.
- ⛔ Chiavi diverse (es. manca `COMPLETATO` o "in corso" ha un'altra chiave) →
  **STOP**: adeguare la migration `20260722000000` e le costanti
  (`RETIRED_ROADMAP_STATO` in `backend/src/app.ts`, `RETIRED_STATO` in
  `frontend/src/pages/RoadmapPage.tsx`) prima di rilasciare.

**0.4 Item nei vari stati roadmap** (fotografia; quelli in BLOCCATO/STANDBY
finiranno in BACKLOG):

```sql
SELECT stato, COUNT(*) FROM roadmap_items GROUP BY stato ORDER BY 2 DESC;
```

**0.5 PM multipli per attività** — la migration `attivita_pm_singolo` fa backfill
con `LIMIT 1` e poi **droppa** la join `attivita_pms`: se un'attività avesse più
PM, gli extra andrebbero persi. Attesa: 0 righe.

```sql
SELECT attivita_id, COUNT(*) AS pm
FROM attivita_pms
GROUP BY attivita_id
HAVING COUNT(*) > 1;
```

- ⛔ Se esce qualche riga: decidere a mano quale PM tenere PRIMA del deploy
  (aggiornare la join lasciando una sola riga per attività).
- ℹ️ Se la query fallisce con "relation does not exist", la migration è già
  passata in un deploy precedente: ok, saltare.

**0.6 Secrets GitHub** (Settings → Secrets → Actions): `NEON_PROD_DIRECT_URL`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; opzionali `GOOGLE_CLIENT_ID` +
`VITE_GOOGLE_API_KEY` (senza: i bottoni Drive non compaiono, degradazione pulita).
Secrets Worker (Zoho, JWT, Google OAuth): `cd backend && npx wrangler secret list --env production`.

**0.7 Fotografa i KPI.** Screenshot del riepilogo dell'elenco attività e della
dashboard in prod: dopo il deploy i numeri devono essere **identici**
(i Prodotti interni non esistono ancora, l'esclusione dai KPI non cambia nulla).

---

## 1 · Rilascio

1. Merge `feat/prodotti-interni-roadmap-to-attivita` → `develop`; attendere CI verde.
2. Ultimo giro di test in locale su `develop`.
3. Momento presidiato (mattina, non venerdì sera): merge `develop` → `main`, push.
4. Seguire GitHub Actions: job `deploy-backend` (guardare lo step "Applica le
   migration": deve elencare le migration attese dallo 0.2) poi `deploy-frontend`.

---

## 2 · Post-deploy — smoke test (10 minuti)

**DB (Neon):**

```sql
-- Le nuove migration risultano applicate
SELECT migration_name, finished_at FROM _prisma_migrations
ORDER BY finished_at DESC LIMIT 8;

-- COMPLETATO flaggato, STANDBY sparito
SELECT chiave, is_completato FROM stato_roadmap_config ORDER BY ordine;

-- Nessun item rimasto in stati dismessi
SELECT stato, COUNT(*) FROM roadmap_items GROUP BY stato;

-- Colonne nuove al loro posto (attese: 0 righe collegate)
SELECT COUNT(*) FROM attivita WHERE roadmap_item_id IS NOT NULL;
```

**App (https://tpm-frontend.pages.dev):**

- [ ] Login Google ok; sidebar: Dashboard → Presale → **Roadmap Prodotti** →
      **Attività Progetti / Prodotti** → Contratti Assistenza → …
- [ ] KPI elenco + dashboard **identici** allo screenshot pre-deploy (0.7)
- [ ] Elenco: modifica e salva un'attività esistente qualsiasi (PUT ok)
- [ ] Roadmap: vista default "Kanban per stati"; colonna Completato nascosta con
      toggle "Mostra completati (n)"; item legacy in In corso con
      "Converti in attività"; drag con salto rifiutato col messaggio-guida
- [ ] Roadmap: prendi in carico UN item di prova reale → appare in
      "Prodotti interni" nell'elenco, la card resta in In corso col badge stato
- [ ] Contratti Assistenza: la pagina carica, banner scadenze ok
- [ ] Consuntivi Zoho: la pagina carica (se 503 → secrets `ZOHO_*` mancanti sul Worker)
- [ ] Impostazioni → stati roadmap/attività/contratti visibili e corretti
- [ ] ⚠️ Presale: NON usare "Salva e invia mail" per testare — manda mail vere
      via SAIOT (visibilità comunque limitata dall'allowlist)

---

## 3 · Comunicazione al team (cambi di comportamento)

- La pagina "Elenco Attività Progetti" ora è **"Attività Progetti / Prodotti"**;
  il pulsante crea è "Aggiungi attività progetto" (i prodotti NON si creano da lì)
- **I prodotti entrano nell'elenco solo dalla roadmap** ("Prendi in carico" da
  "Da prendere in carico"; economia compilata nella scheda dell'item)
- Drag sulla roadmap: **solo tra stati adiacenti**; niente più drag verso
  In corso (si usa Prendi in carico) né verso Completato (automatico alla
  chiusura dell'attività)
- Lo stato **Standby è stato dismesso** (gli item parcheggiati sono in Backlog)
- I completati sono **nascosti di default** (toggle per mostrarli)
- Ogni PM vede **un solo PM per attività** (era già così nei dati)

---

## 4 · Rollback

- **Codice**: `git revert` del merge su `main` (o redeploy del commit precedente
  via Actions) — lo schema nuovo è additivo, il codice vecchio ci gira sopra
  senza problemi. Nessun rollback DB necessario in questo scenario.
- **Stato STANDBY** (solo se servisse ripristinarlo):
  ```sql
  INSERT INTO stato_roadmap_config (id, chiave, label, colore, ordine, created_at, updated_at)
  VALUES ('standby-restore', 'STANDBY', 'Standby', '#16A34A', 5, now(), now());
  ```
  (gli item spostati in BACKLOG restano lì: erano parcheggiati, vanno solo ri-trascinati)
- **Disastro**: ripristino dal branch Neon `pre-release-2026-07` (0.1) +
  redeploy del codice vecchio. Da usare solo se le migration hanno prodotto
  dati inconsistenti (non atteso: sono additive/idempotenti).

---
---

# Checklist di rilascio — Integrazione Google Drive (clienti/progetti/presale/roadmap)

Feature branch `feat/drive-integration-clienti-progetti`, mergiata in `develop`.
Binding delle cartelle Drive per ID (mai per nome), cartelle create dal software,
picker presale/roadmap ancorato alla cartella "Analisi dei Requisiti" del progetto.
Il grosso è automatico; **l'unico passo manuale è il seed di collegamento** (§3).

## 0 · Pre-deploy

- **0.1 Env di build frontend** (GitHub Secrets, per il Picker Drive):
  `VITE_GOOGLE_CLIENT_ID` (stesso OAuth client del login) e `VITE_GOOGLE_API_KEY`
  (API key con Picker API abilitata). Senza, i bottoni/picker Drive non
  compaiono e tutto degrada a input manuale (nessun crash).
- **0.2 Config Drive già presente in prod**: verifica che `gdrive_dev_id` sia
  valorizzato (Impostazioni → Google Drive). Le ancore "Progetti in gestione" e
  "Prodotti" si ricavano da sole per nome dentro il Drive Sviluppo.
  ```sql
  SELECT chiave, valore FROM app_config WHERE chiave LIKE 'gdrive_%';
  ```
- **0.3 Backup Neon**: branch del DB di produzione (paracadute).
- **0.4 Permessi Drive**: chi crea cartelle da TPM agisce col proprio account
  Google (client-side) → deve avere ruolo **Contributor** sullo shared drive
  "Reparto Sviluppo". Senza permesso la cartella non viene creata (avviso in UI,
  collegabile a mano) — non bloccante.

## 1 · Deploy

- Merge `develop` → `main`, push. Parte GitHub Actions.
- La migration **`20260722150000_drive_folders_clienti_progetti`** viene applicata
  da `prisma migrate deploy`. È **additiva** (solo colonne nullable su `clienti` e
  `progetti`): nessun rischio sui dati.

## 2 · Post-deploy — verifica migration

```sql
-- Colonne nuove presenti (attese: clienti.drive_folder_id/url,
-- progetti.drive_folder_id/url/drive_analisi_folder_id)
SELECT table_name, column_name FROM information_schema.columns
WHERE column_name LIKE 'drive_%folder%' ORDER BY 1,2;
```

## 3 · Seed di collegamento — passo MANUALE (una volta)

Da eseguire **dopo** la migration (altrimenti le colonne non esistono). SQL Editor
Neon o `psql`:

```bash
psql "$NEON_PROD_DIRECT_URL" -f backend/prisma/seed-drive-mapping.sql
```

- Popola le ancore in `AppConfig` e collega le cartelle a 26 clienti + 51
  progetti/prodotti (Servicepay/ASDPay/Edupay puntano alla stessa cartella).
- **Idempotente** (match per nome canonico dei clienti/progetti): ri-eseguibile.
- I 2 "Pacchetto giornate" restano senza cartella (amministrativi, voluto).
- ⚠️ Presuppone i nomi cliente **già bonificati** in prod (Alltub, Sacbo, Tobabo
  Salestrainer, ReMade, Milano Serravalle, Autoservizi Locatelli, San Carlo,
  Conai, Digi): bonifica già applicata il 2026-07-22.

## 4 · Verifica funzionale

- [ ] Clienti/Progetti: colonna Drive mostra 📁 sui collegati; modal con sezione
      "Cartella Drive" (collega/crea/scollega)
- [ ] Crea un progetto di prova su un cliente con cartella: l'alberatura nasce da
      sola sotto la cartella cliente; elimina poi il progetto di prova
- [ ] Presale (attività con progetto collegato): il picker "analisi requisiti"
      apre la cartella "Analisi dei Requisiti" del progetto; file **e** cartelle
      selezionabili + scheda "Carica" (anche più file → salva la cartella)
- [ ] Impostazioni → Google Drive: solo i 3 drive (Sviluppo/Commerciale/Contratti)
      + nota sulle cartelle auto-individuate; "Alberatura progetti" (editor, Board)

## 5 · Igiene

- 🔑 **Reset password ruolo Neon** se la connection string è stata condivisa
  durante la bonifica dati.

## 6 · Note

- Clienti/progetti creati **dopo** il rilascio generano le cartelle da soli: il
  seed serve solo per allineare lo **storico**.
- Nessun servizio server-side: tutte le operazioni Drive sono client-side col
  token dell'utente. Nessun rollback DB necessario (colonne additive; il codice
  vecchio gira sullo schema nuovo).
