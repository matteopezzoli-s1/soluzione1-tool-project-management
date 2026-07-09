# Rename Checklist — S1 Gantt → Tool Project Management (TPM)

Elenco di ogni occorrenza testuale del vecchio naming trovata nel repo. **Nessun file è stato modificato** — questo documento serve solo a censire il lavoro prima di eseguirlo.

Ricerca eseguita su tutto il repo escludendo `node_modules`, `.git`, `dist`, `build`, `generated/` e `.claude/worktrees/*` (worktree effimeri di altre sessioni agent, non fanno parte del contenuto versionato da rinominare).

> ⚠️ **Nota importante — cosa NON rinominare**: la parola "Gantt" compare anche come nome di una **feature** del prodotto (il diagramma Gantt/timeline), non solo come brand. Occorrenze come `GanttPage.tsx`, `GanttPage.css`, la voce di menu "Gantt Attività", le route `/api/gantt/milestones`, la classe CSS `gp-` sono **corrette e vanno mantenute**: il tool continuerà ad avere una vista Gantt anche dopo il rebrand. Questo checklist elenca solo le occorrenze che si riferiscono al **nome del prodotto/repo**, non alla feature.

---

## A. Nome prodotto — forma leggibile "S1 Gantt" / "s1 Gantt"

| File | Riga | Contesto |
|---|---|---|
| `DEV_SETUP.md` | 1 | `# Dev Environment — s1 Gantt (Locale)` |
| `frontend/src/App.css` | 2 | commento `s1 Gantt — Dashboard Shell` |
| `frontend/src/pages/LoginPage.tsx` | 324 | `aria-label="Accesso a s1 Gantt"` |
| `frontend/src/pages/LoginPage.tsx` | 332 | `<h1 className="lp-brand-name">s1 Gantt</h1>` (brand visibile in UI) |
| `frontend/src/pages/LoginPage.css` | 2 | commento `s1 Gantt — Login Page` |
| `CLAUDE.md` | 7 | `**s1-gantt** — Internal project management tool...` |

## B. Nome prodotto — forma kebab-case "s1-gantt" (infra/log/config)

| File | Riga | Contesto |
|---|---|---|
| `README.md` | 1 | `# s1-gantt` (titolo) |
| `README.md` | 18 | albero directory ASCII: `soluzione1-gantt-progetti/` |
| `DEV_SETUP.md` | 22 | `docker ps` → `s1-gantt-db` |
| `DEV_SETUP.md` | 31–32 | log atteso `[s1-gantt] Backend → ...`, `[s1-gantt] Callback → ...` |
| `DEV_SETUP.md` | 47 | esempio `DATABASE_URL=".../s1-gantt-dev"` |
| `DEV_SETUP.md` | 69 | checklist `docker ps → s1-gantt-db Up` |
| `docker-compose.yml` | 6 | `container_name: s1-gantt-db` |
| `docker-compose.yml` | 10 | `POSTGRES_DB: s1-gantt-dev` |
| `cloudbuild-backend.yaml` | 6–7 | commenti: `database: s1-gantt-dev` / `s1-gantt-prod` |
| `backend/src/index.ts` | 1143 | `console.log(\`[s1-gantt] Backend → ...\`)` |
| `backend/src/index.ts` | 1144 | `console.log(\`[s1-gantt] Callback → ...\`)` |
| `backend/src/index.ts` | 1146 | `console.warn('[s1-gantt] ⚠️ GOOGLE_CLIENT_ID non impostato...')` |
| `backend/.env.example` | 22 | esempio commentato `.../s1gantt` |
| `CLAUDE.md` | 39 | `docker compose up -d # ... (container: s1-gantt-db)` |

## C. Nome repository "soluzione1-gantt-progetti"

| Posizione | Dettaglio |
|---|---|
| `.git/config` → `[remote "origin"]` | `url = git@github.com:matteopezzoli-s1/soluzione1-gantt-progetti.git` |
| `package-lock.json` (root) | `"name": "soluzione1-gantt-progetti"` |
| `README.md:18` | albero directory mostra `soluzione1-gantt-progetti/` |
| `.claude/settings.local.json` (righe 24, 25, 29) | path assoluti locali `/Users/matteopezzoli/Documents/soluzione1-gantt-progetti/...` in allow-list dei permessi Bash |
| Cartella locale sul filesystem | `/Users/matteopezzoli/Documents/soluzione1-gantt-progetti` — non è contenuto versionato, va rinominata a mano fuori da git (`mv`), vedi sezione E |

## D. Titolo UI già disallineato

| File | Riga | Nota |
|---|---|---|
| `frontend/index.html` | 7 | `<title>s1 Progetti — Project Management</title>` — **non contiene nemmeno "Gantt"**, è già un terzo naming diverso da README/LoginPage. Va allineato al nuovo brand insieme al resto. |

## E. Cosa NON serve rinominare (verificato, fuori scope)

- **GitHub Actions**: nessun workflow presente (`.github/workflows` non esiste). La CI/CD è Google Cloud Build (`cloudbuild-backend.yaml`, `cloudbuild-frontend.yaml`) — non richiede un "nome workflow" da rinominare, solo i commenti interni (vedi sezione B).
- **Variabili d'ambiente (nomi)**: nessuna delle variabili (`DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `FRONTEND_URL`, `BACKEND_URL`, `PORT`, `VITE_API_URL`) contiene il vecchio brand nel nome — solo alcuni *valori di esempio* lo contengono (già coperti in sezione B).
- **Risorse GCP esistenti**: il progetto GCP `soluzione1-progetti-interni`, l'istanza Cloud SQL `s1-progetti-interni` e i bucket GCS `s1-progetti-interni-{dev,prod}` (`cloudbuild-backend.yaml:9,16,59,67`) usano già uno schema di naming indipendente ("progetti-interni"), non contengono "gantt" e **non vengono toccati da questo rebrand** — rinominare risorse GCP reali è un'operazione infrastrutturale separata, fuori dallo scope "nessuna modifica funzionale" di questa fase.
- **`frontend/src/App.tsx`** (righe 128, 192: `'Gantt Attività'`), **`GanttPage.tsx`/`.css`**, route `/api/gantt/milestones`, prefisso CSS `gp-`: riferimenti legittimi alla feature Gantt, restano invariati (vedi nota in cima al documento).

---

## Naming proposto (Fase 1, punto 2)

| Ambito | Attuale | Proposto |
|---|---|---|
| Nome prodotto (leggibile, IT) | "s1 Gantt" / "S1 Gantt" | **Tool Project Management** (forma breve: **TPM**) |
| `<title>` browser / meta | "s1 Progetti — Project Management" | "TPM — Tool Project Management" |
| Brand in LoginPage (`h1.lp-brand-name`) | "s1 Gantt" | "TPM" (con eventuale sottotitolo "Tool Project Management" se serve contesto) |
| `aria-label` login | "Accesso a s1 Gantt" | "Accesso a Tool Project Management" |
| Nome pacchetto npm root (`package-lock.json`) | `soluzione1-gantt-progetti` | `soluzione1-tool-project-management` (allineato al nome repo GitHub già rinominato) |
| Nome pacchetti `backend/package.json`, `frontend/package.json` | `backend`, `frontend` | invariati — sono già generici, non contengono il vecchio brand; rinominarli (es. `tpm-backend`/`tpm-frontend`) è opzionale e a basso valore, da evitare per minimizzare il diff |
| Container Docker / DB locale | `s1-gantt-db`, `s1-gantt-dev` | `s1-tpm-db`, `s1-tpm-dev` |
| Prefisso log backend | `[s1-gantt]` | `[tpm]` |
| Esempio DB in `.env.example` | `s1gantt` | `s1tpm` |
| Repo GitHub | `soluzione1-gantt-progetti` (già rinominato lato GitHub in `soluzione1-tool-project-management`) | allineare `.git/config` remote e riferimenti locali (vedi sotto) |
| Workflow GitHub Actions | nessuno esistente | nessuna azione richiesta |

## Verifica riferimenti diretti all'URL del vecchio repo (Fase 1, punto 3)

Trovato **un solo punto** che referenzia direttamente l'URL del vecchio nome repo:

- `.git/config`, sezione `[remote "origin"]`:
  ```
  url = git@github.com:matteopezzoli-s1/soluzione1-gantt-progetti.git
  ```
  GitHub reindirizza automaticamente da `soluzione1-gantt-progetti` a `soluzione1-tool-project-management`, quindi git continuerà a funzionare senza intervento. Per allineare comunque il config locale (buona pratica, evita un hop di redirect ad ogni fetch/push), il comando da eseguire manualmente è:
  ```bash
  git remote set-url origin git@github.com:matteopezzoli-s1/soluzione1-tool-project-management.git
  ```
  **Non eseguito automaticamente** in questa fase — è un comando che modifica la configurazione git, da lanciare quando deciderai di procedere con il rename effettivo.

- Nessuno script di CI (`cloudbuild-*.yaml`) referenzia l'URL del repository GitHub — Cloud Build viene invocato dal trigger configurato lato GCP Console (che referenzia il repo per nome), non da un URL hardcoded nei file YAML stessi. Il nome del trigger e il collegamento al repo GitHub in GCP Console andranno verificati/aggiornati separatamente (fuori dal controllo versione, non risolvibile da qui).

- `.claude/settings.local.json` (righe 24, 25, 29) contiene path assoluti locali con il vecchio nome cartella, usati come allow-list per comandi Bash. Se in futuro rinomini la cartella locale (`/Users/matteopezzoli/Documents/soluzione1-gantt-progetti` → `.../soluzione1-tool-project-management`), questi permessi salvati smetteranno di matchare e andranno rigenerati — non bloccante, solo da tenere a mente.

---

## Prossimi passi (non eseguiti in questa fase)

1. Conferma il naming proposto sopra (o correggilo).
2. Solo dopo conferma esplicita, si passa all'esecuzione effettiva dei rename elencati in questo file (sezioni A, B, C, D).
