import { Hono, type MiddlewareHandler } from 'hono'
import type { PrismaClient, UserRole, TipoContratto } from '@prisma/client'
import {
  buildGoogleAuthURL,
  fetchGoogleProfile,
  signJWT,
  verifyJWT,
  type JWTPayload,
} from './auth'
import { importCSV } from './services/importService'
import {
  GO_CODE_RE,
  fetchConsuntiviProgetto,
  listZohoProjects,
  type ZohoConfig,
} from './services/zohoService'
import {
  getPresaleEmailConfig,
  savePresaleEmailConfig,
  sendPresaleFaseEmail,
  STATO_TO_FASE,
  type PresaleEmailConfig,
  type PresaleFaseCode,
} from './presaleEmail'

// Codici fase mail validi (i 4 stati board + la conferma finale).
const PRESALE_FASI_VALIDE: PresaleFaseCode[] = [
  'ANALISI_INIZIALE', 'PRESA_IN_CARICO', 'STIMA', 'TRATTATIVA_CLIENTE', 'PROGETTO_CONFERMATO',
]

export interface AppConfig {
  googleClientId: string
  googleClientSecret: string
  jwtSecret: string
  frontendUrl: string
  callbackUrl: string
  isProd: boolean
  // null = variabili ZOHO_* non impostate: le route /api/zoho/* rispondono 503
  zoho: ZohoConfig | null
}

export interface Vars {
  prisma: PrismaClient
  config: AppConfig
  currentUserId: string | null
  currentUserRoles: UserRole[] | null
}

export type Env = { Variables: Vars }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/
const MESE_RE  = /^\d{4}-(0[1-9]|1[0-2])$/ // chiave mese "YYYY-MM" (consuntivi mensili)
// Link http(s) per i campi documento (analisi roadmap, link presale): i valori
// storici non conformi restano leggibili, ma al salvataggio si accettano solo URL.
const HTTP_URL_RE = /^https?:\/\/\S+$/i

// Valida i campi link di un payload: ritorna il messaggio d'errore della prima
// violazione, null se tutto ok. Campi vuoti/assenti sono sempre validi.
function invalidLinkError(links: Record<string, string | null | undefined>): string | null {
  for (const [label, value] of Object.entries(links)) {
    const v = value?.trim()
    if (v && !HTTP_URL_RE.test(v)) {
      return `${label}: non è un link valido (deve iniziare con http:// o https://)`
    }
  }
  return null
}

function toNumber(d: unknown): number {
  if (d === null || d === undefined) return 0
  return typeof d === 'object' && 'toNumber' in (d as object)
    ? (d as { toNumber(): number }).toNumber()
    : Number(d)
}

async function readJSON<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T
}

// Registra un passaggio di stato di un'attività (alimenta la timeline Presale).
// statoDa null = riga di creazione. Non deve mai far fallire l'operazione
// principale: eventuali errori di scrittura del log vengono solo loggati.
async function logStatoChange(
  prisma: PrismaClient,
  attivitaId: string,
  statoDa: string | null,
  statoA: string,
  userId: string | null,
): Promise<void> {
  try {
    await prisma.attivitaStatoLog.create({ data: { attivitaId, statoDa, statoA, userId } })
  } catch (err) {
    console.error('[attivita] logStatoChange error:', err)
  }
}

// La config SAIOT (codici, endpoint, interruttore invii) è leggibile/scrivibile
// solo da questo allowlist — coerente con la Presale, per ora ristretta.
const PRESALE_EMAIL_ADMINS = ['matteo.pezzoli@soluzione1.it']
async function isPresaleEmailAdmin(prisma: PrismaClient, userId: string | null): Promise<boolean> {
  if (!userId) return false
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  return !!u?.email && PRESALE_EMAIL_ADMINS.includes(u.email.toLowerCase())
}

// La mail di una fase parte solo quando il campo "chiave" di quella fase è
// valorizzato: evita notifiche a metà se qualcosa aggira la validazione lato UI.
function presaleFaseDataReady(
  fase: string,
  a: { presaleAssegnatarioId: string | null; presaleGiornateStimate: unknown; giornateVendute: unknown },
): boolean {
  switch (fase) {
    case 'ANALISI_INIZIALE': return true
    case 'PRESA_IN_CARICO': return !!a.presaleAssegnatarioId
    case 'STIMA': return a.presaleGiornateStimate != null
    case 'TRATTATIVA_CLIENTE': return a.giornateVendute != null
    default: return true
  }
}

// Un utente ha accesso solo se censito, non disabilitato (deletedAt) e con
// almeno un ruolo assegnato: senza ruoli non c'è nulla che possa fare in app,
// quindi lo trattiamo come non autorizzato allo stesso modo di un non censito.
function isActiveUser(user: { deletedAt: Date | null; roles: string[] } | null): boolean {
  return !!user && !user.deletedAt && user.roles.length > 0
}

function requireAuth(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Token mancante' }, 401)
    }
    let payload: JWTPayload
    try {
      payload = verifyJWT(header.slice(7), c.get('config').jwtSecret)
    } catch {
      return c.json({ error: 'Token non valido o scaduto' }, 401)
    }
    // Un JWT valido non basta: l'email deve corrispondere a un utente censito,
    // non disabilitato e con almeno un ruolo, altrimenti niente accesso alle API.
    if (!payload.userId) {
      return c.json({ error: 'Utente non autorizzato' }, 403)
    }
    const user = await c.get('prisma').user.findUnique({ where: { id: payload.userId } })
    if (!isActiveUser(user)) {
      return c.json({ error: 'Utente non autorizzato' }, 403)
    }
    c.set('currentUserId', payload.userId)
    c.set('currentUserRoles', user!.roles)
    await next()
  }
}

// Primo enforcement server-side dei ruoli: finora i ruoli erano solo
// anagrafica + gating della UI. Da usare in coda a requireAuth(), che
// valorizza currentUserRoles leggendo l'utente dal DB.
function requireRole(...allowed: UserRole[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const roles = c.get('currentUserRoles') ?? []
    if (!allowed.some((r) => roles.includes(r))) {
      return c.json({ error: `Operazione riservata ai ruoli: ${allowed.join(', ')}` }, 403)
    }
    await next()
  }
}

function corsMiddleware(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { frontendUrl, isProd } = c.get('config')
    const origin = c.req.header('origin')

    let allowOrigin: string | null = null
    if (origin) {
      if (origin === frontendUrl) allowOrigin = origin
      else if (!isProd && /^https?:\/\/localhost(:\d+)?$/.test(origin)) allowOrigin = origin
    }

    if (allowOrigin) {
      c.header('Access-Control-Allow-Origin', allowOrigin)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Vary', 'Origin')
    }

    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      return c.body(null, 204)
    }

    await next()
  }
}

export function registerRoutes<E extends Env>(app: Hono<E>): void {
  const hono = app as unknown as Hono<Env>
  hono.use('*', corsMiddleware())

  // ── Health ──────────────────────────────────────────────────
  hono.get('/health', (c) => c.json({ status: 'ok', version: '0.5.0' }))

  // ── Auth: Step 1 — redirect a Google ───────────────────────
  hono.get('/auth/google', (c) => {
    const { googleClientId, callbackUrl } = c.get('config')
    if (!googleClientId) {
      return c.json({ error: 'GOOGLE_CLIENT_ID non configurato' }, 500)
    }
    return c.redirect(buildGoogleAuthURL(googleClientId, callbackUrl))
  })

  // ── Auth: Step 2 — callback da Google ──────────────────────
  hono.get('/auth/google/callback', async (c) => {
    const { googleClientId, googleClientSecret, callbackUrl, jwtSecret, frontendUrl } = c.get('config')
    const code = c.req.query('code')
    const error = c.req.query('error')

    if (error || !code) {
      console.warn('[auth] Google rifiutato o codice mancante:', error)
      return c.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error ?? 'no_code')}`)
    }

    try {
      const profile = await fetchGoogleProfile(code, googleClientId, googleClientSecret, callbackUrl)
      console.log(`[auth] Login: ${profile.email}`)

      const prisma = c.get('prisma')
      const nameParts = profile.name.trim().split(/\s+/).filter(Boolean)
      const derivedFirstName = nameParts[0] ?? null
      const derivedLastName = nameParts.slice(1).join(' ') || null

      // Solo email già censite in anagrafica (creata da un utente Board), non
      // disabilitate e con almeno un ruolo assegnato possono accedere: niente
      // auto-creazione dell'utente al primo login Google, e un utente eliminato
      // logicamente o senza ruoli è trattato come inesistente.
      const found = await prisma.user.findUnique({ where: { email: profile.email } })
      const existing = isActiveUser(found) ? found : null
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: {
              googleId:  profile.id,
              name:      profile.name,
              avatarUrl: profile.picture,
              firstName: existing.firstName ?? derivedFirstName,
              lastName:  existing.lastName ?? derivedLastName,
            },
          })
        : null

      const token = signJWT({
        sub:     profile.id,
        email:   profile.email,
        name:    profile.name,
        picture: profile.picture,
        userId:  user?.id ?? null,
        roles:   user?.roles ?? [],
      }, jwtSecret)
      return c.redirect(`${frontendUrl}?token=${token}`)
    } catch (err) {
      console.error('[auth] OAuth error:', err)
      return c.redirect(`${frontendUrl}?auth_error=oauth_failed`)
    }
  })

  // ── Auth: verifica token ────────────────────────────────────
  hono.get('/auth/me', async (c) => {
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Token mancante' }, 401)
    }
    let payload: JWTPayload
    try {
      payload = verifyJWT(header.slice(7), c.get('config').jwtSecret)
    } catch {
      return c.json({ error: 'Token non valido o scaduto' }, 401)
    }
    // Token valido ma email non censita in anagrafica, disabilitata o senza
    // ruoli assegnati: 403 distinto dal 401, così il frontend sa se deve
    // mostrare "sessione scaduta" o "utente non autorizzato".
    if (!payload.userId) {
      return c.json({ error: 'Utente non autorizzato', authorized: false }, 403)
    }
    const user = await c.get('prisma').user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true, roles: true, deletedAt: true },
    })
    if (!isActiveUser(user)) return c.json({ error: 'Utente non autorizzato', authorized: false }, 403)
    const { deletedAt: _deletedAt, ...publicUser } = user!
    return c.json({ user: publicUser })
  })

  // ── Utenti (anagrafica unica con ruoli) ──────────────────────

  const VALID_ROLES = ['ACCOUNT', 'PM', 'BOARD', 'DEVHUB'] as const

  hono.get('/api/users', requireAuth(), async (c) => {
    try {
      const role = c.req.query('role')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = { deletedAt: null }
      if (role?.trim()) {
        const roleVal = role.trim().toUpperCase()
        if (!VALID_ROLES.includes(roleVal as typeof VALID_ROLES[number])) {
          return c.json({ error: 'Ruolo non valido' }, 400)
        }
        where.roles = { has: roleVal }
      }
      const users = await c.get('prisma').user.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { name: 'asc' }],
        select: { id: true, firstName: true, lastName: true, name: true, email: true, roles: true },
      })
      return c.json(users)
    } catch (err) {
      console.error('[users] GET error:', err)
      return c.json({ error: 'Errore nel recupero degli utenti' }, 500)
    }
  })

  hono.post('/api/users', requireAuth(), async (c) => {
    const { firstName, lastName, email, roles } = await readJSON<{
      firstName?: string; lastName?: string; email?: string; roles?: string[]
    }>(c)

    if (!firstName?.trim() || !lastName?.trim()) {
      return c.json({ error: 'firstName e lastName sono obbligatori' }, 400)
    }
    if (email?.trim() && !EMAIL_RE.test(email.trim())) {
      return c.json({ error: 'Email non valida' }, 400)
    }
    const rolesVal = [...new Set((roles ?? []).map(r => r.trim().toUpperCase()))]
    if (rolesVal.some(r => !VALID_ROLES.includes(r as typeof VALID_ROLES[number]))) {
      return c.json({ error: 'Ruoli non validi' }, 400)
    }

    try {
      const user = await c.get('prisma').user.create({
        data: {
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          email:     email?.trim().toLowerCase() || null,
          roles:     rolesVal as ('ACCOUNT' | 'PM' | 'BOARD' | 'DEVHUB')[],
        },
        select: { id: true, firstName: true, lastName: true, email: true, roles: true },
      })
      return c.json(user, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') {
        // L'email è unica anche per gli utenti eliminati logicamente: se il conflitto
        // è con un utente disabilitato, segnaliamolo al frontend così può proporre
        // la riattivazione invece di un banale "email già in uso".
        const conflicting = email?.trim()
          ? await c.get('prisma').user.findUnique({
              where: { email: email.trim().toLowerCase() },
              select: { id: true, firstName: true, lastName: true, email: true, roles: true, deletedAt: true },
            })
          : null
        if (conflicting?.deletedAt) {
          const { deletedAt: _deletedAt, ...previewUser } = conflicting
          return c.json({
            error: 'Utente precedentemente eliminato',
            code: 'PREVIOUSLY_DELETED',
            user: previewUser,
          }, 409)
        }
        return c.json({ error: 'Email già presente' }, 409)
      }
      console.error('[users] POST error:', err)
      return c.json({ error: 'Errore nella creazione dell\'utente' }, 500)
    }
  })

  hono.put('/api/users/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    // L'email non è modificabile da qui: è l'identità con cui l'utente accede via
    // Google, e viene ignorata anche se il client la invia (il campo in UI è readonly).
    const { firstName, lastName, roles } = await readJSON<{
      firstName?: string; lastName?: string; roles?: string[]
    }>(c)

    if (!firstName?.trim() || !lastName?.trim()) {
      return c.json({ error: 'firstName e lastName sono obbligatori' }, 400)
    }
    const rolesVal = [...new Set((roles ?? []).map(r => r.trim().toUpperCase()))]
    if (rolesVal.some(r => !VALID_ROLES.includes(r as typeof VALID_ROLES[number]))) {
      return c.json({ error: 'Ruoli non validi' }, 400)
    }

    try {
      const user = await c.get('prisma').user.update({
        where: { id },
        data: {
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          roles:     rolesVal as ('ACCOUNT' | 'PM' | 'BOARD' | 'DEVHUB')[],
        },
        select: { id: true, firstName: true, lastName: true, email: true, roles: true },
      })
      return c.json(user)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Utente non trovato' }, 404)
      console.error('[users] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dell\'utente' }, 500)
    }
  })

  // Eliminazione logica: l'utente resta in DB (mantiene tutti i riferimenti storici
  // come PM/PO/Account su attività/progetti/clienti già assegnati) ma esce da elenco
  // e tendine (vedi filtro deletedAt su GET /api/users) e non può più accedere
  // (vedi controllo deletedAt in /auth/google/callback, /auth/me e requireAuth).
  hono.delete('/api/users/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').user.update({ where: { id }, data: { deletedAt: new Date() } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Utente non trovato' }, 404)
      console.error('[users] DELETE error:', err)
      return c.json({ error: 'Errore nella disabilitazione dell\'utente' }, 500)
    }
  })

  // Riattiva un utente eliminato logicamente, riusando lo stesso record (e quindi la
  // stessa email) invece di crearne uno nuovo — invocato dal frontend quando POST
  // /api/users risponde 409 PREVIOUSLY_DELETED e l'utente Board confirma la riattivazione.
  hono.patch('/api/users/:id/riattiva', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { firstName, lastName, roles } = await readJSON<{
      firstName?: string; lastName?: string; roles?: string[]
    }>(c)

    if (!firstName?.trim() || !lastName?.trim()) {
      return c.json({ error: 'firstName e lastName sono obbligatori' }, 400)
    }
    const rolesVal = [...new Set((roles ?? []).map(r => r.trim().toUpperCase()))]
    if (rolesVal.some(r => !VALID_ROLES.includes(r as typeof VALID_ROLES[number]))) {
      return c.json({ error: 'Ruoli non validi' }, 400)
    }

    try {
      const prisma = c.get('prisma')
      const existing = await prisma.user.findUnique({ where: { id } })
      if (!existing || !existing.deletedAt) {
        return c.json({ error: 'Utente non trovato o non precedentemente eliminato' }, 404)
      }
      const user = await prisma.user.update({
        where: { id },
        data: {
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          roles:     rolesVal as ('ACCOUNT' | 'PM' | 'BOARD' | 'DEVHUB')[],
          deletedAt: null,
        },
        select: { id: true, firstName: true, lastName: true, email: true, roles: true },
      })
      return c.json(user)
    } catch (err: unknown) {
      console.error('[users] PATCH riattiva error:', err)
      return c.json({ error: 'Errore nella riattivazione dell\'utente' }, 500)
    }
  })

  // ── Clienti CRUD ────────────────────────────────────────────

  const CLIENTI_INCLUDE = {
    _count: { select: { progetti: true } },
    account: { select: { id: true, firstName: true, lastName: true } },
  } as const

  hono.get('/clienti', requireAuth(), async (c) => {
    try {
      const clienti = await c.get('prisma').cliente.findMany({
        orderBy: { nome: 'asc' },
        include: CLIENTI_INCLUDE,
      })
      return c.json(clienti)
    } catch (err) {
      console.error('[clienti] GET error:', err)
      return c.json({ error: 'Errore nel recupero dei clienti' }, 500)
    }
  })

  hono.post('/clienti', requireAuth(), async (c) => {
    const { nome, referente, email, telefono, note, accountId } = await readJSON<{
      nome?: string; referente?: string; email?: string; telefono?: string; note?: string; accountId?: string
    }>(c)
    if (!nome?.trim()) return c.json({ error: 'Il nome è obbligatorio' }, 400)
    if (email?.trim() && !EMAIL_RE.test(email.trim())) return c.json({ error: 'Email non valida' }, 400)
    try {
      const cliente = await c.get('prisma').cliente.create({
        data: {
          nome: nome.trim(),
          referente: referente?.trim() || null,
          email: email?.trim().toLowerCase() || null,
          telefono: telefono?.trim() || null,
          note: note?.trim() || null,
          accountId: accountId?.trim() || null,
        },
        include: CLIENTI_INCLUDE,
      })
      return c.json(cliente, 201)
    } catch (err) {
      console.error('[clienti] POST error:', err)
      return c.json({ error: 'Errore nella creazione del cliente' }, 500)
    }
  })

  hono.put('/clienti/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { nome, referente, email, telefono, note, accountId } = await readJSON<{
      nome?: string; referente?: string; email?: string; telefono?: string; note?: string; accountId?: string
    }>(c)
    if (!nome?.trim()) return c.json({ error: 'Il nome è obbligatorio' }, 400)
    if (email?.trim() && !EMAIL_RE.test(email.trim())) return c.json({ error: 'Email non valida' }, 400)
    try {
      const cliente = await c.get('prisma').cliente.update({
        where: { id },
        data: {
          nome: nome.trim(),
          referente: referente?.trim() || null,
          email: email?.trim().toLowerCase() || null,
          telefono: telefono?.trim() || null,
          note: note?.trim() || null,
          accountId: accountId?.trim() || null,
        },
        include: CLIENTI_INCLUDE,
      })
      return c.json(cliente)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Cliente non trovato' }, 404)
      console.error('[clienti] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento del cliente' }, 500)
    }
  })

  hono.delete('/clienti/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').cliente.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Cliente non trovato' }, 404)
      console.error('[clienti] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione del cliente' }, 500)
    }
  })

  // ── Progetti CRUD ───────────────────────────────────────────

  hono.get('/progetti', requireAuth(), async (c) => {
    try {
      const tipo = c.req.query('tipo')
      const progetti = await c.get('prisma').progetto.findMany({
        where: tipo?.trim() ? { tipo: tipo.trim() } : undefined,
        orderBy: { nome: 'asc' },
        include: {
          cliente: { select: { id: true, nome: true } },
          po: { select: { id: true, firstName: true, lastName: true } },
          pmRiferimento: { select: { id: true, firstName: true, lastName: true } },
          responsabileDevHub: { select: { id: true, firstName: true, lastName: true } },
        },
      })
      return c.json(progetti)
    } catch (err) {
      console.error('[progetti] GET error:', err)
      return c.json({ error: 'Errore nel recupero dei progetti' }, 500)
    }
  })

  hono.post('/progetti', requireAuth(), async (c) => {
    const { nome, descrizione, tipo, stato, colore, clienteId, poId, pmRiferimentoId, responsabileDevHubId, dataInizio, dataFine } = await readJSON<{
      nome?: string; descrizione?: string; tipo?: string; stato?: string; colore?: string
      clienteId?: string; poId?: string; pmRiferimentoId?: string; responsabileDevHubId?: string; dataInizio?: string; dataFine?: string
    }>(c)
    if (!nome?.trim()) return c.json({ error: 'Il nome è obbligatorio' }, 400)
    const prisma = c.get('prisma')
    const tipoVal = tipo?.trim() === 'PRODOTTO' ? 'PRODOTTO' : 'CLIENTE'
    const statoVal = stato?.trim() ?? 'ATTIVO'
    const statiValidi = await prisma.statoProgettoConfig.findMany({ select: { chiave: true } })
    if (!statiValidi.some(s => s.chiave === statoVal)) {
      return c.json({ error: 'Stato non valido' }, 400)
    }
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const progetto = await prisma.progetto.create({
        data: {
          nome: nome.trim(),
          descrizione: descrizione?.trim() || null,
          tipo: tipoVal,
          stato: statoVal,
          colore: colore?.trim() || null,
          clienteId: tipoVal === 'CLIENTE' ? (clienteId?.trim() || null) : null,
          poId: tipoVal === 'PRODOTTO' ? (poId?.trim() || null) : null,
          pmRiferimentoId: pmRiferimentoId?.trim() || null,
          responsabileDevHubId: responsabileDevHubId?.trim() || null,
          dataInizio: dataInizio ? new Date(dataInizio) : null,
          dataFine: dataFine ? new Date(dataFine) : null,
        },
        include: {
          cliente: { select: { id: true, nome: true } },
          po: { select: { id: true, firstName: true, lastName: true } },
          pmRiferimento: { select: { id: true, firstName: true, lastName: true } },
          responsabileDevHub: { select: { id: true, firstName: true, lastName: true } },
        },
      })
      return c.json(progetto, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2003') return c.json({ error: 'Cliente, PO o Responsabile DevHub non trovato' }, 400)
      console.error('[progetti] POST error:', err)
      return c.json({ error: 'Errore nella creazione del progetto' }, 500)
    }
  })

  hono.put('/progetti/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { nome, descrizione, tipo, stato, colore, clienteId, poId, pmRiferimentoId, responsabileDevHubId, dataInizio, dataFine } = await readJSON<{
      nome?: string; descrizione?: string; tipo?: string; stato?: string; colore?: string
      clienteId?: string; poId?: string; pmRiferimentoId?: string; responsabileDevHubId?: string; dataInizio?: string; dataFine?: string
    }>(c)
    if (!nome?.trim()) return c.json({ error: 'Il nome è obbligatorio' }, 400)
    const prisma = c.get('prisma')
    const tipoVal = tipo?.trim() === 'PRODOTTO' ? 'PRODOTTO' : 'CLIENTE'
    const statoVal = stato?.trim() ?? 'ATTIVO'
    const statiValidi = await prisma.statoProgettoConfig.findMany({ select: { chiave: true } })
    if (!statiValidi.some(s => s.chiave === statoVal)) {
      return c.json({ error: 'Stato non valido' }, 400)
    }
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const progetto = await prisma.progetto.update({
        where: { id },
        data: {
          nome: nome.trim(),
          descrizione: descrizione?.trim() || null,
          tipo: tipoVal,
          stato: statoVal,
          colore: colore?.trim() || null,
          clienteId: tipoVal === 'CLIENTE' ? (clienteId?.trim() || null) : null,
          poId: tipoVal === 'PRODOTTO' ? (poId?.trim() || null) : null,
          pmRiferimentoId: pmRiferimentoId?.trim() || null,
          responsabileDevHubId: responsabileDevHubId?.trim() || null,
          dataInizio: dataInizio ? new Date(dataInizio) : null,
          dataFine: dataFine ? new Date(dataFine) : null,
        },
        include: {
          cliente: { select: { id: true, nome: true } },
          po: { select: { id: true, firstName: true, lastName: true } },
          pmRiferimento: { select: { id: true, firstName: true, lastName: true } },
          responsabileDevHub: { select: { id: true, firstName: true, lastName: true } },
        },
      })
      return c.json(progetto)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Progetto non trovato' }, 404)
      console.error('[progetti] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento del progetto' }, 500)
    }
  })

  hono.delete('/progetti/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').progetto.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Progetto non trovato' }, 404)
      console.error('[progetti] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione del progetto' }, 500)
    }
  })

  // ── Stati Attività Config CRUD ──────────────────────────────

  hono.get('/api/stati-attivita', requireAuth(), async (c) => {
    try {
      const stati = await c.get('prisma').statoAttivitaConfig.findMany({
        orderBy: [{ ordine: 'asc' }, { label: 'asc' }],
      })
      return c.json(stati)
    } catch (err) {
      console.error('[stati-attivita] GET error:', err)
      return c.json({ error: 'Errore nel recupero degli stati' }, 500)
    }
  })

  hono.post('/api/stati-attivita', requireAuth(), async (c) => {
    const { label, colore, isArchiviato, escludiDaConteggio, isPresale, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; escludiDaConteggio?: boolean; isPresale?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) {
      return c.json({ error: 'Colore non valido (usa formato hex, es. #3b82f6)' }, 400)
    }
    const chiave = label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || 'STATO'
    try {
      const stato = await c.get('prisma').statoAttivitaConfig.create({
        data: {
          chiave,
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isArchiviato: isArchiviato ?? false,
          escludiDaConteggio: escludiDaConteggio ?? false,
          isPresale: isPresale ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') {
        return c.json({ error: `Esiste già uno stato con chiave "${chiave}"` }, 409)
      }
      console.error('[stati-attivita] POST error:', err)
      return c.json({ error: 'Errore nella creazione dello stato' }, 500)
    }
  })

  hono.put('/api/stati-attivita/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { label, colore, isArchiviato, escludiDaConteggio, isPresale, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; escludiDaConteggio?: boolean; isPresale?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const stato = await c.get('prisma').statoAttivitaConfig.update({
        where: { id },
        data: {
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isArchiviato: isArchiviato ?? false,
          escludiDaConteggio: escludiDaConteggio ?? false,
          isPresale: isPresale ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Stato non trovato' }, 404)
      console.error('[stati-attivita] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dello stato' }, 500)
    }
  })

  hono.delete('/api/stati-attivita/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    try {
      const stato = await prisma.statoAttivitaConfig.findUnique({ where: { id } })
      if (!stato) return c.json({ error: 'Stato non trovato' }, 404)
      const inUso = await prisma.attivita.count({ where: { stato: stato.chiave } })
      if (inUso > 0) {
        return c.json({ error: `Stato in uso da ${inUso} attività — riassegna prima le attività` }, 409)
      }
      await prisma.statoAttivitaConfig.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      console.error('[stati-attivita] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione dello stato' }, 500)
    }
  })

  // ── Stati Progetto Config CRUD ──────────────────────────────

  hono.get('/api/stati-progetto', requireAuth(), async (c) => {
    try {
      const stati = await c.get('prisma').statoProgettoConfig.findMany({
        orderBy: [{ ordine: 'asc' }, { label: 'asc' }],
      })
      return c.json(stati)
    } catch (err) {
      console.error('[stati-progetto] GET error:', err)
      return c.json({ error: 'Errore nel recupero degli stati' }, 500)
    }
  })

  hono.post('/api/stati-progetto', requireAuth(), async (c) => {
    const { label, colore, isArchiviato, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) {
      return c.json({ error: 'Colore non valido (usa formato hex, es. #10b981)' }, 400)
    }
    const chiave = label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || 'STATO'
    try {
      const stato = await c.get('prisma').statoProgettoConfig.create({
        data: {
          chiave,
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isArchiviato: isArchiviato ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') {
        return c.json({ error: `Esiste già uno stato con chiave "${chiave}"` }, 409)
      }
      console.error('[stati-progetto] POST error:', err)
      return c.json({ error: 'Errore nella creazione dello stato' }, 500)
    }
  })

  hono.put('/api/stati-progetto/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { label, colore, isArchiviato, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const stato = await c.get('prisma').statoProgettoConfig.update({
        where: { id },
        data: {
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isArchiviato: isArchiviato ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Stato non trovato' }, 404)
      console.error('[stati-progetto] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dello stato' }, 500)
    }
  })

  hono.delete('/api/stati-progetto/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    try {
      const stato = await prisma.statoProgettoConfig.findUnique({ where: { id } })
      if (!stato) return c.json({ error: 'Stato non trovato' }, 404)
      const inUso = await prisma.progetto.count({ where: { stato: stato.chiave } })
      if (inUso > 0) {
        return c.json({ error: `Stato in uso da ${inUso} progetti — riassegna prima i progetti` }, 409)
      }
      await prisma.statoProgettoConfig.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      console.error('[stati-progetto] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione dello stato' }, 500)
    }
  })

  // ── Stati Roadmap Config CRUD ───────────────────────────────

  hono.get('/api/stati-roadmap', requireAuth(), async (c) => {
    try {
      const stati = await c.get('prisma').statoRoadmapConfig.findMany({
        orderBy: [{ ordine: 'asc' }, { label: 'asc' }],
      })
      return c.json(stati)
    } catch (err) {
      console.error('[stati-roadmap] GET error:', err)
      return c.json({ error: 'Errore nel recupero degli stati' }, 500)
    }
  })

  hono.post('/api/stati-roadmap', requireAuth(), async (c) => {
    const { label, colore, isArchiviato, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) {
      return c.json({ error: 'Colore non valido (usa formato hex, es. #10b981)' }, 400)
    }
    const chiave = label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || 'STATO'
    try {
      const stato = await c.get('prisma').statoRoadmapConfig.create({
        data: {
          chiave,
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isArchiviato: isArchiviato ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') {
        return c.json({ error: `Esiste già uno stato con chiave "${chiave}"` }, 409)
      }
      console.error('[stati-roadmap] POST error:', err)
      return c.json({ error: 'Errore nella creazione dello stato' }, 500)
    }
  })

  hono.put('/api/stati-roadmap/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { label, colore, isArchiviato, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const stato = await c.get('prisma').statoRoadmapConfig.update({
        where: { id },
        data: {
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isArchiviato: isArchiviato ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Stato non trovato' }, 404)
      console.error('[stati-roadmap] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dello stato' }, 500)
    }
  })

  hono.delete('/api/stati-roadmap/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    try {
      const stato = await prisma.statoRoadmapConfig.findUnique({ where: { id } })
      if (!stato) return c.json({ error: 'Stato non trovato' }, 404)
      const inUso = await prisma.roadmapItem.count({ where: { stato: stato.chiave } })
      if (inUso > 0) {
        return c.json({ error: `Stato in uso da ${inUso} attività roadmap — riassegna prima le attività` }, 409)
      }
      await prisma.statoRoadmapConfig.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      console.error('[stati-roadmap] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione dello stato' }, 500)
    }
  })

  // ── Roadmap Tags CRUD ────────────────────────────────────────

  hono.get('/api/roadmap-tags', requireAuth(), async (c) => {
    try {
      const tags = await c.get('prisma').roadmapTag.findMany({
        orderBy: [{ ordine: 'asc' }, { label: 'asc' }],
      })
      return c.json(tags)
    } catch (err) {
      console.error('[roadmap-tags] GET error:', err)
      return c.json({ error: 'Errore nel recupero dei tag' }, 500)
    }
  })

  hono.post('/api/roadmap-tags', requireAuth(), async (c) => {
    const { label, colore, ordine } = await readJSON<{ label?: string; colore?: string; ordine?: number }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const tag = await c.get('prisma').roadmapTag.create({
        data: { label: label.trim(), colore: colore?.trim() || '#94a3b8', ordine: ordine ?? 99 },
      })
      return c.json(tag, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') return c.json({ error: `Esiste già un tag "${label.trim()}"` }, 409)
      console.error('[roadmap-tags] POST error:', err)
      return c.json({ error: 'Errore nella creazione del tag' }, 500)
    }
  })

  hono.put('/api/roadmap-tags/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { label, colore, ordine } = await readJSON<{ label?: string; colore?: string; ordine?: number }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const tag = await c.get('prisma').roadmapTag.update({
        where: { id },
        data: { label: label.trim(), colore: colore?.trim() || '#94a3b8', ordine: ordine ?? 99 },
      })
      return c.json(tag)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Tag non trovato' }, 404)
      if ((err as { code?: string }).code === 'P2002') return c.json({ error: `Esiste già un tag "${label.trim()}"` }, 409)
      console.error('[roadmap-tags] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento del tag' }, 500)
    }
  })

  hono.delete('/api/roadmap-tags/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').roadmapTag.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Tag non trovato' }, 404)
      console.error('[roadmap-tags] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione del tag' }, 500)
    }
  })

  // ── Roadmap Items CRUD ──────────────────────────────────────

  const roadmapItemInclude = {
    progetto: {
      select: {
        id: true, nome: true, colore: true, poId: true,
        responsabileDevHubId: true,
        responsabileDevHub: { select: { id: true, firstName: true, lastName: true } },
      },
    },
    tags: { include: { tag: true } },
    // Attività generate/agganciate alla card: da qui derivano finanziamento
    // e avanzamento (mai persistiti sulla card)
    attivita: {
      select: {
        id: true, attivita: true, cliente: true, clienteId: true, stato: true,
        giornateVendute: true, giornateConsuntivate: true, riferimentoOrdineVendita: true,
      },
    },
  } as const

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function flattenRoadmapItem(item: any) {
    const { tags, progetto, attivita, ...rest } = item
    const { responsabileDevHubId, responsabileDevHub, ...progettoRest } = progetto ?? {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const figlie = ((attivita ?? []) as any[]).map((a) => ({
      ...a,
      giornateVendute: a.giornateVendute === null ? null : toNumber(a.giornateVendute),
      giornateConsuntivate: a.giornateConsuntivate === null ? null : toNumber(a.giornateConsuntivate),
    }))
    // Finanziamento derivato: chi paga si legge dalle figlie. Co-finanziata =
    // più committenti, oppure un committente + quota interna (clienteId null).
    const clientiFinanziatori = [...new Map(
      figlie.filter((a) => a.clienteId !== null).map((a) => [a.clienteId as string, a.cliente as string])
    ).entries()].map(([cId, nome]) => ({ id: cId, nome }))
    const hasInterno = figlie.some((a) => a.clienteId === null)
    const finanziamento = figlie.length === 0
      ? null
      : clientiFinanziatori.length === 0
        ? 'INVESTIMENTO'
        : (clientiFinanziatori.length > 1 || hasInterno) ? 'CO_FINANZIATA' : 'FINANZIATA'
    return {
      ...rest,
      progetto: progettoRest,
      // Il DevHub è un attributo del prodotto/progetto, non della singola
      // attività roadmap: viene ereditato dal Progetto associato.
      devHub: responsabileDevHub ?? null,
      devHubId: responsabileDevHubId ?? null,
      tags: (tags ?? []).map((t: { tag: unknown }) => t.tag),
      attivitaCollegate: figlie,
      finanziamento,
      clientiFinanziatori,
      totaleVendute: figlie.reduce((s, a) => s + (a.giornateVendute ?? 0), 0),
      totaleConsuntivate: figlie.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0),
    }
  }

  async function syncRoadmapItemTags(prisma: PrismaClient, roadmapItemId: string, tagIds: string[]) {
    await prisma.roadmapItemTag.deleteMany({ where: { roadmapItemId } })
    if (tagIds.length > 0) {
      await prisma.roadmapItemTag.createMany({
        data: tagIds.map(tagId => ({ roadmapItemId, tagId })),
        skipDuplicates: true,
      })
    }
  }

  hono.get('/api/roadmap-items', requireAuth(), async (c) => {
    try {
      const progettoId = c.req.query('progettoId')
      const anno = c.req.query('anno')
      const tag = c.req.query('tag')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = {}
      if (progettoId?.trim()) where['progettoId'] = progettoId.trim()
      if (anno?.trim()) where['anno'] = parseInt(anno, 10)
      if (tag?.trim()) where['tags'] = { some: { tagId: tag.trim() } }
      // Il filtro DevHub punta al responsabile del prodotto/progetto associato,
      // non a un assegnatario della singola attività roadmap.
      const devHubId = c.req.query('devHubId')
      if (devHubId?.trim()) {
        where['progetto'] = { responsabileDevHubId: { in: devHubId.split(',').map(v => v.trim()).filter(Boolean) } }
      }
      const items = await c.get('prisma').roadmapItem.findMany({
        where,
        orderBy: [{ anno: 'asc' }, { quarter: 'asc' }, { ordine: 'asc' }],
        include: roadmapItemInclude,
      })
      return c.json(items.map(flattenRoadmapItem))
    } catch (err) {
      console.error('[roadmap-items] GET error:', err)
      return c.json({ error: 'Errore nel recupero delle attività roadmap' }, 500)
    }
  })

  hono.post('/api/roadmap-items', requireAuth(), async (c) => {
    const { progettoId, anno, quarter, dataDeadline, titolo, descrizione, stato, analisiUrl, stimaGg, ordine, tagIds } = await readJSON<{
      progettoId?: string; anno?: number; quarter?: string | null; dataDeadline?: string | null
      titolo?: string; descrizione?: string; stato?: string; analisiUrl?: string
      stimaGg?: number | null; ordine?: number; tagIds?: string[]
    }>(c)
    if (!progettoId?.trim()) return c.json({ error: 'progettoId è obbligatorio' }, 400)
    if (!titolo?.trim()) return c.json({ error: 'Il titolo è obbligatorio' }, 400)
    if (!anno) return c.json({ error: 'L\'anno è obbligatorio' }, 400)
    const analisiErr = invalidLinkError({ 'Link analisi': analisiUrl })
    if (analisiErr) return c.json({ error: analisiErr }, 400)
    const prisma = c.get('prisma')
    const statoVal = stato?.trim() ?? 'DA_FARE'
    const statiValidi = await prisma.statoRoadmapConfig.findMany({ select: { chiave: true } })
    if (statiValidi.length > 0 && !statiValidi.some(s => s.chiave === statoVal)) {
      return c.json({ error: 'Stato non valido' }, 400)
    }
    try {
      const item = await prisma.roadmapItem.create({
        data: {
          progettoId: progettoId.trim(),
          anno,
          quarter: quarter?.trim() || null,
          dataDeadline: dataDeadline ? new Date(dataDeadline) : null,
          titolo: titolo.trim(),
          descrizione: descrizione?.trim() || null,
          stato: statoVal,
          analisiUrl: analisiUrl?.trim() || null,
          stimaGg: stimaGg ?? null,
          ordine: ordine ?? 0,
          tags: Array.isArray(tagIds) && tagIds.length > 0
            ? { create: tagIds.map(tagId => ({ tagId })) }
            : undefined,
        },
        include: roadmapItemInclude,
      })
      return c.json(flattenRoadmapItem(item), 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2003') return c.json({ error: 'Prodotto o tag non trovato' }, 400)
      console.error('[roadmap-items] POST error:', err)
      return c.json({ error: 'Errore nella creazione dell\'attività roadmap' }, 500)
    }
  })

  hono.put('/api/roadmap-items/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { progettoId, anno, quarter, dataDeadline, titolo, descrizione, stato, analisiUrl, stimaGg, ordine, tagIds } = await readJSON<{
      progettoId?: string; anno?: number; quarter?: string | null; dataDeadline?: string | null
      titolo?: string; descrizione?: string; stato?: string; analisiUrl?: string
      stimaGg?: number | null; ordine?: number; tagIds?: string[]
    }>(c)
    if (!titolo?.trim()) return c.json({ error: 'Il titolo è obbligatorio' }, 400)
    if (!anno) return c.json({ error: 'L\'anno è obbligatorio' }, 400)
    const prisma = c.get('prisma')
    // Solo i link nuovi/modificati vengono validati (grandfathering dei
    // valori storici non conformi — vedi PUT /api/attivita/:id)
    const existingItem = await prisma.roadmapItem.findUnique({ where: { id }, select: { analisiUrl: true } })
    if (!existingItem) return c.json({ error: 'Attività roadmap non trovata' }, 404)
    if ((analisiUrl?.trim() || null) !== existingItem.analisiUrl) {
      const analisiErrPut = invalidLinkError({ 'Link analisi': analisiUrl })
      if (analisiErrPut) return c.json({ error: analisiErrPut }, 400)
    }
    const statoVal = stato?.trim() ?? 'DA_FARE'
    const statiValidi = await prisma.statoRoadmapConfig.findMany({ select: { chiave: true } })
    if (statiValidi.length > 0 && !statiValidi.some(s => s.chiave === statoVal)) {
      return c.json({ error: 'Stato non valido' }, 400)
    }
    try {
      if (Array.isArray(tagIds)) await syncRoadmapItemTags(prisma, id, tagIds)
      const item = await prisma.roadmapItem.update({
        where: { id },
        data: {
          progettoId: progettoId?.trim() || undefined,
          anno,
          quarter: quarter?.trim() || null,
          dataDeadline: dataDeadline ? new Date(dataDeadline) : null,
          titolo: titolo.trim(),
          descrizione: descrizione?.trim() || null,
          stato: statoVal,
          analisiUrl: analisiUrl?.trim() || null,
          stimaGg: stimaGg ?? null,
          ordine: ordine ?? 0,
        },
        include: roadmapItemInclude,
      })
      return c.json(flattenRoadmapItem(item))
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività roadmap non trovata' }, 404)
      if ((err as { code?: string }).code === 'P2003') return c.json({ error: 'Prodotto o tag non trovato' }, 400)
      console.error('[roadmap-items] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dell\'attività roadmap' }, 500)
    }
  })

  // PATCH /api/roadmap-items/:id/posizione — usato dal drag&drop (Lista e Kanban)
  hono.patch('/api/roadmap-items/:id/posizione', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { ordine, anno, quarter, stato } = await readJSON<{
      ordine?: number; anno?: number; quarter?: string | null; stato?: string
    }>(c)
    try {
      const item = await c.get('prisma').roadmapItem.update({
        where: { id },
        data: {
          ordine: ordine ?? undefined,
          anno: anno ?? undefined,
          quarter: quarter !== undefined ? (quarter?.trim() || null) : undefined,
          stato: stato?.trim() || undefined,
        },
      })
      return c.json(item)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività roadmap non trovata' }, 404)
      return c.json({ error: 'Errore aggiornamento posizione' }, 500)
    }
  })

  hono.delete('/api/roadmap-items/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').roadmapItem.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività roadmap non trovata' }, 404)
      console.error('[roadmap-items] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione dell\'attività roadmap' }, 500)
    }
  })

  // DELETE /api/roadmap-items/:id/tags/:tagId — scollega un singolo tag (senza toccare il resto)
  hono.delete('/api/roadmap-items/:id/tags/:tagId', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const tagId = c.req.param('tagId')
    try {
      await c.get('prisma').roadmapItemTag.delete({ where: { roadmapItemId_tagId: { roadmapItemId: id, tagId } } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Associazione tag non trovata' }, 404)
      console.error('[roadmap-items] DELETE tag error:', err)
      return c.json({ error: 'Errore nella rimozione del tag' }, 500)
    }
  })

  // POST /api/roadmap-items/:id/avvia — card roadmap → attività.
  // Crea un'Attivita collegata alla card: con clienteId è la quota
  // commissionata da quel cliente (account ereditato dal cliente se non
  // indicato), senza clienteId è la quota di investimento interna
  // (cliente = "Interno", giornateVendute lette come stanziamento — così la
  // logica di sforamento segnala l'investimento oltre il previsto).
  // Ripetibile sulla stessa card: una chiamata per committente.
  hono.post('/api/roadmap-items/:id/avvia', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { clienteId, giornateVendute, riferimentoOrdineVendita, pmId, accountId, inizio, deadline, stato } = await readJSON<{
      clienteId?: string | null; giornateVendute?: unknown; riferimentoOrdineVendita?: string | null
      pmId?: string | null; accountId?: string | null
      inizio?: unknown; deadline?: unknown; stato?: string
    }>(c)
    const prisma = c.get('prisma')
    const item = await prisma.roadmapItem.findUnique({
      where: { id },
      include: { progetto: { select: { id: true, nome: true } } },
    })
    if (!item) return c.json({ error: 'Card roadmap non trovata' }, 404)

    const gg = parseImportoOrNull(giornateVendute)
    if (gg === 'invalid') return c.json({ error: 'Giornate non valide (numero ≥ 0)' }, 400)
    const inizioDate = parseDataOrNull(inizio)
    const deadlineDate = parseDataOrNull(deadline)
    if (inizioDate === 'invalid' || deadlineDate === 'invalid') return c.json({ error: 'Data non valida' }, 400)

    const resolved = await resolveAttivitaTipoStato(prisma, 'STANDARD', stato)
    if ('error' in resolved) return c.json({ error: resolved.error }, 400)

    let clienteNome = 'Interno'
    let effAccountId: string | null = accountId?.trim() || null
    if (clienteId?.trim()) {
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId.trim() } })
      if (!cliente) return c.json({ error: 'Cliente non trovato' }, 400)
      clienteNome = cliente.nome
      if (!effAccountId) effAccountId = cliente.accountId
    }

    try {
      const attivita = await prisma.attivita.create({
        data: {
          cliente: clienteNome,
          clienteId: clienteId?.trim() || null,
          progetto: item.progetto?.nome ?? '',
          progettoId: item.progettoId,
          attivita: item.titolo,
          tipo: 'STANDARD',
          stato: resolved.statoVal,
          giornateVendute: gg,
          riferimentoOrdineVendita: riferimentoOrdineVendita?.trim() || null,
          pmId: pmId?.trim() || null,
          accountId: effAccountId,
          inizio: inizioDate,
          deadline: deadlineDate,
          roadmapItemId: item.id,
        },
      })
      await logStatoChange(prisma, attivita.id, null, resolved.statoVal, c.get('currentUserId'))
      return c.json({ id: attivita.id, cliente: clienteNome, attivita: attivita.attivita }, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2003') return c.json({ error: 'PM o account inesistente' }, 400)
      console.error('[roadmap-items] avvia error:', err)
      return c.json({ error: 'Errore nella creazione dell\'attività' }, 500)
    }
  })

  // ── Attività CRUD ───────────────────────────────────────────

  // Stato fisso (non configurabile) delle attività BUCKET — a differenza delle
  // STANDARD, che usano StatoAttivitaConfig, qui non c'è nulla da gestire in
  // Impostazioni: solo Aperta/Chiusa, come i ruoli utente.
  const BUCKET_STATI = ['APERTA', 'CHIUSA'] as const

  async function resolveAttivitaTipoStato(
    prisma: PrismaClient,
    tipoInput: string | undefined,
    statoInput: string | undefined,
  ): Promise<{ tipoVal: 'STANDARD' | 'BUCKET'; statoVal: string } | { error: string }> {
    const tipoVal = (tipoInput?.trim().toUpperCase() || 'STANDARD') as 'STANDARD' | 'BUCKET'
    if (tipoVal !== 'STANDARD' && tipoVal !== 'BUCKET') return { error: 'Tipo non valido' }

    if (tipoVal === 'BUCKET') {
      const statoVal = statoInput?.trim().toUpperCase() || 'APERTA'
      if (!BUCKET_STATI.includes(statoVal as typeof BUCKET_STATI[number])) {
        return { error: 'Stato non valido per attività bucket (deve essere APERTA o CHIUSA)' }
      }
      return { tipoVal, statoVal }
    }

    const statoVal = statoInput?.trim() ?? 'IN_CORSO'
    const statiValidi = await prisma.statoAttivitaConfig.findMany({ select: { chiave: true } })
    if (!statiValidi.some(s => s.chiave === statoVal)) return { error: 'Stato non valido' }
    return { tipoVal, statoVal }
  }

  // GET /api/attivita — lista raggruppata per cliente+progetto
  // ?tipo=STANDARD|BUCKET (default STANDARD, per non alterare il comportamento
  // di chi già chiama questa rotta senza saperne nulla — Dashboard, Gantt).
  // Le attività BUCKET hanno uno stato fisso APERTA/CHIUSA, non collegato a
  // StatoAttivitaConfig: tutta la logica di filtro/esclusione basata sugli
  // stati configurabili si applica solo al ramo STANDARD.
  hono.get('/api/attivita', requireAuth(), async (c) => {
    try {
      const prisma = c.get('prisma')
      const stato = c.req.query('stato')
      const soloAttivi = c.req.query('soloAttivi')
      const tipoParam = (c.req.query('tipo')?.trim().toUpperCase() || 'STANDARD') as 'STANDARD' | 'BUCKET'
      if (tipoParam !== 'STANDARD' && tipoParam !== 'BUCKET') {
        return c.json({ error: 'Tipo non valido' }, 400)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = { tipo: tipoParam }

      let escludiChiavi = new Set<string>()
      if (tipoParam === 'STANDARD') {
        const tuttiStati = await prisma.statoAttivitaConfig.findMany({
          select: { chiave: true, isArchiviato: true, escludiDaConteggio: true },
        })
        escludiChiavi = new Set(tuttiStati.filter(s => s.escludiDaConteggio).map(s => s.chiave))

        let statoAttiviChiavi: string[] | undefined = undefined
        if (soloAttivi === 'true') {
          statoAttiviChiavi = tuttiStati.filter(s => !s.isArchiviato).map(s => s.chiave)
        }

        if (stato?.trim()) {
          const chiavi = stato.split(',').map(s => s.trim()).filter(Boolean)
          if (chiavi.length > 0) {
            where['stato'] = { in: statoAttiviChiavi ? chiavi.filter(v => statoAttiviChiavi!.includes(v)) : chiavi }
          }
        } else if (statoAttiviChiavi) {
          where['stato'] = { in: statoAttiviChiavi }
        }
      } else if (soloAttivi === 'true') {
        where['stato'] = 'APERTA'
      }

      const rows = await prisma.attivita.findMany({
        where,
        orderBy: [{ cliente: 'asc' }, { progetto: 'asc' }, { attivita: 'asc' }],
        include: {
          clienteRel: { select: { id: true, nome: true, accountId: true, account: { select: { id: true, firstName: true, lastName: true } } } },
          progettoRel: {
            select: {
              id: true, nome: true, responsabileDevHubId: true,
              responsabileDevHub: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          pm: { select: { id: true, firstName: true, lastName: true } },
          // Dettaglio mensile solo per la vista bucket (rapportino PM)
          consuntiviMese: tipoParam === 'BUCKET' ? { orderBy: { mese: 'asc' as const } } : false,
        },
      })

      const resolvedName = (first: string | null, last: string) => [first, last].filter(Boolean).join(' ')

      const groupMap = new Map<string, {
        cliente: string; progetto: string; account: string
        projectManager: string; attivita: typeof rows
      }>()

      for (const row of rows) {
        const clienteNome = row.clienteRel?.nome ?? row.cliente
        const progettoNome = row.progettoRel?.nome ?? row.progetto
        const key = `${clienteNome}|||${progettoNome}`
        if (!groupMap.has(key)) {
          const accountName = row.clienteRel?.account
            ? resolvedName(row.clienteRel.account.firstName, row.clienteRel.account.lastName)
            : ''
          const pmName = row.pm ? resolvedName(row.pm.firstName, row.pm.lastName) : ''
          groupMap.set(key, { cliente: clienteNome, progetto: progettoNome, account: accountName, projectManager: pmName, attivita: [] })
        }
        groupMap.get(key)!.attivita.push(row)
      }

      const gruppi = Array.from(groupMap.values()).map(g => {
        const attivitaMapped = g.attivita.map(a => {
          const clienteNome = a.clienteRel?.nome ?? a.cliente
          const progettoNome = a.progettoRel?.nome ?? a.progetto
          const accountName = a.clienteRel?.account
            ? resolvedName(a.clienteRel.account.firstName, a.clienteRel.account.lastName)
            : ''
          const pmName = a.pm ? resolvedName(a.pm.firstName, a.pm.lastName) : ''
          return {
            id: a.id,
            tipo: a.tipo,
            cliente: clienteNome,
            clienteId: a.clienteId ?? null,
            progetto: progettoNome,
            progettoId: a.progettoId ?? null,
            account: accountName,
            accountId: a.clienteRel?.accountId ?? null,
            projectManager: pmName,
            pmId: a.pmId ?? null,
            // Il responsabile DevHub è un attributo del progetto, non della
            // singola attività: qui esposto in sola lettura ereditandolo da
            // progettoRel (impostabile da Progetti & Prodotti).
            devHub: a.progettoRel?.responsabileDevHub
              ? resolvedName(a.progettoRel.responsabileDevHub.firstName, a.progettoRel.responsabileDevHub.lastName)
              : '',
            devHubId: a.progettoRel?.responsabileDevHubId ?? null,
            attivita: a.attivita,
            giornateVendute: a.giornateVendute !== null ? toNumber(a.giornateVendute) : null,
            giornateFatturate: a.giornateFatturate !== null ? toNumber(a.giornateFatturate) : null,
            giornateConsuntivate: a.giornateConsuntivate !== null ? toNumber(a.giornateConsuntivate) : null,
            riferimentoOrdineVendita: a.riferimentoOrdineVendita,
            stato: a.stato,
            inizio: a.inizio?.toISOString().split('T')[0] ?? null,
            deadline: a.deadline?.toISOString().split('T')[0] ?? null,
            note: a.note,
            consuntiviMese: ('consuntiviMese' in a && Array.isArray(a.consuntiviMese))
              ? a.consuntiviMese.map((m) => ({
                  mese: m.mese,
                  giornateConsuntivate: m.giornateConsuntivate !== null ? toNumber(m.giornateConsuntivate) : null,
                  giornateFatturate: m.giornateFatturate !== null ? toNumber(m.giornateFatturate) : null,
                }))
              : [],
          }
        })

        // BUCKET: "chiusa" esce dai totali come farebbe uno stato archiviato/
        // escludiDaConteggio per le STANDARD (nessuna StatoAttivitaConfig coinvolta).
        const isContabile = (a: typeof attivitaMapped[number]) =>
          tipoParam === 'BUCKET' ? a.stato !== 'CHIUSA' : !escludiChiavi.has(a.stato)

        const attivitaContabili = attivitaMapped.filter(isContabile)
        const totaleVendute = attivitaContabili.reduce((s, a) => s + (a.giornateVendute ?? 0), 0)
        const totaleFatturate = attivitaContabili.reduce((s, a) => s + (a.giornateFatturate ?? 0), 0)
        const totaleConsuntivate = attivitaContabili.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0)

        // Segnale di sforamento (risorse consuntivate oltre il venduto): mantenuto
        // anche per le BUCKET come avviso secondario, ma per loro la metrica
        // primaria è il residuo da fatturare (vendute - fatturate), non questo delta.
        const inSforamento = totaleConsuntivate > totaleVendute ||
          attivitaContabili.some(a =>
            (a.giornateConsuntivate ?? 0) > 0 &&
            (a.giornateVendute === null || (a.giornateConsuntivate ?? 0) > (a.giornateVendute ?? 0))
          )

        return {
          cliente: g.cliente,
          progetto: g.progetto,
          account: g.account,
          projectManager: g.projectManager,
          totaleVendute: Math.round(totaleVendute * 100) / 100,
          totaleFatturate: Math.round(totaleFatturate * 100) / 100,
          totaleConsuntivate: Math.round(totaleConsuntivate * 100) / 100,
          totaleResiduoDaFatturare: Math.round((totaleVendute - totaleFatturate) * 100) / 100,
          inSforamento,
          attivita: attivitaMapped,
        }
      })

      gruppi.sort((a, b) => a.cliente.localeCompare(b.cliente, 'it') || a.progetto.localeCompare(b.progetto, 'it'))

      const allAttivita = gruppi.flatMap(g => g.attivita)
      const isContabileGlobale = (a: typeof allAttivita[number]) =>
        tipoParam === 'BUCKET' ? a.stato !== 'CHIUSA' : !escludiChiavi.has(a.stato)
      const allContabili = allAttivita.filter(isContabileGlobale)
      const riepilogo = {
        totaleProgetti: gruppi.length,
        totaleAttivita: allAttivita.length,
        attivitaInSforamento: allContabili.filter(a =>
          (a.giornateConsuntivate ?? 0) > 0 &&
          (a.giornateVendute === null || (a.giornateConsuntivate ?? 0) > (a.giornateVendute ?? 0))
        ).length,
        attivitaInApprovazione: allAttivita.filter(a => !isContabileGlobale(a)).length,
        totaleGiornateVendute: Math.round(allContabili.reduce((s, a) => s + (a.giornateVendute ?? 0), 0) * 100) / 100,
        totaleGiornateFatturate: Math.round(allContabili.reduce((s, a) => s + (a.giornateFatturate ?? 0), 0) * 100) / 100,
        totaleGiornateConsuntivate: Math.round(allContabili.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0) * 100) / 100,
      }

      return c.json({ gruppi, riepilogo })
    } catch (err) {
      console.error('[attivita] GET error:', err)
      return c.json({ error: 'Errore nel recupero delle attività' }, 500)
    }
  })

  // GET /api/attivita/presale — lista piatta delle attività in fase presale,
  // cioè il cui `stato` corrisponde a uno StatoAttivitaConfig con isPresale=true.
  // Alimenta la board Kanban Presale (le colonne sono gli stati presale ordinati).
  hono.get('/api/attivita/presale', requireAuth(), async (c) => {
    try {
      const prisma = c.get('prisma')
      const statiPresale = await prisma.statoAttivitaConfig.findMany({
        where: { isPresale: true },
        select: { chiave: true },
      })
      const chiaviPresale = statiPresale.map(s => s.chiave)
      if (chiaviPresale.length === 0) return c.json({ attivita: [] })

      const rows = await prisma.attivita.findMany({
        where: { tipo: 'STANDARD', stato: { in: chiaviPresale } },
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          clienteRel: { select: { id: true, nome: true, accountId: true, account: { select: { id: true, firstName: true, lastName: true } } } },
          progettoRel: {
            select: {
              id: true, nome: true, responsabileDevHubId: true,
              responsabileDevHub: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          pm: { select: { id: true, firstName: true, lastName: true } },
          presaleAssegnatario: { select: { id: true, firstName: true, lastName: true } },
        },
      })

      const nomeUtente = (u: { firstName: string | null; lastName: string | null } | null) =>
        u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : ''

      const attivita = rows.map(a => ({
        id: a.id,
        attivita: a.attivita,
        cliente: a.clienteRel?.nome ?? a.cliente,
        clienteId: a.clienteId ?? null,
        progetto: a.progettoRel?.nome ?? a.progetto,
        progettoId: a.progettoId ?? null,
        account: nomeUtente(a.clienteRel?.account ?? null),
        accountId: a.clienteRel?.accountId ?? null,
        projectManager: nomeUtente(a.pm),
        pmId: a.pmId ?? null,
        devHub: nomeUtente(a.progettoRel?.responsabileDevHub ?? null),
        devHubId: a.progettoRel?.responsabileDevHubId ?? null,
        stato: a.stato,
        giornateVendute: a.giornateVendute !== null ? toNumber(a.giornateVendute) : null,
        note: a.note,
        presaleLinkRequisiti: a.presaleLinkRequisiti,
        presaleLinkStima: a.presaleLinkStima,
        presaleLinkOfferta: a.presaleLinkOfferta,
        presaleDriveFolderId: a.presaleDriveFolderId ?? null,
        presaleGiornateStimate: a.presaleGiornateStimate !== null ? toNumber(a.presaleGiornateStimate) : null,
        presaleScadenzaStima: a.presaleScadenzaStima?.toISOString().split('T')[0] ?? null,
        presaleNotePerFase: (a.presaleNotePerFase as Record<string, string> | null) ?? null,
        presaleTipoIntervento: a.presaleTipoIntervento,
        presaleAssegnatario: nomeUtente(a.presaleAssegnatario),
        presaleAssegnatarioId: a.presaleAssegnatarioId ?? null,
        presaleEmailFasiInviate: a.presaleEmailFasiInviate ?? [],
        inizio: a.inizio?.toISOString().split('T')[0] ?? null,
        deadline: a.deadline?.toISOString().split('T')[0] ?? null,
      }))

      return c.json({ attivita })
    } catch (err) {
      console.error('[attivita/presale] GET error:', err)
      return c.json({ error: 'Errore nel recupero delle attività presale' }, 500)
    }
  })

  // POST /api/attivita
  hono.post('/api/attivita', requireAuth(), async (c) => {
    const prisma = c.get('prisma')
    const {
      clienteId, progettoId, pmId, attivita, tipo,
      giornateVendute, giornateFatturate, giornateConsuntivate, riferimentoOrdineVendita,
      stato, inizio, deadline, note,
      presaleLinkRequisiti, presaleLinkStima, presaleLinkOfferta, presaleDriveFolderId, presaleGiornateStimate, presaleScadenzaStima, presaleAssegnatarioId, presaleNotePerFase, presaleTipoIntervento,
      inviaMail,
    } = await readJSON<{
      clienteId?: string; progettoId?: string; pmId?: string | null
      attivita?: string; tipo?: string
      giornateVendute?: number | null; giornateFatturate?: number | null; giornateConsuntivate?: number | null
      riferimentoOrdineVendita?: string; stato?: string
      inizio?: string | null; deadline?: string | null; note?: string
      presaleLinkRequisiti?: string | null; presaleLinkStima?: string | null; presaleLinkOfferta?: string | null
      presaleDriveFolderId?: string | null
      presaleGiornateStimate?: number | null; presaleScadenzaStima?: string | null; presaleAssegnatarioId?: string | null
      presaleNotePerFase?: Record<string, string> | null; presaleTipoIntervento?: string | null
      inviaMail?: boolean
    }>(c)

    if (!clienteId?.trim() || !progettoId?.trim() || !attivita?.trim()) {
      return c.json({ error: 'cliente, progetto e attivita sono obbligatori' }, 400)
    }

    const linkErr = invalidLinkError({
      'Link analisi iniziale': presaleLinkRequisiti,
      'Link stima': presaleLinkStima,
      'Link offerta': presaleLinkOfferta,
    })
    if (linkErr) return c.json({ error: linkErr }, 400)

    const [linkedCliente, linkedProgetto] = await Promise.all([
      prisma.cliente.findUnique({
        where: { id: clienteId.trim() },
        select: { nome: true, accountId: true, account: { select: { firstName: true, lastName: true } } },
      }),
      prisma.progetto.findUnique({ where: { id: progettoId.trim() }, select: { nome: true } }),
    ])

    if (!linkedCliente || !linkedProgetto) {
      return c.json({ error: 'cliente o progetto non trovato' }, 400)
    }

    const resolved = await resolveAttivitaTipoStato(prisma, tipo, stato)
    if ('error' in resolved) return c.json({ error: resolved.error }, 400)
    const { tipoVal, statoVal } = resolved

    try {
      const row = await prisma.attivita.create({
        data: {
          cliente: linkedCliente.nome,
          clienteId: clienteId.trim(),
          progetto: linkedProgetto.nome,
          progettoId: progettoId.trim(),
          accountId: linkedCliente.accountId ?? null,
          attivita: attivita.trim(),
          tipo: tipoVal,
          giornateVendute: giornateVendute != null ? giornateVendute : null,
          giornateFatturate: giornateFatturate != null ? giornateFatturate : null,
          giornateConsuntivate: giornateConsuntivate != null ? giornateConsuntivate : null,
          riferimentoOrdineVendita: riferimentoOrdineVendita?.trim() || null,
          stato: statoVal,
          inizio: inizio ? new Date(inizio) : null,
          deadline: deadline ? new Date(deadline) : null,
          note: note?.trim() || null,
          presaleLinkRequisiti: presaleLinkRequisiti?.trim() || null,
          presaleLinkStima: presaleLinkStima?.trim() || null,
          presaleLinkOfferta: presaleLinkOfferta?.trim() || null,
          presaleDriveFolderId: presaleDriveFolderId?.trim() || null,
          presaleGiornateStimate: presaleGiornateStimate != null ? presaleGiornateStimate : null,
          presaleScadenzaStima: presaleScadenzaStima ? new Date(presaleScadenzaStima) : null,
          presaleNotePerFase: presaleNotePerFase ?? undefined,
          presaleTipoIntervento: presaleTipoIntervento?.trim() || null,
          presaleAssegnatarioId: presaleAssegnatarioId?.trim() || null,
          pmId: pmId?.trim() || null,
        },
      })
      await logStatoChange(prisma, row.id, null, statoVal, c.get('currentUserId'))
      // Invio mail SOLO se richiesto esplicitamente ("Salva e invia mail").
      const faseCreazione = STATO_TO_FASE[statoVal]
      if (inviaMail && faseCreazione) await sendPresaleFaseEmail(prisma, row.id, faseCreazione)
      return c.json(row, 201)
    } catch (err) {
      console.error('[attivita] POST error:', err)
      return c.json({ error: 'Errore nella creazione dell\'attività' }, 500)
    }
  })

  // PUT /api/attivita/:id
  // Il tipo (STANDARD/BUCKET) non è modificabile dopo la creazione — form ed
  // endpoint di creazione sono già distinti nel frontend — quindi viene letto
  // dal record esistente e ignorato se presente nel body.
  hono.put('/api/attivita/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    const {
      clienteId, progettoId, pmId, attivita,
      giornateVendute, giornateFatturate, giornateConsuntivate, riferimentoOrdineVendita,
      stato, inizio, deadline, note,
      presaleLinkRequisiti, presaleLinkStima, presaleLinkOfferta, presaleDriveFolderId, presaleGiornateStimate, presaleScadenzaStima, presaleAssegnatarioId, presaleNotePerFase, presaleTipoIntervento,
      inviaMail,
    } = await readJSON<{
      clienteId?: string; progettoId?: string; pmId?: string | null
      attivita?: string
      giornateVendute?: number | null; giornateFatturate?: number | null; giornateConsuntivate?: number | null
      riferimentoOrdineVendita?: string; stato?: string
      inizio?: string | null; deadline?: string | null; note?: string
      presaleLinkRequisiti?: string | null; presaleLinkStima?: string | null; presaleLinkOfferta?: string | null
      presaleDriveFolderId?: string | null
      presaleGiornateStimate?: number | null; presaleScadenzaStima?: string | null; presaleAssegnatarioId?: string | null
      presaleNotePerFase?: Record<string, string> | null; presaleTipoIntervento?: string | null
      inviaMail?: boolean
    }>(c)

    if (!clienteId?.trim() || !progettoId?.trim() || !attivita?.trim()) {
      return c.json({ error: 'cliente, progetto e attivita sono obbligatori' }, 400)
    }

    const existing = await prisma.attivita.findUnique({
      where: { id },
      select: {
        tipo: true, stato: true,
        presaleLinkRequisiti: true, presaleLinkStima: true, presaleLinkOfferta: true,
      },
    })
    if (!existing) return c.json({ error: 'Attività non trovata' }, 404)

    // Valida solo i link nuovi o modificati: i valori storici non conformi
    // (testo libero pre-validazione) non devono bloccare salvataggi che non
    // li toccano — magari da fasi che nemmeno mostrano quel campo.
    const changed = (nuovo: string | null | undefined, attuale: string | null) =>
      (nuovo?.trim() || null) !== attuale
    const linkErrPut = invalidLinkError({
      ...(changed(presaleLinkRequisiti, existing.presaleLinkRequisiti) ? { 'Link analisi iniziale': presaleLinkRequisiti } : {}),
      ...(changed(presaleLinkStima, existing.presaleLinkStima) ? { 'Link stima': presaleLinkStima } : {}),
      ...(changed(presaleLinkOfferta, existing.presaleLinkOfferta) ? { 'Link offerta': presaleLinkOfferta } : {}),
    })
    if (linkErrPut) return c.json({ error: linkErrPut }, 400)

    const [linkedCliente, linkedProgetto] = await Promise.all([
      prisma.cliente.findUnique({
        where: { id: clienteId.trim() },
        select: { nome: true, accountId: true, account: { select: { firstName: true, lastName: true } } },
      }),
      prisma.progetto.findUnique({ where: { id: progettoId.trim() }, select: { nome: true } }),
    ])

    if (!linkedCliente || !linkedProgetto) {
      return c.json({ error: 'cliente o progetto non trovato' }, 400)
    }

    const resolved = await resolveAttivitaTipoStato(prisma, existing.tipo, stato)
    if ('error' in resolved) return c.json({ error: resolved.error }, 400)
    const { statoVal } = resolved

    try {
      const row = await prisma.attivita.update({
        where: { id },
        data: {
          cliente: linkedCliente.nome,
          clienteId: clienteId.trim(),
          progetto: linkedProgetto.nome,
          progettoId: progettoId.trim(),
          accountId: linkedCliente.accountId ?? null,
          attivita: attivita.trim(),
          giornateVendute: giornateVendute != null ? giornateVendute : null,
          giornateFatturate: giornateFatturate != null ? giornateFatturate : null,
          giornateConsuntivate: giornateConsuntivate != null ? giornateConsuntivate : null,
          riferimentoOrdineVendita: riferimentoOrdineVendita?.trim() || null,
          stato: statoVal,
          inizio: inizio ? new Date(inizio) : null,
          deadline: deadline ? new Date(deadline) : null,
          note: note?.trim() || null,
          presaleLinkRequisiti: presaleLinkRequisiti?.trim() || null,
          presaleLinkStima: presaleLinkStima?.trim() || null,
          presaleLinkOfferta: presaleLinkOfferta?.trim() || null,
          presaleDriveFolderId: presaleDriveFolderId?.trim() || null,
          presaleGiornateStimate: presaleGiornateStimate != null ? presaleGiornateStimate : null,
          presaleScadenzaStima: presaleScadenzaStima ? new Date(presaleScadenzaStima) : null,
          presaleNotePerFase: presaleNotePerFase ?? undefined,
          presaleTipoIntervento: presaleTipoIntervento?.trim() || null,
          presaleAssegnatarioId: presaleAssegnatarioId?.trim() || null,
          pmId: pmId?.trim() || null,
        },
      })
      if (existing.stato !== statoVal) {
        await logStatoChange(prisma, id, existing.stato, statoVal, c.get('currentUserId'))
      }
      // Invio mail SOLO su richiesta esplicita ("Salva e invia mail"), e solo
      // se i dati della fase sono compilati (difesa contro invii a metà).
      const fasePut = STATO_TO_FASE[statoVal]
      if (inviaMail && fasePut && presaleFaseDataReady(fasePut, row)) {
        await sendPresaleFaseEmail(prisma, id, fasePut)
      }
      return c.json(row)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività non trovata' }, 404)
      console.error('[attivita] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dell\'attività' }, 500)
    }
  })

  // DELETE /api/attivita/:id
  hono.delete('/api/attivita/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').attivita.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività non trovata' }, 404)
      console.error('[attivita] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione dell\'attività' }, 500)
    }
  })

  // ── Gantt: PATCH date attività ──────────────────────────────
  hono.patch('/api/attivita/:id/dates', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { inizio, deadline } = await readJSON<{ inizio?: string | null; deadline?: string | null }>(c)
    try {
      const row = await c.get('prisma').attivita.update({
        where: { id },
        data: {
          inizio: inizio !== undefined ? (inizio ? new Date(inizio) : null) : undefined,
          deadline: deadline !== undefined ? (deadline ? new Date(deadline) : null) : undefined,
        },
      })
      return c.json(row)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività non trovata' }, 404)
      return c.json({ error: 'Errore aggiornamento date' }, 500)
    }
  })

  // PATCH /api/attivita/:id/stato — cambio stato leggero (drop tra colonne del
  // Kanban Presale, e azione "Conferma e rendi effettiva" → stato non-presale).
  // Valida che la chiave esista in StatoAttivitaConfig; le BUCKET non passano di qui.
  hono.patch('/api/attivita/:id/stato', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    const { stato, inviaMail } = await readJSON<{ stato?: string; inviaMail?: boolean }>(c)
    if (!stato?.trim()) return c.json({ error: 'stato è obbligatorio' }, 400)
    const statoVal = stato.trim()

    const existing = await prisma.attivita.findUnique({ where: { id }, select: { tipo: true, stato: true } })
    if (!existing) return c.json({ error: 'Attività non trovata' }, 404)
    if (existing.tipo !== 'STANDARD') {
      return c.json({ error: 'Cambio stato non supportato per attività bucket' }, 400)
    }

    const valido = await prisma.statoAttivitaConfig.findUnique({ where: { chiave: statoVal }, select: { chiave: true } })
    if (!valido) return c.json({ error: 'Stato non valido' }, 400)

    try {
      const row = await prisma.attivita.update({ where: { id }, data: { stato: statoVal } })
      if (existing.stato !== statoVal) {
        await logStatoChange(prisma, id, existing.stato, statoVal, c.get('currentUserId'))
        // Uscita dal presale (era in una fase, ora in uno stato non-presale) =
        // conferma progetto → PROGETTO_CONFERMATO, ma solo se richiesto
        // esplicitamente ("Conferma e invia mail").
        if (inviaMail && STATO_TO_FASE[existing.stato] && !STATO_TO_FASE[statoVal]) {
          await sendPresaleFaseEmail(prisma, id, 'PROGETTO_CONFERMATO')
        }
      }
      return c.json(row)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività non trovata' }, 404)
      console.error('[attivita] PATCH stato error:', err)
      return c.json({ error: 'Errore aggiornamento stato' }, 500)
    }
  })

  // POST /api/attivita/:id/invia-mail — invio manuale (o re-invio) della mail
  // della fase. `fase` esplicita se passata (validata), altrimenti dedotta dallo
  // stato corrente. Ritorna 502 con motivo se SAIOT non accetta l'invio.
  hono.post('/api/attivita/:id/invia-mail', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    const { fase } = await readJSON<{ fase?: string }>(c)
    const existing = await prisma.attivita.findUnique({ where: { id }, select: { stato: true } })
    if (!existing) return c.json({ error: 'Attività non trovata' }, 404)

    const faseCode: PresaleFaseCode | undefined =
      fase && (PRESALE_FASI_VALIDE as string[]).includes(fase)
        ? (fase as PresaleFaseCode)
        : STATO_TO_FASE[existing.stato]
    if (!faseCode) return c.json({ error: 'Nessuna fase presale associata a questa attività' }, 400)

    const result = await sendPresaleFaseEmail(prisma, id, faseCode)
    if (!result.sent) return c.json({ sent: false, error: result.reason ?? 'Invio non riuscito' }, 502)
    return c.json({ sent: true, fase: faseCode })
  })

  // GET /api/attivita/:id/storico — timeline dei passaggi di stato (Presale)
  hono.get('/api/attivita/:id/storico', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      const rows = await c.get('prisma').attivitaStatoLog.findMany({
        where: { attivitaId: id },
        orderBy: [{ createdAt: 'asc' }],
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      })
      const storico = rows.map(r => ({
        id: r.id,
        statoDa: r.statoDa,
        statoA: r.statoA,
        utente: r.user ? [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') : '',
        data: r.createdAt.toISOString(),
      }))
      return c.json({ storico })
    } catch (err) {
      console.error('[attivita] GET storico error:', err)
      return c.json({ error: 'Errore nel recupero dello storico' }, 500)
    }
  })

  // ── Config notifiche Presale (SAIOT) ────────────────────────────────
  // GET/PUT ristretti all'allowlist Presale (contengono i codici SAIOT).
  hono.get('/api/config/presale-email', requireAuth(), async (c) => {
    const prisma = c.get('prisma')
    if (!(await isPresaleEmailAdmin(prisma, c.get('currentUserId')))) {
      return c.json({ error: 'Non autorizzato' }, 403)
    }
    return c.json(await getPresaleEmailConfig(prisma))
  })

  hono.put('/api/config/presale-email', requireAuth(), async (c) => {
    const prisma = c.get('prisma')
    if (!(await isPresaleEmailAdmin(prisma, c.get('currentUserId')))) {
      return c.json({ error: 'Non autorizzato' }, 403)
    }
    const body = await readJSON<Partial<PresaleEmailConfig>>(c)
    const cfg: PresaleEmailConfig = {
      url: (body.url ?? '').toString(),
      contextCode: (body.contextCode ?? '').toString(),
      senderCode: (body.senderCode ?? '').toString(),
      eventName: (body.eventName ?? 'tpm').toString(),
      devhubEmail: (body.devhubEmail ?? '').toString(),
      enabled: body.enabled === true,
    }
    if (cfg.devhubEmail && !EMAIL_RE.test(cfg.devhubEmail.trim())) {
      return c.json({ error: 'Email gruppo DevHub non valida' }, 400)
    }
    await savePresaleEmailConfig(prisma, cfg)
    return c.json(await getPresaleEmailConfig(prisma))
  })

  // ── Config Google Drive (drive condivisi Sviluppo/Commerciale/Contratti) ──
  // Radici dei picker Drive: Sviluppo per analisi prodotti + presale
  // analisi/stima, Commerciale per presale trattativa, Contratti per i
  // documenti dei contratti assistenza/AMS ("Contratti annuali clienti e
  // prodotti"). Si salva l'URL incollato dall'utente e l'ID estratto (usato
  // dal Picker come radice). GET aperta a tutti gli autenticati (serve alle
  // pagine per aprire il picker); PUT solo Board, come la visibilità della
  // pagina Impostazioni.

  const GDRIVE_KEYS = {
    devUrl: 'gdrive_dev_url', devId: 'gdrive_dev_id',
    commUrl: 'gdrive_comm_url', commId: 'gdrive_comm_id',
    contrattiUrl: 'gdrive_contratti_url', contrattiId: 'gdrive_contratti_id',
  } as const

  // Estrae l'ID di un drive condiviso / cartella da un URL Drive, oppure
  // accetta un ID nudo (gli ID Drive reali sono ≥ 19 caratteri). null = non
  // riconosciuto; un URL http che non è un link a cartella viene rifiutato.
  const extractDriveId = (raw: string): string | null => {
    const s = raw.trim()
    if (s === '') return null
    const m = s.match(/\/(?:folders|drive\/(?:u\/\d+\/)?folders)\/([\w-]{10,})/) ??
              s.match(/\/drive\/(?:u\/\d+\/)?(?:shared-drives|folders)\/([\w-]{10,})/)
    if (m) return m[1]
    if (/^http/i.test(s)) return null
    return /^[\w-]{19,}$/.test(s) ? s : null
  }

  const readGDriveConfig = async (prisma: PrismaClient) => {
    const rows = await prisma.appConfig.findMany({ where: { chiave: { in: Object.values(GDRIVE_KEYS) } } })
    const map = new Map(rows.map((r) => [r.chiave, r.valore]))
    return {
      devUrl: map.get(GDRIVE_KEYS.devUrl) ?? '',
      devId: map.get(GDRIVE_KEYS.devId) ?? '',
      commUrl: map.get(GDRIVE_KEYS.commUrl) ?? '',
      commId: map.get(GDRIVE_KEYS.commId) ?? '',
      contrattiUrl: map.get(GDRIVE_KEYS.contrattiUrl) ?? '',
      contrattiId: map.get(GDRIVE_KEYS.contrattiId) ?? '',
    }
  }

  hono.get('/api/config/google-drive', requireAuth(), async (c) => {
    return c.json(await readGDriveConfig(c.get('prisma')))
  })

  hono.put('/api/config/google-drive', requireAuth(), requireRole('BOARD'), async (c) => {
    const { devUrl, commUrl, contrattiUrl } = await readJSON<{ devUrl?: unknown; commUrl?: unknown; contrattiUrl?: unknown }>(c)
    if (typeof devUrl !== 'string' || typeof commUrl !== 'string' || typeof contrattiUrl !== 'string') {
      return c.json({ error: 'devUrl, commUrl e contrattiUrl devono essere stringhe (vuote per disattivare)' }, 400)
    }
    const devId = extractDriveId(devUrl)
    const commId = extractDriveId(commUrl)
    const contrattiId = extractDriveId(contrattiUrl)
    if (devUrl.trim() !== '' && devId === null) {
      return c.json({ error: 'Link Drive Sviluppo non riconosciuto: incolla il link di uno shared drive o di una cartella' }, 400)
    }
    if (commUrl.trim() !== '' && commId === null) {
      return c.json({ error: 'Link Drive Commerciale non riconosciuto: incolla il link di uno shared drive o di una cartella' }, 400)
    }
    if (contrattiUrl.trim() !== '' && contrattiId === null) {
      return c.json({ error: 'Link Drive Contratti non riconosciuto: incolla il link di uno shared drive o di una cartella' }, 400)
    }
    const prisma = c.get('prisma')
    const entries: Array<[string, string]> = [
      [GDRIVE_KEYS.devUrl, devUrl.trim()], [GDRIVE_KEYS.devId, devId ?? ''],
      [GDRIVE_KEYS.commUrl, commUrl.trim()], [GDRIVE_KEYS.commId, commId ?? ''],
      [GDRIVE_KEYS.contrattiUrl, contrattiUrl.trim()], [GDRIVE_KEYS.contrattiId, contrattiId ?? ''],
    ]
    await prisma.$transaction(entries.map(([chiave, valore]) =>
      prisma.appConfig.upsert({ where: { chiave }, create: { chiave, valore }, update: { valore } })
    ))
    return c.json(await readGDriveConfig(prisma))
  })

  // ── Contratti di assistenza / AMS ────────────────────────────
  // Registro dei contratti di manutenzione/AMS per cliente (sostituisce
  // l'Excel "Contratti progetti"). Un contratto copre 1..N applicazioni
  // (= Progetto) e ha il SUO ordine di vendita: l'import consuntivi Zoho
  // aggiorna giornateConsuntivate per corrispondenza di codice GO-ORDV
  // (vedi /api/zoho/import/*). Il consumato € (giornate consuntivate ×
  // costo medio giornata) si confronta con budgetOrdini. Route riservate
  // a Board/PM/Account; stati e costo medio (config) solo Board.

  const CONTRATTO_ROLES = ['BOARD', 'PM', 'ACCOUNT'] as const
  const TIPI_CONTRATTO: TipoContratto[] = ['MANUTENZIONE', 'MANUTENZIONE_AMS']

  // Il PM del contratto non è un campo proprio: si eredita (sola lettura)
  // dai pmRiferimento dei progetti coperti — da qui la select sul progetto.
  const CONTRATTI_INCLUDE = {
    cliente: { select: { id: true, nome: true } },
    applicazioni: { include: { progetto: { select: { id: true, nome: true, pmRiferimento: { select: { id: true, firstName: true, lastName: true, name: true } } } } } },
  } as const

  // Decimal → number nel payload JSON (i Decimal serializzano come stringhe)
  // e appiattimento della join applicazioni in una lista di progetti.
  const serializeContratto = <T extends {
    importoTotale: unknown; giornateConsuntivate: unknown
    applicazioni: Array<{ progetto: { id: string; nome: string } }>
  }>(row: T) => ({
    ...row,
    importoTotale: row.importoTotale == null ? null : toNumber(row.importoTotale),
    giornateConsuntivate: row.giornateConsuntivate == null ? null : toNumber(row.giornateConsuntivate),
    applicazioni: row.applicazioni.map((a) => a.progetto),
  })

  const parseDataOrNull = (v: unknown): Date | null | 'invalid' => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string') return 'invalid'
    const d = new Date(v)
    return isNaN(d.getTime()) ? 'invalid' : d
  }

  const parseImportoOrNull = (v: unknown): number | null | 'invalid' => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && n >= 0 ? n : 'invalid'
  }

  type ContrattoBody = {
    titolo?: string; tipo?: string; anno?: unknown; stato?: string
    clienteId?: string
    dataInizio?: unknown; dataFine?: unknown
    rinnovoTacito?: boolean; disdettaEntro?: unknown
    importoTotale?: unknown; fatturato?: boolean
    riferimentoOrdineVendita?: string | null; driveUrl?: string | null; driveFolderId?: string | null
    note?: string | null
    applicazioniIds?: unknown
  }

  // Valida e normalizza il payload di POST/PUT contratto: ritorna il primo
  // errore, oppure i dati pronti per Prisma + gli id delle relazioni.
  const validateContrattoBody = (b: ContrattoBody) => {
    if (!b.titolo?.trim()) return { error: 'Il titolo è obbligatorio' }
    if (!b.clienteId?.trim()) return { error: 'Il cliente è obbligatorio' }
    const anno = typeof b.anno === 'number' ? b.anno : Number(b.anno)
    if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) {
      return { error: 'Anno di competenza non valido' }
    }
    const tipo = (b.tipo ?? 'MANUTENZIONE') as TipoContratto
    if (!TIPI_CONTRATTO.includes(tipo)) {
      return { error: `Tipo contratto non valido (ammessi: ${TIPI_CONTRATTO.join(', ')})` }
    }
    const dataInizio = parseDataOrNull(b.dataInizio)
    const dataFine = parseDataOrNull(b.dataFine)
    const disdettaEntro = parseDataOrNull(b.disdettaEntro)
    if (dataInizio === 'invalid' || dataFine === 'invalid' || disdettaEntro === 'invalid') {
      return { error: 'Data non valida' }
    }
    if (dataInizio && dataFine && dataFine < dataInizio) {
      return { error: 'La data di fine non può precedere quella di inizio' }
    }
    const importoTotale = parseImportoOrNull(b.importoTotale)
    if (importoTotale === 'invalid') {
      return { error: 'Importo non valido (numero ≥ 0)' }
    }
    const linkError = invalidLinkError({ 'Link contratto': b.driveUrl })
    if (linkError) return { error: linkError }
    const applicazioniIds = Array.isArray(b.applicazioniIds)
      ? [...new Set(b.applicazioniIds.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))]
      : []
    return {
      data: {
        titolo: b.titolo.trim(),
        tipo,
        anno,
        stato: b.stato?.trim() || 'IN_DEFINIZIONE',
        clienteId: b.clienteId.trim(),
        dataInizio, dataFine, disdettaEntro,
        rinnovoTacito: b.rinnovoTacito ?? false,
        importoTotale,
        fatturato: b.fatturato ?? false,
        riferimentoOrdineVendita: b.riferimentoOrdineVendita?.trim() || null,
        driveUrl: b.driveUrl?.trim() || null,
        driveFolderId: b.driveFolderId?.trim() || null,
        note: b.note?.trim() || null,
      },
      applicazioniIds,
    }
  }

  hono.get('/api/contratti', requireAuth(), requireRole(...CONTRATTO_ROLES), async (c) => {
    try {
      const annoRaw = c.req.query('anno')
      const anno = annoRaw?.trim() ? Number(annoRaw) : undefined
      if (anno !== undefined && !Number.isInteger(anno)) {
        return c.json({ error: 'anno non valido' }, 400)
      }
      const contratti = await c.get('prisma').contratto.findMany({
        where: anno !== undefined ? { anno } : undefined,
        orderBy: [{ cliente: { nome: 'asc' } }, { titolo: 'asc' }],
        include: CONTRATTI_INCLUDE,
      })
      return c.json(contratti.map(serializeContratto))
    } catch (err) {
      console.error('[contratti] GET error:', err)
      return c.json({ error: 'Errore nel recupero dei contratti' }, 500)
    }
  })

  hono.post('/api/contratti', requireAuth(), requireRole(...CONTRATTO_ROLES), async (c) => {
    const body = await readJSON<ContrattoBody>(c)
    const parsed = validateContrattoBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      const contratto = await c.get('prisma').contratto.create({
        data: {
          ...parsed.data,
          applicazioni: { create: parsed.applicazioniIds.map((progettoId) => ({ progettoId })) },
        },
        include: CONTRATTI_INCLUDE,
      })
      return c.json(serializeContratto(contratto), 201)
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'P2003' || code === 'P2025') {
        return c.json({ error: 'Cliente o applicazione inesistente' }, 400)
      }
      console.error('[contratti] POST error:', err)
      return c.json({ error: 'Errore nella creazione del contratto' }, 500)
    }
  })

  hono.put('/api/contratti/:id', requireAuth(), requireRole(...CONTRATTO_ROLES), async (c) => {
    const id = c.req.param('id')
    const body = await readJSON<ContrattoBody>(c)
    const parsed = validateContrattoBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      const contratto = await c.get('prisma').contratto.update({
        where: { id },
        data: {
          ...parsed.data,
          applicazioni: {
            deleteMany: {},
            create: parsed.applicazioniIds.map((progettoId) => ({ progettoId })),
          },
        },
        include: CONTRATTI_INCLUDE,
      })
      return c.json(serializeContratto(contratto))
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'P2025') return c.json({ error: 'Contratto non trovato' }, 404)
      if (code === 'P2003') return c.json({ error: 'Cliente o applicazione inesistente' }, 400)
      console.error('[contratti] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento del contratto' }, 500)
    }
  })

  // Clona un contratto su un altro anno di competenza (rinnovo annuale senza
  // riscrivere tutto): date shiftate della differenza di anni, stato reset a
  // IN_DEFINIZIONE, fatturato/consuntivato/ordine di vendita/Drive/note
  // azzerati (sono dell'anno nuovo), applicazioni e importo copiati.
  hono.post('/api/contratti/:id/clona', requireAuth(), requireRole(...CONTRATTO_ROLES), async (c) => {
    const id = c.req.param('id')
    const { anno } = await readJSON<{ anno?: unknown }>(c)
    const annoNum = typeof anno === 'number' ? anno : Number(anno)
    if (!Number.isInteger(annoNum) || annoNum < 2000 || annoNum > 2100) {
      return c.json({ error: 'Anno di competenza non valido' }, 400)
    }
    const prisma = c.get('prisma')
    const src = await prisma.contratto.findUnique({ where: { id }, include: { applicazioni: true } })
    if (!src) return c.json({ error: 'Contratto non trovato' }, 404)
    if (annoNum === src.anno) return c.json({ error: 'Scegli un anno diverso da quello del contratto' }, 400)

    const shift = annoNum - src.anno
    const shiftAnno = (d: Date | null): Date | null => {
      if (!d) return null
      const r = new Date(d)
      r.setFullYear(r.getFullYear() + shift)
      return r
    }
    // Se il titolo contiene l'anno di origine, lo aggiorna al nuovo
    const titolo = src.titolo.split(String(src.anno)).join(String(annoNum))
    try {
      const nuovo = await prisma.contratto.create({
        data: {
          titolo,
          tipo: src.tipo,
          anno: annoNum,
          stato: 'IN_DEFINIZIONE',
          clienteId: src.clienteId,
          dataInizio: shiftAnno(src.dataInizio),
          dataFine: shiftAnno(src.dataFine),
          rinnovoTacito: src.rinnovoTacito,
          disdettaEntro: shiftAnno(src.disdettaEntro),
          importoTotale: src.importoTotale,
          fatturato: false,
          riferimentoOrdineVendita: null,
          giornateConsuntivate: null,
          driveUrl: null,
          driveFolderId: null,
          note: null,
          applicazioni: { create: src.applicazioni.map((a) => ({ progettoId: a.progettoId })) },
        },
        include: CONTRATTI_INCLUDE,
      })
      return c.json(serializeContratto(nuovo), 201)
    } catch (err) {
      console.error('[contratti] clona error:', err)
      return c.json({ error: 'Errore nella clonazione del contratto' }, 500)
    }
  })

  hono.delete('/api/contratti/:id', requireAuth(), requireRole(...CONTRATTO_ROLES), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').contratto.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Contratto non trovato' }, 404)
      console.error('[contratti] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione del contratto' }, 500)
    }
  })

  // ── Stati Contratto Config CRUD ─────────────────────────────
  // GET aperta agli autenticati (serve ai chip della pagina Contratti);
  // scritture solo Board, coerenti col resto della config contratti.

  hono.get('/api/stati-contratto', requireAuth(), async (c) => {
    try {
      const stati = await c.get('prisma').statoContrattoConfig.findMany({
        orderBy: [{ ordine: 'asc' }, { label: 'asc' }],
      })
      return c.json(stati)
    } catch (err) {
      console.error('[stati-contratto] GET error:', err)
      return c.json({ error: 'Errore nel recupero degli stati' }, 500)
    }
  })

  hono.post('/api/stati-contratto', requireAuth(), requireRole('BOARD'), async (c) => {
    const { label, colore, isChiuso, ordine } = await readJSON<{
      label?: string; colore?: string; isChiuso?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) {
      return c.json({ error: 'Colore non valido (usa formato hex, es. #3b82f6)' }, 400)
    }
    const chiave = label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || 'STATO'
    try {
      const stato = await c.get('prisma').statoContrattoConfig.create({
        data: {
          chiave,
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isChiuso: isChiuso ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') {
        return c.json({ error: `Esiste già uno stato con chiave "${chiave}"` }, 409)
      }
      console.error('[stati-contratto] POST error:', err)
      return c.json({ error: 'Errore nella creazione dello stato' }, 500)
    }
  })

  hono.put('/api/stati-contratto/:id', requireAuth(), requireRole('BOARD'), async (c) => {
    const id = c.req.param('id')
    const { label, colore, isChiuso, ordine } = await readJSON<{
      label?: string; colore?: string; isChiuso?: boolean; ordine?: number
    }>(c)
    if (!label?.trim()) return c.json({ error: 'label è obbligatorio' }, 400)
    if (colore && !COLOR_RE.test(colore)) return c.json({ error: 'Colore non valido' }, 400)
    try {
      const stato = await c.get('prisma').statoContrattoConfig.update({
        where: { id },
        data: {
          label: label.trim(),
          colore: colore?.trim() ?? '#94a3b8',
          isChiuso: isChiuso ?? false,
          ordine: ordine ?? 99,
        },
      })
      return c.json(stato)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Stato non trovato' }, 404)
      console.error('[stati-contratto] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dello stato' }, 500)
    }
  })

  hono.delete('/api/stati-contratto/:id', requireAuth(), requireRole('BOARD'), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    try {
      const stato = await prisma.statoContrattoConfig.findUnique({ where: { id } })
      if (!stato) return c.json({ error: 'Stato non trovato' }, 404)
      const inUso = await prisma.contratto.count({ where: { stato: stato.chiave } })
      if (inUso > 0) {
        return c.json({ error: `Stato in uso da ${inUso} contratti — riassegna prima i contratti` }, 409)
      }
      await prisma.statoContrattoConfig.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      console.error('[stati-contratto] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione dello stato' }, 500)
    }
  })

  // ── Config contratti: costo medio giornata risorsa ──────────
  // Usato per il confronto economico dei contratti (consuntivato ×
  // costo medio vs budget ordini). GET per chi vede la pagina Contratti,
  // PUT solo Board (Impostazioni).

  const COSTO_MEDIO_KEY = 'costo_medio_giornata'

  const readCostoMedio = async (prisma: PrismaClient): Promise<number | null> => {
    const row = await prisma.appConfig.findUnique({ where: { chiave: COSTO_MEDIO_KEY } })
    const n = row ? Number(row.valore) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }

  hono.get('/api/config/contratti', requireAuth(), requireRole(...CONTRATTO_ROLES), async (c) => {
    return c.json({ costoMedioGiornata: await readCostoMedio(c.get('prisma')) })
  })

  hono.put('/api/config/contratti', requireAuth(), requireRole('BOARD'), async (c) => {
    const { costoMedioGiornata } = await readJSON<{ costoMedioGiornata?: unknown }>(c)
    const valid = costoMedioGiornata === null ||
      (typeof costoMedioGiornata === 'number' && Number.isFinite(costoMedioGiornata) && costoMedioGiornata >= 0)
    if (!valid) {
      return c.json({ error: 'costoMedioGiornata deve essere un numero ≥ 0, o null per disattivare' }, 400)
    }
    const prisma = c.get('prisma')
    const valore = costoMedioGiornata ? String(costoMedioGiornata) : ''
    await prisma.appConfig.upsert({
      where: { chiave: COSTO_MEDIO_KEY },
      create: { chiave: COSTO_MEDIO_KEY, valore },
      update: { valore },
    })
    return c.json({ costoMedioGiornata: await readCostoMedio(prisma) })
  })

  // ── Zoho Projects: import consuntivazioni (solo Board) ──────────────
  // Selezione dei progetti da importare + preview della diff. La conferma
  // riusa PATCH /api/attivita/bulk-consuntivato. Il download dei consuntivi
  // è per-progetto: il frontend itera sui progetti selezionati (rate limit
  // Zoho + limiti subrequest Workers — vedi zohoService.ts).

  const ZOHO_SELECTION_KEY = 'zoho_selected_projects'

  hono.get('/api/zoho/projects', requireAuth(), requireRole('BOARD', 'PM', 'ACCOUNT'), async (c) => {
    const cfg = c.get('config').zoho
    if (!cfg) return c.json({ error: 'Integrazione Zoho non configurata (variabili ZOHO_* mancanti)' }, 503)
    try {
      const [projects, row] = await Promise.all([
        listZohoProjects(cfg),
        c.get('prisma').appConfig.findUnique({ where: { chiave: ZOHO_SELECTION_KEY } }),
      ])
      let selected = new Set<string>()
      try {
        const parsed: unknown = row ? JSON.parse(row.valore) : []
        if (Array.isArray(parsed)) selected = new Set(parsed.filter((x): x is string => typeof x === 'string'))
      } catch { /* valore corrotto: nessuna selezione */ }
      return c.json({ projects: projects.map((p) => ({ ...p, selected: selected.has(p.id) })) })
    } catch (err) {
      console.error('[zoho] GET projects error:', err)
      return c.json({ error: 'Errore nel recupero dei progetti da Zoho' }, 502)
    }
  })

  hono.put('/api/zoho/selection', requireAuth(), requireRole('BOARD', 'PM', 'ACCOUNT'), async (c) => {
    const { selectedIds } = await readJSON<{ selectedIds?: unknown }>(c)
    if (!Array.isArray(selectedIds) || selectedIds.some((x) => typeof x !== 'string')) {
      return c.json({ error: 'selectedIds deve essere un array di id progetto' }, 400)
    }
    const ids = [...new Set(selectedIds as string[])]
    const valore = JSON.stringify(ids)
    await c.get('prisma').appConfig.upsert({
      where: { chiave: ZOHO_SELECTION_KEY },
      create: { chiave: ZOHO_SELECTION_KEY, valore },
      update: { valore },
    })
    return c.json({ selectedIds: ids })
  })

  // Consuntivi di UN progetto Zoho: {codes: [{code, ore}], mesiScansionati}
  hono.post('/api/zoho/consuntivi/:projectId', requireAuth(), requireRole('BOARD', 'PM', 'ACCOUNT'), async (c) => {
    const cfg = c.get('config').zoho
    if (!cfg) return c.json({ error: 'Integrazione Zoho non configurata (variabili ZOHO_* mancanti)' }, 503)
    try {
      return c.json(await fetchConsuntiviProgetto(cfg, c.req.param('projectId')))
    } catch (err) {
      console.error('[zoho] consuntivi error:', err)
      return c.json({ error: 'Errore nel recupero dei consuntivi da Zoho' }, 502)
    }
  })

  // Normalizza un riferimento ordine di vendita per il matching: senza
  // prefisso GO-ORDV, maiuscolo. Le attività lo salvano già senza prefisso;
  // sui contratti può essere stato incollato per intero.
  const normOrdineVendita = (s: string): string =>
    s.trim().toUpperCase().replace(/^GO-ORDV-/, '')

  // Diff tra i codici aggregati (sommati dal frontend su tutti i progetti
  // selezionati) e attività + contratti: stesso matching dell'import CSV
  // manuale (riferimentoOrdineVendita = codice senza prefisso "GO-ORDV-").
  // Un codice può corrispondere sia a un'attività sia a un contratto; finisce
  // in notFound solo se non corrisponde a nessuno dei due.
  hono.post('/api/zoho/import/preview', requireAuth(), requireRole('BOARD', 'PM', 'ACCOUNT'), async (c) => {
    const { codes } = await readJSON<{
      codes?: Array<{ code?: unknown; ore?: unknown; mesi?: Array<{ mese?: unknown; ore?: unknown }> }>
    }>(c)
    if (!Array.isArray(codes)) {
      return c.json({ error: 'codes deve essere un array di {code, ore, mesi}' }, 400)
    }
    const prisma = c.get('prisma')
    const [attivita, contrattiConOrdine] = await Promise.all([
      prisma.attivita.findMany({ where: { riferimentoOrdineVendita: { not: null } } }),
      prisma.contratto.findMany({
        where: { riferimentoOrdineVendita: { not: null } },
        include: { cliente: { select: { nome: true } } },
      }),
    ])
    const byOrdine = new Map(attivita.map((a) => [a.riferimentoOrdineVendita!.trim(), a]))
    const contrattiByOrdine = new Map(contrattiConOrdine.map((k) => [normOrdineVendita(k.riferimentoOrdineVendita!), k]))

    const matched: Array<{
      attivitaId: string; cliente: string; progetto: string; attivita: string
      codice: string; ore: number; attuale: number | null; nuovo: number
      mesi: Array<{ mese: string; gg: number }>
    }> = []
    const matchedContratti: Array<{
      contrattoId: string; cliente: string; titolo: string; anno: number
      codice: string; ore: number; attuale: number | null; nuovo: number
    }> = []
    const notFound: string[] = []

    for (const item of codes) {
      const code = typeof item?.code === 'string' ? item.code.trim() : ''
      const ore = typeof item?.ore === 'number' && isFinite(item.ore) && item.ore >= 0 ? item.ore : null
      if (!GO_CODE_RE.test(code) || ore === null) continue
      const a = byOrdine.get(code.replace('GO-ORDV-', ''))
      const ct = contrattiByOrdine.get(normOrdineVendita(code))
      if (!a && !ct) { notFound.push(code); continue }
      const nuovo = Math.round((ore / 8) * 100) / 100
      if (a) {
        // Breakdown mensile (stessa conversione ore→gg del totale): righe malformate scartate
        const mesi = (Array.isArray(item.mesi) ? item.mesi : [])
          .filter((m): m is { mese: string; ore: number } =>
            typeof m?.mese === 'string' && MESE_RE.test(m.mese) &&
            typeof m?.ore === 'number' && isFinite(m.ore) && m.ore >= 0)
          .map((m) => ({ mese: m.mese, gg: Math.round((m.ore / 8) * 100) / 100 }))
          .sort((x, y) => x.mese.localeCompare(y.mese))
        matched.push({
          attivitaId: a.id,
          cliente: a.cliente,
          progetto: a.progetto,
          attivita: a.attivita,
          codice: code,
          ore,
          attuale: a.giornateConsuntivate === null ? null : toNumber(a.giornateConsuntivate),
          nuovo,
          mesi,
        })
      }
      if (ct) {
        matchedContratti.push({
          contrattoId: ct.id,
          cliente: ct.cliente.nome,
          titolo: ct.titolo,
          anno: ct.anno,
          codice: code,
          ore,
          attuale: ct.giornateConsuntivate === null ? null : toNumber(ct.giornateConsuntivate),
          nuovo,
        })
      }
    }
    matched.sort((x, y) => x.codice.localeCompare(y.codice))
    matchedContratti.sort((x, y) => x.codice.localeCompare(y.codice))
    notFound.sort()
    return c.json({ matched, matchedContratti, notFound })
  })

  // ── Storico sessioni di import Zoho ──
  // Ogni conferma di import registra una ZohoImportSession con i delta
  // effettivamente applicati (righe con prima ≠ dopo); lo storico è tenuto
  // per gli ultimi 5 giorni e le sessioni più vecchie vengono eliminate a
  // ogni lettura/scrittura.

  const ZOHO_SESSION_RETENTION_MS = 5 * 24 * 60 * 60 * 1000

  const pruneZohoSessions = (prisma: PrismaClient) =>
    prisma.zohoImportSession.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - ZOHO_SESSION_RETENTION_MS) } },
    })

  // Conferma dell'import Zoho: applica gli aggiornamenti (stessa semantica di
  // PATCH /api/attivita/bulk-consuntivato) e registra la sessione con i delta.
  // I valori "prima" vengono riletti dal DB, non fidandosi del payload.
  // `contratti` è la controparte per i contratti assistenza/AMS agganciati
  // per ordine di vendita (solo totale, nessun breakdown mensile).
  hono.post('/api/zoho/import/confirm', requireAuth(), requireRole('BOARD', 'PM', 'ACCOUNT'), async (c) => {
    const { updates, contratti } = await readJSON<{
      updates?: Array<{
        id?: unknown; giornateConsuntivate?: unknown
        mesi?: Array<{ mese?: unknown; giornateConsuntivate?: unknown }>
      }>
      contratti?: Array<{ id?: unknown; giornateConsuntivate?: unknown }>
    }>(c)
    const updatesArr = Array.isArray(updates) ? updates : []
    const contrattiArr = Array.isArray(contratti) ? contratti : []
    if (updatesArr.length === 0 && contrattiArr.length === 0) {
      return c.json({ error: 'Serve almeno un update (attività o contratti)' }, 400)
    }
    const clean: Array<{
      id: string; giornateConsuntivate: number
      mesi: Array<{ mese: string; giornateConsuntivate: number }>
    }> = []
    for (const u of updatesArr) {
      if (typeof u?.id !== 'string' || typeof u?.giornateConsuntivate !== 'number' || !isFinite(u.giornateConsuntivate) || u.giornateConsuntivate < 0) {
        return c.json({ error: 'Ogni update richiede id e giornateConsuntivate ≥ 0' }, 400)
      }
      const mesi = (Array.isArray(u.mesi) ? u.mesi : [])
        .filter((m): m is { mese: string; giornateConsuntivate: number } =>
          typeof m?.mese === 'string' && MESE_RE.test(m.mese) &&
          typeof m?.giornateConsuntivate === 'number' && isFinite(m.giornateConsuntivate) && m.giornateConsuntivate >= 0)
      clean.push({ id: u.id, giornateConsuntivate: u.giornateConsuntivate, mesi })
    }
    const cleanContratti: Array<{ id: string; giornateConsuntivate: number }> = []
    for (const u of contrattiArr) {
      if (typeof u?.id !== 'string' || typeof u?.giornateConsuntivate !== 'number' || !isFinite(u.giornateConsuntivate) || u.giornateConsuntivate < 0) {
        return c.json({ error: 'Ogni contratto richiede id e giornateConsuntivate ≥ 0' }, 400)
      }
      cleanContratti.push({ id: u.id, giornateConsuntivate: u.giornateConsuntivate })
    }

    const prisma = c.get('prisma')
    const [attuali, contrattiAttuali] = await Promise.all([
      prisma.attivita.findMany({ where: { id: { in: clean.map((u) => u.id) } } }),
      prisma.contratto.findMany({
        where: { id: { in: cleanContratti.map((u) => u.id) } },
        include: { cliente: { select: { nome: true } } },
      }),
    ])
    if (attuali.length !== clean.length) return c.json({ error: 'Una o più attività non trovate' }, 404)
    if (contrattiAttuali.length !== cleanContratti.length) return c.json({ error: 'Uno o più contratti non trovati' }, 404)
    const byId = new Map(attuali.map((a) => [a.id, a]))
    const contrattiById = new Map(contrattiAttuali.map((k) => [k.id, k]))

    try {
      await Promise.all(
        clean.map(({ id, giornateConsuntivate }) =>
          prisma.attivita.update({ where: { id }, data: { giornateConsuntivate } })
        )
      )
      // Breakdown mensile: upsert per (attività, mese) — aggiorna le
      // consuntivate del mese preservando le fatturate già compilate dal PM.
      // I mesi presenti a DB ma assenti dall'import restano invariati.
      await Promise.all(
        clean.flatMap(({ id, mesi }) =>
          mesi.map((m) =>
            prisma.attivitaConsuntivoMese.upsert({
              where: { attivitaId_mese: { attivitaId: id, mese: m.mese } },
              create: { attivitaId: id, mese: m.mese, giornateConsuntivate: m.giornateConsuntivate },
              update: { giornateConsuntivate: m.giornateConsuntivate },
            })
          )
        )
      )
      await Promise.all(
        cleanContratti.map(({ id, giornateConsuntivate }) =>
          prisma.contratto.update({ where: { id }, data: { giornateConsuntivate } })
        )
      )
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Una o più attività o contratti non trovati' }, 404)
      return c.json({ error: 'Errore aggiornamento consuntivato' }, 500)
    }

    // Solo le righe il cui valore è effettivamente cambiato entrano nella
    // sessione (delta ≠ 0); prima = null → trattato come 0. Le righe dei
    // contratti hanno la stessa forma di quelle attività (contrattoId al
    // posto di attivitaId) così lo storico le rende senza casi speciali.
    const righe = clean.flatMap(({ id, giornateConsuntivate }) => {
      const a = byId.get(id)!
      const prima = a.giornateConsuntivate === null ? null : toNumber(a.giornateConsuntivate)
      const delta = Math.round((giornateConsuntivate - (prima ?? 0)) * 100) / 100
      if (delta === 0) return []
      return [{
        attivitaId: id,
        cliente: a.cliente,
        progetto: a.progetto,
        attivita: a.attivita,
        codice: a.riferimentoOrdineVendita ? `GO-ORDV-${a.riferimentoOrdineVendita.trim()}` : null,
        prima,
        dopo: giornateConsuntivate,
        delta,
      }]
    })
    const righeContratti = cleanContratti.flatMap(({ id, giornateConsuntivate }) => {
      const k = contrattiById.get(id)!
      const prima = k.giornateConsuntivate === null ? null : toNumber(k.giornateConsuntivate)
      const delta = Math.round((giornateConsuntivate - (prima ?? 0)) * 100) / 100
      if (delta === 0) return []
      return [{
        contrattoId: id,
        cliente: k.cliente.nome,
        progetto: 'Contratto assistenza/AMS',
        attivita: k.titolo,
        codice: k.riferimentoOrdineVendita ? `GO-ORDV-${normOrdineVendita(k.riferimentoOrdineVendita)}` : null,
        prima,
        dopo: giornateConsuntivate,
        delta,
      }]
    })

    const session = await prisma.zohoImportSession.create({
      data: { userId: c.get('currentUserId'), righe: [...righe, ...righeContratti] },
    })
    await pruneZohoSessions(prisma)
    return c.json({
      updated: clean.length,
      updatedContratti: cleanContratti.length,
      sessionId: session.id,
      modificate: righe.length + righeContratti.length,
    })
  })

  // Sessioni di import degli ultimi 5 giorni, più recenti prima.
  hono.get('/api/zoho/import/sessions', requireAuth(), requireRole('BOARD', 'PM', 'ACCOUNT'), async (c) => {
    const prisma = c.get('prisma')
    await pruneZohoSessions(prisma)
    const rows = await prisma.zohoImportSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, firstName: true, lastName: true, email: true } } },
    })
    return c.json({
      sessions: rows.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        utente: s.user
          ? ([s.user.firstName, s.user.lastName].filter(Boolean).join(' ') || s.user.name || s.user.email)
          : null,
        righe: s.righe,
      })),
    })
  })

  // PATCH /api/attivita/bulk-consuntivato — aggiornamento massivo giornateConsuntivate
  hono.patch('/api/attivita/bulk-consuntivato', requireAuth(), async (c) => {
    const { updates } = await readJSON<{ updates: Array<{ id: string; giornateConsuntivate: number }> }>(c)
    if (!Array.isArray(updates) || updates.length === 0) {
      return c.json({ error: 'updates deve essere un array non vuoto' }, 400)
    }
    try {
      const prisma = c.get('prisma')
      await Promise.all(
        updates.map(({ id, giornateConsuntivate }) =>
          prisma.attivita.update({ where: { id }, data: { giornateConsuntivate } })
        )
      )
      return c.json({ updated: updates.length })
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Una o più attività non trovate' }, 404)
      return c.json({ error: 'Errore aggiornamento consuntivato' }, 500)
    }
  })

  // PUT /api/attivita/:id/fatturato-mensile — compilazione del rapportino PM
  // sugli ordini bucket: giornate fatturate per mese. Upsert delle righe mese
  // indicate (senza toccare le consuntivate, che arrivano dall'import Zoho) e
  // riallineamento del totale giornateFatturate sull'attività alla somma dei
  // mesi — per i bucket il totale non si edita più a mano ma è derivato.
  hono.put('/api/attivita/:id/fatturato-mensile', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { mesi } = await readJSON<{ mesi?: Array<{ mese?: unknown; giornateFatturate?: unknown }> }>(c)
    if (!Array.isArray(mesi) || mesi.length === 0) {
      return c.json({ error: 'mesi deve essere un array non vuoto di {mese, giornateFatturate}' }, 400)
    }
    const clean: Array<{ mese: string; giornateFatturate: number | null }> = []
    for (const m of mesi) {
      const meseOk = typeof m?.mese === 'string' && MESE_RE.test(m.mese)
      const ggOk = m?.giornateFatturate === null ||
        (typeof m?.giornateFatturate === 'number' && isFinite(m.giornateFatturate) && m.giornateFatturate >= 0)
      if (!meseOk || !ggOk) {
        return c.json({ error: 'Ogni riga richiede mese "YYYY-MM" e giornateFatturate ≥ 0 (o null)' }, 400)
      }
      clean.push({ mese: m.mese as string, giornateFatturate: m.giornateFatturate as number | null })
    }

    const prisma = c.get('prisma')
    const att = await prisma.attivita.findUnique({ where: { id } })
    if (!att) return c.json({ error: 'Attività non trovata' }, 404)

    await Promise.all(
      clean.map((m) =>
        prisma.attivitaConsuntivoMese.upsert({
          where: { attivitaId_mese: { attivitaId: id, mese: m.mese } },
          create: { attivitaId: id, mese: m.mese, giornateFatturate: m.giornateFatturate },
          update: { giornateFatturate: m.giornateFatturate },
        })
      )
    )

    // Totale = somma dei mesi valorizzati; null se nessun mese è compilato
    const righe = await prisma.attivitaConsuntivoMese.findMany({
      where: { attivitaId: id },
      orderBy: { mese: 'asc' },
    })
    const valorizzate = righe.filter((r) => r.giornateFatturate !== null)
    const totale = valorizzate.length > 0
      ? Math.round(valorizzate.reduce((s, r) => s + toNumber(r.giornateFatturate), 0) * 100) / 100
      : null
    await prisma.attivita.update({ where: { id }, data: { giornateFatturate: totale } })

    return c.json({
      giornateFatturate: totale,
      consuntiviMese: righe.map((r) => ({
        mese: r.mese,
        giornateConsuntivate: r.giornateConsuntivate !== null ? toNumber(r.giornateConsuntivate) : null,
        giornateFatturate: r.giornateFatturate !== null ? toNumber(r.giornateFatturate) : null,
      })),
    })
  })

  // ── Gantt Milestones ────────────────────────────────────────

  hono.get('/api/gantt/milestones', requireAuth(), async (c) => {
    const activityId = c.req.query('activityId')
    const rows = await c.get('prisma').ganttMilestone.findMany({
      where: activityId ? { activityId } : undefined,
      orderBy: { date: 'asc' },
    })
    return c.json(rows)
  })

  hono.post('/api/gantt/milestones', requireAuth(), async (c) => {
    const { activityId, title, date, color, icon } = await readJSON<{
      activityId?: string; title?: string; date?: string; color?: string; icon?: string
    }>(c)
    if (!activityId?.trim() || !title?.trim() || !date) {
      return c.json({ error: 'activityId, title e date sono obbligatori' }, 400)
    }
    const row = await c.get('prisma').ganttMilestone.create({
      data: {
        activityId: activityId.trim(),
        title: title.trim(),
        date: new Date(date),
        color: color?.trim() || '#F59E0B',
        icon: icon?.trim() || null,
      },
    })
    return c.json(row, 201)
  })

  hono.put('/api/gantt/milestones/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { title, date, color, icon } = await readJSON<{
      title?: string; date?: string; color?: string; icon?: string
    }>(c)
    try {
      const row = await c.get('prisma').ganttMilestone.update({
        where: { id },
        data: {
          title: title?.trim(),
          date: date ? new Date(date) : undefined,
          color: color?.trim(),
          icon: icon !== undefined ? (icon?.trim() || null) : undefined,
        },
      })
      return c.json(row)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Milestone non trovata' }, 404)
      return c.json({ error: 'Errore aggiornamento milestone' }, 500)
    }
  })

  hono.delete('/api/gantt/milestones/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').ganttMilestone.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Milestone non trovata' }, 404)
      return c.json({ error: 'Errore cancellazione milestone' }, 500)
    }
  })

  // ── Import CSV ──────────────────────────────────────────────

  hono.post('/api/import/csv', requireAuth(), async (c) => {
    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return c.json({ error: 'File mancante' }, 400)
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await importCSV(buffer, c.get('prisma'))
      return c.json({ success: true, result })
    } catch (err) {
      console.error('[import] error:', err)
      return c.json({ error: 'Errore import', detail: String(err) }, 422)
    }
  })

}

export function createApp(): Hono<Env> {
  return new Hono<Env>()
}
