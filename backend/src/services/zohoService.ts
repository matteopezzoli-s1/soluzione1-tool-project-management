// ─── Integrazione Zoho Projects — import consuntivazioni ───────────────────
// I timelog dell'API Zoho non riportano la milestone di appartenenza, solo la
// tasklist: la milestone si ricava con il join log → task_list.id → tasklist
// → milestone.name. I codici ordine (GO-ORDV-YYYY-N) stanno nel nome della
// milestone, esattamente come nella colonna "milestone" dell'export CSV
// manuale (vedi parseTimesheet in ElencoAttivitaPage.tsx, stessa regex).
//
// I timelog si scaricano solo per finestre mensili (view_type=month): il
// totale storico di un progetto richiede l'iterazione dei mesi a partire
// dalla milestone GO più vecchia. Per questo il preview va orchestrato dal
// frontend un progetto per volta (rate limit Zoho ~100 richieste/2min e
// limiti di subrequest su Cloudflare Workers).

export interface ZohoConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  portalId: string
  accountsUrl: string // es. https://accounts.zoho.eu (datacenter EU)
  apiUrl: string      // es. https://projectsapi.zoho.eu
}

export const GO_CODE_RE = /GO-ORDV-\d{4}-\d+/

// Oltre questa finestra non scansioniamo: protegge da milestone con date
// d'inizio errate (es. anno sbagliato) che farebbero esplodere le chiamate.
const MAX_MONTHS = 36

// ── Access token (cache a livello di modulo, TTL 1h lato Zoho) ─────────────

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function getAccessToken(cfg: ZohoConfig): Promise<string> {
  const cached = tokenCache.get(cfg.refreshToken)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const res = await fetch(`${cfg.accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Zoho OAuth: HTTP ${res.status}`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!data.access_token) throw new Error(`Zoho OAuth: ${data.error ?? 'access_token mancante'}`)

  tokenCache.set(cfg.refreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  })
  return data.access_token
}

// ── Fetch helper ────────────────────────────────────────────────────────────

// Gli id Zoho superano Number.MAX_SAFE_INTEGER (es. 162275000004147321):
// JSON.parse li arrotonderebbe rompendo il join tasklist→log. Prima del parse
// convertiamo in stringa ogni intero da 16+ cifre (i timestamp *_long hanno
// 13 cifre e restano numerici).
function parseZohoJSON<T>(text: string): T {
  return JSON.parse(text.replace(/:\s*(\d{16,})(\s*[,}\]])/g, ':"$1"$2')) as T
}

async function zohoGet<T>(cfg: ZohoConfig, path: string): Promise<T | null> {
  const token = await getAccessToken(cfg)
  const res = await fetch(`${cfg.apiUrl}/restapi/portal/${cfg.portalId}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (res.status === 204) return null // nessun contenuto (es. progetto senza milestone/log)
  if (!res.ok) throw new Error(`Zoho API ${path}: HTTP ${res.status}`)
  const text = await res.text()
  if (!text.trim()) return null
  return parseZohoJSON<T>(text)
}

// ── Lista progetti ──────────────────────────────────────────────────────────

export interface ZohoProject {
  id: string
  name: string
}

export async function listZohoProjects(cfg: ZohoConfig): Promise<ZohoProject[]> {
  const out: ZohoProject[] = []
  const RANGE = 100
  for (let index = 1; ; index += RANGE) {
    const data = await zohoGet<{ projects?: Array<{ id_string: string; name: string }> }>(
      cfg,
      `/projects/?index=${index}&range=${RANGE}&status=active`,
    )
    const page = data?.projects ?? []
    out.push(...page.map((p) => ({ id: p.id_string, name: p.name })))
    if (page.length < RANGE) break
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

// ── Consuntivi di un progetto, aggregati per codice GO-ORDV ────────────────

export interface ZohoConsuntivoMese {
  mese: string // "YYYY-MM"
  ore: number  // ore del mese, arrotondate a 2 decimali
}

export interface ZohoConsuntivoCode {
  code: string // "GO-ORDV-2026-57"
  ore: number  // ore totali, arrotondate a 2 decimali
  mesi: ZohoConsuntivoMese[] // breakdown mensile (somma = ore)
}

export interface ZohoConsuntiviResult {
  codes: ZohoConsuntivoCode[]
  mesiScansionati: number
}

interface ZohoLogsResponse {
  timelogs?: {
    date?: Array<{
      tasklogs?: Array<{
        total_minutes?: number
        task_list?: { id?: string | number }
      }>
    }>
  }
}

export async function fetchConsuntiviProgetto(
  cfg: ZohoConfig,
  projectId: string,
): Promise<ZohoConsuntiviResult> {
  // 1. tasklist → nome milestone (una chiamata)
  const tl = await zohoGet<{
    tasklists?: Array<{ id_string: string; milestone?: { name?: string } }>
  }>(cfg, `/projects/${projectId}/tasklists/?index=1&range=200&flag=allflag`)

  const msNameByTasklist = new Map<string, string>()
  for (const t of tl?.tasklists ?? []) {
    if (t.milestone?.name) msNameByTasklist.set(String(t.id_string), t.milestone.name)
  }
  if (![...msNameByTasklist.values()].some((n) => GO_CODE_RE.test(n))) {
    return { codes: [], mesiScansionati: 0 } // nessuna milestone con codice: zero chiamate log
  }

  // 2. inizio scansione = start della milestone GO più vecchia, meno un mese
  //    di margine (log registrati prima dell'avvio formale della milestone)
  const ms = await zohoGet<{
    milestones?: Array<{ name?: string; start_date_long?: number }>
  }>(cfg, `/projects/${projectId}/milestones/?index=1&range=200`)

  let earliest = Date.now()
  for (const m of ms?.milestones ?? []) {
    if (m.name && GO_CODE_RE.test(m.name) && m.start_date_long && m.start_date_long < earliest) {
      earliest = m.start_date_long
    }
  }
  const now = new Date()
  let cursor = new Date(new Date(earliest).getFullYear(), new Date(earliest).getMonth() - 1, 1)
  const minStart = new Date(now.getFullYear(), now.getMonth() - (MAX_MONTHS - 1), 1)
  if (cursor < minStart) cursor = minStart

  // 3. scansione mensile dei log task e aggregazione minuti per codice+mese
  const minutesPerCodeMese = new Map<string, Map<string, number>>()
  let mesi = 0
  while (cursor <= now) {
    const mm = String(cursor.getMonth() + 1).padStart(2, '0')
    const meseKey = `${cursor.getFullYear()}-${mm}`
    const logs = await zohoGet<ZohoLogsResponse>(
      cfg,
      `/projects/${projectId}/logs/?users_list=all&view_type=month&date=${mm}-01-${cursor.getFullYear()}&bill_status=All&component_type=task`,
    )
    for (const day of logs?.timelogs?.date ?? []) {
      for (const log of day.tasklogs ?? []) {
        const msName = msNameByTasklist.get(String(log.task_list?.id ?? ''))
        const match = msName?.match(GO_CODE_RE)
        if (!match) continue
        let perMese = minutesPerCodeMese.get(match[0])
        if (!perMese) { perMese = new Map(); minutesPerCodeMese.set(match[0], perMese) }
        perMese.set(meseKey, (perMese.get(meseKey) ?? 0) + (log.total_minutes ?? 0))
      }
    }
    mesi++
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const codes = [...minutesPerCodeMese.entries()]
    .map(([code, perMese]) => {
      const mesiArr = [...perMese.entries()]
        .filter(([, minutes]) => minutes > 0)
        .map(([mese, minutes]) => ({ mese, ore: Math.round((minutes / 60) * 100) / 100 }))
        .sort((a, b) => a.mese.localeCompare(b.mese))
      const totalMinutes = [...perMese.values()].reduce((s, m) => s + m, 0)
      return { code, ore: Math.round((totalMinutes / 60) * 100) / 100, mesi: mesiArr }
    })
    .sort((a, b) => a.code.localeCompare(b.code))
  return { codes, mesiScansionati: mesi }
}
