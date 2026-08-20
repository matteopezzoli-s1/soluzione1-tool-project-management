// ─── Integrazione Zoho Projects — import consuntivazioni (API v3) ──────────
// I timelog dell'API non riportano la milestone di appartenenza: in v3 il log
// espone solo il task (`module_detail`), quindi la milestone si ricava con la
// catena log → task → tasklist → milestone. I codici ordine (GO-ORDV-YYYY-N)
// stanno nel nome della milestone (in v3 chiamata "phase"), esattamente come
// nella colonna "milestone" dell'export CSV manuale (vedi parseTimesheet in
// ElencoAttivitaPage.tsx, stessa regex).
//
// Rispetto alla v2 (EOL 31/12/2026) il costo in chiamate cala di ~3× grazie a
// tre cose: i timelog si scaricavano solo per finestre mensili (una chiamata
// per mese, anche per i mesi vuoti) mentre la v3 accetta finestre di 6 mesi
// paginate a 200 record; la mappa tasklist→milestone si prende una volta sola
// per tutto il portale (poche chiamate condivise, vedi getPortalMaps) invece
// che progetto per progetto; i task si filtrano server-side sulle sole
// tasklist con codice GO. Il preview resta orchestrato
// dal frontend un progetto per volta (limiti di subrequest su Cloudflare
// Workers e rate limit Zoho di 200 richieste/2min per endpoint).
//
// Nota: la v2 chiedeva i log senza `index`/`range` e veniva troncata a 100
// record per mese — i mesi con più di 100 timelog erano importati per difetto.
// La paginazione della v3 elimina il problema.

export interface ZohoConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  portalId: string
  accountsUrl: string // es. https://accounts.zoho.eu (datacenter EU)
  apiUrl: string      // es. https://projectsapi.zoho.eu
}

// Codici ordine GO nel nome milestone: GO-ORDV (ordine di vendita),
// GO-ORPR (ordine di produzione), ecc. — qualsiasi GO-OR<2 lettere>-YYYY-N.
export const GO_CODE_RE = /GO-OR[A-Z]{2}-\d{4}-\d+/

// Quanto indietro scansioniamo i timelog, sempre: le date delle phase non
// sono utilizzabili come inizio della finestra. In Zoho sono amministrative
// (spesso start = end = un solo giorno, fissato a ordine acquisito) e i log
// le precedono di mesi: partire dalla phase più vecchia del progetto tagliava
// fuori quasi tutto il consuntivato — es. GO-ORDV-2025-228 (Tigros), phase al
// 2025-12-19, 224h loggate da luglio a novembre 2025, di cui ne rientravano 7.
// Le ore si attribuiscono al codice via tasklist→milestone, mai per data:
// allargare la finestra può solo aggiungere log corretti, non log spuri.
const MAX_MONTHS = 36
// Massimo consentito dalla v3 su tutti gli endpoint di lista.
const PER_PAGE = 200
// La v3 rifiuta finestre `customdate` più lunghe di 6 mesi.
const WINDOW_MONTHS = 6
// Cintura di sicurezza contro loop di paginazione (200 × 60 = 12.000 record).
const MAX_PAGES = 60

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
  if (!res.ok) throw new ZohoApiError(`Zoho OAuth: HTTP ${res.status} — refresh token non valido o revocato`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!data.access_token) throw new ZohoApiError(`Zoho OAuth: ${data.error ?? 'access_token mancante'}`)

  tokenCache.set(cfg.refreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  })
  return data.access_token
}

// ── Fetch helper ────────────────────────────────────────────────────────────

// Gli id Zoho superano Number.MAX_SAFE_INTEGER (es. 162275000004147321) e in
// alcune risposte v3 arrivano come interi (non come stringhe): JSON.parse li
// arrotonderebbe rompendo il join task→tasklist. Prima del parse convertiamo
// in stringa ogni intero da 16+ cifre (i timestamp *_long hanno 13 cifre e
// restano numerici).
function parseZohoJSON<T>(text: string): T {
  return JSON.parse(text.replace(/:\s*(\d{16,})(\s*[,}\]])/g, ':"$1"$2')) as T
}

// Errore con un messaggio già scritto per chi usa l'app (scope mancante, rate
// limit, HTTP di Zoho). Le route lo propagano in chiaro invece del generico
// "errore nel recupero da Zoho": la causa è quasi sempre operativa (un secret
// da aggiornare), e nasconderla costa solo tempo di diagnosi.
export class ZohoApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZohoApiError'
  }
}

interface ZohoErrorBody {
  error?: { title?: string; status_code?: string; details?: Array<{ message?: string }> }
}

async function zohoGet<T>(cfg: ZohoConfig, path: string): Promise<T | null> {
  const token = await getAccessToken(cfg)
  const res = await fetch(`${cfg.apiUrl}/api/v3/portal/${cfg.portalId}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (res.status === 204) return null // nessun contenuto (es. progetto senza tasklist/log)
  if (!res.ok) {
    const body = await res.text()
    let title = ''
    try { title = parseZohoJSON<ZohoErrorBody>(body).error?.title ?? '' } catch { /* body non JSON */ }
    // Il refresh token porta con sé gli scope fissati alla generazione: senza
    // ZohoProjects.tasks.READ non è possibile risalire dal timelog alla
    // milestone, e l'import non può funzionare. Messaggio esplicito perché la
    // soluzione è operativa (rigenerare il token), non di codice.
    if (res.status === 401 && title === 'INVALID_OAUTHSCOPE') {
      throw new ZohoApiError(
        'Zoho: scope OAuth insufficiente. Il refresh token va rigenerato includendo ' +
        'ZohoProjects.tasks.READ (oltre a projects/tasklists/milestones/timesheets.READ).',
      )
    }
    if (res.status === 429) {
      const retry = res.headers.get('retry-after')
      throw new ZohoApiError(`Zoho: rate limit superato${retry ? `, riprovare fra ${retry}s` : ''}`)
    }
    throw new ZohoApiError(`Zoho API ${path.split('?')[0]}: HTTP ${res.status}${title ? ` ${title}` : ''}`)
  }
  const text = await res.text()
  if (!text.trim()) return null
  return parseZohoJSON<T>(text)
}

// `page_info` è a volte un oggetto e a volte un array di un elemento (dipende
// dall'endpoint), e `has_next_page` arriva come booleano o come stringa.
function hasNextPage(data: unknown): boolean {
  const raw = (data as { page_info?: unknown })?.page_info
  const info = (Array.isArray(raw) ? raw[0] : raw) as { has_next_page?: unknown } | undefined
  return info?.has_next_page === true || info?.has_next_page === 'true'
}

// Scorre tutte le pagine di un endpoint di lista, contando le chiamate.
async function fetchPaged<T>(
  cfg: ZohoConfig,
  makePath: (page: number) => string,
  extract: (data: unknown) => T[],
  stats: { chiamate: number },
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await zohoGet<unknown>(cfg, makePath(page))
    stats.chiamate++
    if (!data) break
    const rows = extract(data)
    out.push(...rows)
    if (rows.length === 0 || !hasNextPage(data)) break
  }
  return out
}

// ── Lista progetti ──────────────────────────────────────────────────────────

export interface ZohoProject {
  id: string
  name: string
}

interface ZohoProjectRow {
  id: string | number
  name: string
  status?: { is_closed_type?: boolean }
}

// In v3 GET /projects risponde con un array nudo (niente wrapper né
// page_info) e non accetta più `?status=active`: i progetti chiusi si
// filtrano sul flag `status.is_closed_type`.
export async function listZohoProjects(cfg: ZohoConfig): Promise<ZohoProject[]> {
  const out: ZohoProject[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await zohoGet<unknown>(cfg, `/projects?page=${page}&per_page=${PER_PAGE}`)
    const rows = (Array.isArray(data)
      ? data
      : ((data as { projects?: ZohoProjectRow[] })?.projects ?? [])) as ZohoProjectRow[]
    for (const p of rows) {
      if (p.status?.is_closed_type === true) continue
      out.push({ id: String(p.id), name: p.name })
    }
    if (rows.length < PER_PAGE) break
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

// ── Mappe di portale (condivise fra i progetti di uno stesso import) ───────
// Le tasklist si leggono per tutto il portale in poche chiamate (200
// record/pagina), invece di una chiamata per progetto. Siccome il frontend
// importa un progetto per richiesta, la mappa sta in cache a livello di
// modulo con un TTL breve: durante un import la paga solo il primo progetto,
// e se l'isolate Workers viene riciclato al massimo si rifanno quelle poche
// chiamate.

const PORTAL_MAPS_TTL_MS = 10 * 60 * 1000

interface PortalMaps {
  scadenza: number
  // progetto → (tasklist → nome della milestone, solo quelle con codice GO)
  goTasklists: Map<string, Map<string, string>>
}

const portalMapsCache = new Map<string, PortalMaps>()

interface ZohoAllTasklistRow {
  id: string | number
  milestone?: { name?: string }
  project?: { id?: string | number }
}

async function getPortalMaps(cfg: ZohoConfig, stats: { chiamate: number }): Promise<PortalMaps> {
  const cached = portalMapsCache.get(cfg.portalId)
  if (cached && cached.scadenza > Date.now()) return cached

  const tasklists = await fetchPaged<ZohoAllTasklistRow>(
    cfg,
    (page) => `/all-tasklists?page=${page}&per_page=${PER_PAGE}`,
    (d) => (d as { tasklists?: ZohoAllTasklistRow[] }).tasklists ?? [],
    stats,
  )
  const goTasklists = new Map<string, Map<string, string>>()
  for (const t of tasklists) {
    const nome = t.milestone?.name
    const progetto = t.project?.id
    if (!nome || progetto === undefined || !GO_CODE_RE.test(nome)) continue
    const perProgetto = goTasklists.get(String(progetto)) ?? new Map<string, string>()
    perProgetto.set(String(t.id), nome)
    goTasklists.set(String(progetto), perProgetto)
  }

  const maps: PortalMaps = { scadenza: Date.now() + PORTAL_MAPS_TTL_MS, goTasklists }
  portalMapsCache.set(cfg.portalId, maps)
  return maps
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
  chiamate: number // chiamate all'API Zoho spese per questo progetto
}

interface ZohoTaskRow {
  id: string | number
  tasklist?: { id?: string | number }
}

interface ZohoTimelogsResponse {
  time_logs?: Array<{
    log_details?: Array<{
      date?: string
      log_hour?: string // "HH:MM"
      module_detail?: { id?: string | number }
    }>
  }>
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// "02:30" → 150 minuti (in v3 le ore del log sono una stringa "HH:MM", non
// più i `total_minutes` interi della v2). I minuti mancanti valgono 0, così
// un eventuale "2" non viene scartato in silenzio.
function minutiDaLogHour(v: string | undefined): number {
  const [h, m] = String(v ?? '').split(':')
  const hh = Number(h)
  const mm = m === undefined || m === '' ? 0 : Number(m)
  if (!isFinite(hh) || !isFinite(mm)) return 0
  return hh * 60 + mm
}

// Finestre di al massimo WINDOW_MONTHS mesi da `from` a oggi (la v3 rifiuta
// intervalli `customdate` più lunghi).
function finestre(from: Date, to: Date): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  while (cursor <= to) {
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + WINDOW_MONTHS, 0)
    out.push([ymd(cursor), ymd(end < to ? end : to)])
    cursor.setMonth(cursor.getMonth() + WINDOW_MONTHS)
  }
  return out
}

export async function fetchConsuntiviProgetto(
  cfg: ZohoConfig,
  projectId: string,
): Promise<ZohoConsuntiviResult> {
  const stats = { chiamate: 0 }

  // 1. mappe di portale (condivise, in cache): tasklist con codice GO del
  //    progetto. Un progetto senza codici GO non costa più nessuna chiamata
  //    dedicata.
  const maps = await getPortalMaps(cfg, stats)
  const msNameByTasklist = maps.goTasklists.get(projectId)
  if (!msNameByTasklist || msNameByTasklist.size === 0) return { codes: [], chiamate: stats.chiamate }

  // 2. inizio scansione = MAX_MONTHS mesi fa, sempre (vedi MAX_MONTHS: le
  //    date delle phase non delimitano il periodo in cui si è lavorato)
  const now = new Date()
  const cursor = new Date(now.getFullYear(), now.getMonth() - (MAX_MONTHS - 1), 1)

  // 3. task → tasklist: in v3 il timelog espone solo il task, quindi serve la
  //    mappa dei task per chiudere la catena verso la milestone. Servono solo
  //    i task delle tasklist con codice GO, che si filtrano server-side
  //    (`tasklist_id`, a gruppi di 20 id): su un progetto grande sono 40 task
  //    invece di 800. Se Zoho rifiuta il filtro si ripiega su tutti i task.
  const tasklistIds = [...msNameByTasklist.keys()]
  const tasks: ZohoTaskRow[] = []
  try {
    for (let i = 0; i < tasklistIds.length; i += 20) {
      const value = JSON.stringify(tasklistIds.slice(i, i + 20))
      const filtro = encodeURIComponent(
        `{"criteria":[{"field_name":"tasklist_id","criteria_condition":"is","value":${value}}],"pattern":"1"}`,
      )
      tasks.push(...await fetchPaged<ZohoTaskRow>(
        cfg,
        (page) => `/projects/${projectId}/tasks?page=${page}&per_page=${PER_PAGE}&filter=${filtro}`,
        (d) => (d as { tasks?: ZohoTaskRow[] }).tasks ?? [],
        stats,
      ))
    }
  } catch {
    tasks.length = 0
    tasks.push(...await fetchPaged<ZohoTaskRow>(
      cfg,
      (page) => `/projects/${projectId}/tasks?page=${page}&per_page=${PER_PAGE}`,
      (d) => (d as { tasks?: ZohoTaskRow[] }).tasks ?? [],
      stats,
    ))
  }
  const tasklistByTask = new Map<string, string>()
  for (const t of tasks) {
    if (t.tasklist?.id !== undefined) tasklistByTask.set(String(t.id), String(t.tasklist.id))
  }

  // 4. timelog a finestre di 6 mesi (paginati) e aggregazione per codice+mese.
  //    `module` è obbligatorio anche in lettura: senza, la v3 risponde 400.
  const MODULE = encodeURIComponent(JSON.stringify({ type: 'task' }))
  const minutesPerCodeMese = new Map<string, Map<string, number>>()
  for (const [start, end] of finestre(cursor, now)) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await zohoGet<ZohoTimelogsResponse>(
        cfg,
        `/projects/${projectId}/timelogs?view_type=customdate&start_date=${start}&end_date=${end}` +
          `&page=${page}&per_page=${PER_PAGE}&module=${MODULE}`,
      )
      stats.chiamate++
      if (!data) break
      let righe = 0
      for (const giorno of data.time_logs ?? []) {
        for (const log of giorno.log_details ?? []) {
          righe++
          const tasklistId = tasklistByTask.get(String(log.module_detail?.id ?? ''))
          const msName = tasklistId ? msNameByTasklist.get(tasklistId) : undefined
          const match = msName?.match(GO_CODE_RE)
          if (!match || !log.date) continue
          const meseKey = log.date.slice(0, 7) // "YYYY-MM-DD" → "YYYY-MM"
          let perMese = minutesPerCodeMese.get(match[0])
          if (!perMese) { perMese = new Map(); minutesPerCodeMese.set(match[0], perMese) }
          perMese.set(meseKey, (perMese.get(meseKey) ?? 0) + minutiDaLogHour(log.log_hour))
        }
      }
      if (righe === 0 || !hasNextPage(data)) break
    }
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
  return { codes, chiamate: stats.chiamate }
}
