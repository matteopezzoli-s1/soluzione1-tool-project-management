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
