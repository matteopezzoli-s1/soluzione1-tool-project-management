import { Hono, type MiddlewareHandler } from 'hono'
import type { PrismaClient } from '@prisma/client'
import {
  buildGoogleAuthURL,
  fetchGoogleProfile,
  signJWT,
  verifyJWT,
} from './auth'
import { importCSV } from './services/importService'

export interface AppConfig {
  googleClientId: string
  googleClientSecret: string
  jwtSecret: string
  frontendUrl: string
  callbackUrl: string
  isProd: boolean
}

export interface Vars {
  prisma: PrismaClient
  config: AppConfig
}

export type Env = { Variables: Vars }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/

function toNumber(d: unknown): number {
  if (d === null || d === undefined) return 0
  return typeof d === 'object' && 'toNumber' in (d as object)
    ? (d as { toNumber(): number }).toNumber()
    : Number(d)
}

async function readJSON<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T
}

function requireAuth(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Token mancante' }, 401)
    }
    try {
      verifyJWT(header.slice(7), c.get('config').jwtSecret)
      await next()
    } catch {
      return c.json({ error: 'Token non valido o scaduto' }, 401)
    }
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
      const token = signJWT({
        sub: profile.id,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      }, jwtSecret)
      return c.redirect(`${frontendUrl}?token=${token}`)
    } catch (err) {
      console.error('[auth] OAuth error:', err)
      return c.redirect(`${frontendUrl}?auth_error=oauth_failed`)
    }
  })

  // ── Auth: verifica token ────────────────────────────────────
  hono.get('/auth/me', (c) => {
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Token mancante' }, 401)
    }
    try {
      const payload = verifyJWT(header.slice(7), c.get('config').jwtSecret)
      return c.json({ user: payload })
    } catch {
      return c.json({ error: 'Token non valido o scaduto' }, 401)
    }
  })

  // ── PM CRUD ─────────────────────────────────────────────────

  hono.get('/pm', requireAuth(), async (c) => {
    try {
      const pms = await c.get('prisma').projectManager.findMany({
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })
      return c.json(pms)
    } catch (err) {
      console.error('[pm] GET error:', err)
      return c.json({ error: 'Errore nel recupero dei PM' }, 500)
    }
  })

  hono.post('/pm', requireAuth(), async (c) => {
    const { firstName, lastName, email } = await readJSON<{ firstName?: string; lastName?: string; email?: string }>(c)

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return c.json({ error: 'firstName, lastName ed email sono obbligatori' }, 400)
    }
    if (!EMAIL_RE.test(email.trim())) {
      return c.json({ error: 'Email non valida' }, 400)
    }

    try {
      const pm = await c.get('prisma').projectManager.create({
        data: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase() },
      })
      return c.json(pm, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') {
        return c.json({ error: 'Email già presente' }, 409)
      }
      console.error('[pm] POST error:', err)
      return c.json({ error: 'Errore nella creazione del PM' }, 500)
    }
  })

  hono.put('/pm/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { firstName, lastName, email } = await readJSON<{ firstName?: string; lastName?: string; email?: string }>(c)

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return c.json({ error: 'firstName, lastName ed email sono obbligatori' }, 400)
    }
    if (!EMAIL_RE.test(email.trim())) {
      return c.json({ error: 'Email non valida' }, 400)
    }

    try {
      const pm = await c.get('prisma').projectManager.update({
        where: { id },
        data: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase() },
      })
      return c.json(pm)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'PM non trovato' }, 404)
      if ((err as { code?: string }).code === 'P2002') return c.json({ error: 'Email già presente' }, 409)
      console.error('[pm] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento del PM' }, 500)
    }
  })

  hono.delete('/pm/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').projectManager.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'PM non trovato' }, 404)
      console.error('[pm] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione del PM' }, 500)
    }
  })

  // ── Account CRUD ────────────────────────────────────────────

  hono.get('/accounts', requireAuth(), async (c) => {
    try {
      const accounts = await c.get('prisma').account.findMany({
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })
      return c.json(accounts)
    } catch (err) {
      console.error('[accounts] GET error:', err)
      return c.json({ error: 'Errore nel recupero degli account' }, 500)
    }
  })

  hono.post('/accounts', requireAuth(), async (c) => {
    const { firstName, lastName, email } = await readJSON<{ firstName?: string; lastName?: string; email?: string }>(c)

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return c.json({ error: 'firstName, lastName ed email sono obbligatori' }, 400)
    }
    if (!EMAIL_RE.test(email.trim())) {
      return c.json({ error: 'Email non valida' }, 400)
    }

    try {
      const account = await c.get('prisma').account.create({
        data: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase() },
      })
      return c.json(account, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2002') return c.json({ error: 'Email già presente' }, 409)
      console.error('[accounts] POST error:', err)
      return c.json({ error: 'Errore nella creazione dell\'account' }, 500)
    }
  })

  hono.put('/accounts/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { firstName, lastName, email } = await readJSON<{ firstName?: string; lastName?: string; email?: string }>(c)

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return c.json({ error: 'firstName, lastName ed email sono obbligatori' }, 400)
    }
    if (!EMAIL_RE.test(email.trim())) {
      return c.json({ error: 'Email non valida' }, 400)
    }

    try {
      const account = await c.get('prisma').account.update({
        where: { id },
        data: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase() },
      })
      return c.json(account)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Account non trovato' }, 404)
      if ((err as { code?: string }).code === 'P2002') return c.json({ error: 'Email già presente' }, 409)
      console.error('[accounts] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dell\'account' }, 500)
    }
  })

  hono.delete('/accounts/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    try {
      await c.get('prisma').account.delete({ where: { id } })
      return c.body(null, 204)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Account non trovato' }, 404)
      console.error('[accounts] DELETE error:', err)
      return c.json({ error: 'Errore nella cancellazione dell\'account' }, 500)
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
        },
      })
      return c.json(progetti)
    } catch (err) {
      console.error('[progetti] GET error:', err)
      return c.json({ error: 'Errore nel recupero dei progetti' }, 500)
    }
  })

  hono.post('/progetti', requireAuth(), async (c) => {
    const { nome, descrizione, tipo, stato, colore, clienteId, poId, dataInizio, dataFine } = await readJSON<{
      nome?: string; descrizione?: string; tipo?: string; stato?: string; colore?: string
      clienteId?: string; poId?: string; dataInizio?: string; dataFine?: string
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
          dataInizio: dataInizio ? new Date(dataInizio) : null,
          dataFine: dataFine ? new Date(dataFine) : null,
        },
        include: {
          cliente: { select: { id: true, nome: true } },
          po: { select: { id: true, firstName: true, lastName: true } },
        },
      })
      return c.json(progetto, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2003') return c.json({ error: 'Cliente o PO non trovato' }, 400)
      console.error('[progetti] POST error:', err)
      return c.json({ error: 'Errore nella creazione del progetto' }, 500)
    }
  })

  hono.put('/progetti/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { nome, descrizione, tipo, stato, colore, clienteId, poId, dataInizio, dataFine } = await readJSON<{
      nome?: string; descrizione?: string; tipo?: string; stato?: string; colore?: string
      clienteId?: string; poId?: string; dataInizio?: string; dataFine?: string
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
          dataInizio: dataInizio ? new Date(dataInizio) : null,
          dataFine: dataFine ? new Date(dataFine) : null,
        },
        include: {
          cliente: { select: { id: true, nome: true } },
          po: { select: { id: true, firstName: true, lastName: true } },
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
    const { label, colore, isArchiviato, escludiDaConteggio, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; escludiDaConteggio?: boolean; ordine?: number
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
    const { label, colore, isArchiviato, escludiDaConteggio, ordine } = await readJSON<{
      label?: string; colore?: string; isArchiviato?: boolean; escludiDaConteggio?: boolean; ordine?: number
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

  // ── Roadmap Items CRUD ──────────────────────────────────────

  hono.get('/api/roadmap-items', requireAuth(), async (c) => {
    try {
      const progettoId = c.req.query('progettoId')
      const anno = c.req.query('anno')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = {}
      if (progettoId?.trim()) where['progettoId'] = progettoId.trim()
      if (anno?.trim()) where['anno'] = parseInt(anno, 10)
      const items = await c.get('prisma').roadmapItem.findMany({
        where,
        orderBy: [{ anno: 'asc' }, { quarter: 'asc' }, { ordine: 'asc' }],
        include: { progetto: { select: { id: true, nome: true, colore: true, poId: true } } },
      })
      return c.json(items)
    } catch (err) {
      console.error('[roadmap-items] GET error:', err)
      return c.json({ error: 'Errore nel recupero delle attività roadmap' }, 500)
    }
  })

  hono.post('/api/roadmap-items', requireAuth(), async (c) => {
    const { progettoId, anno, quarter, dataDeadline, titolo, descrizione, stato, analisiUrl, stimaGg, ordine } = await readJSON<{
      progettoId?: string; anno?: number; quarter?: string | null; dataDeadline?: string | null
      titolo?: string; descrizione?: string; stato?: string; analisiUrl?: string
      stimaGg?: number | null; ordine?: number
    }>(c)
    if (!progettoId?.trim()) return c.json({ error: 'progettoId è obbligatorio' }, 400)
    if (!titolo?.trim()) return c.json({ error: 'Il titolo è obbligatorio' }, 400)
    if (!anno) return c.json({ error: 'L\'anno è obbligatorio' }, 400)
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
        },
        include: { progetto: { select: { id: true, nome: true, colore: true, poId: true } } },
      })
      return c.json(item, 201)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2003') return c.json({ error: 'Prodotto non trovato' }, 400)
      console.error('[roadmap-items] POST error:', err)
      return c.json({ error: 'Errore nella creazione dell\'attività roadmap' }, 500)
    }
  })

  hono.put('/api/roadmap-items/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { progettoId, anno, quarter, dataDeadline, titolo, descrizione, stato, analisiUrl, stimaGg, ordine } = await readJSON<{
      progettoId?: string; anno?: number; quarter?: string | null; dataDeadline?: string | null
      titolo?: string; descrizione?: string; stato?: string; analisiUrl?: string
      stimaGg?: number | null; ordine?: number
    }>(c)
    if (!titolo?.trim()) return c.json({ error: 'Il titolo è obbligatorio' }, 400)
    if (!anno) return c.json({ error: 'L\'anno è obbligatorio' }, 400)
    const prisma = c.get('prisma')
    const statoVal = stato?.trim() ?? 'DA_FARE'
    const statiValidi = await prisma.statoRoadmapConfig.findMany({ select: { chiave: true } })
    if (statiValidi.length > 0 && !statiValidi.some(s => s.chiave === statoVal)) {
      return c.json({ error: 'Stato non valido' }, 400)
    }
    try {
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
        include: { progetto: { select: { id: true, nome: true, colore: true, poId: true } } },
      })
      return c.json(item)
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') return c.json({ error: 'Attività roadmap non trovata' }, 404)
      console.error('[roadmap-items] PUT error:', err)
      return c.json({ error: 'Errore nell\'aggiornamento dell\'attività roadmap' }, 500)
    }
  })

  // PATCH /api/roadmap-items/:id/posizione — usato dal drag&drop (Lista e Kanban)
  hono.patch('/api/roadmap-items/:id/posizione', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const { ordine, anno, quarter } = await readJSON<{
      ordine?: number; anno?: number; quarter?: string | null
    }>(c)
    try {
      const item = await c.get('prisma').roadmapItem.update({
        where: { id },
        data: {
          ordine: ordine ?? undefined,
          anno: anno ?? undefined,
          quarter: quarter !== undefined ? (quarter?.trim() || null) : undefined,
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

  // ── Attività CRUD ───────────────────────────────────────────

  // GET /api/attivita — lista raggruppata per cliente+progetto
  hono.get('/api/attivita', requireAuth(), async (c) => {
    try {
      const prisma = c.get('prisma')
      const stato = c.req.query('stato')
      const soloAttivi = c.req.query('soloAttivi')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = {}

      const tuttiStati = await prisma.statoAttivitaConfig.findMany({
        select: { chiave: true, isArchiviato: true, escludiDaConteggio: true },
      })
      const escludiChiavi = new Set(tuttiStati.filter(s => s.escludiDaConteggio).map(s => s.chiave))

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

      const rows = await prisma.attivita.findMany({
        where,
        orderBy: [{ cliente: 'asc' }, { progetto: 'asc' }, { attivita: 'asc' }],
        include: {
          clienteRel: { select: { id: true, nome: true, accountId: true, account: { select: { id: true, firstName: true, lastName: true } } } },
          progettoRel: { select: { id: true, nome: true } },
          pms: { include: { pm: { select: { id: true, firstName: true, lastName: true } } } },
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
          const pmName = row.pms.map(p => resolvedName(p.pm.firstName, p.pm.lastName)).join(', ')
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
          const pmNames = a.pms.map(p => resolvedName(p.pm.firstName, p.pm.lastName)).join(', ')
          return {
            id: a.id,
            cliente: clienteNome,
            clienteId: a.clienteId ?? null,
            progetto: progettoNome,
            progettoId: a.progettoId ?? null,
            account: accountName,
            accountId: a.clienteRel?.accountId ?? null,
            projectManager: pmNames,
            pmIds: a.pms.map(p => p.pmId),
            attivita: a.attivita,
            giornateVendute: a.giornateVendute !== null ? toNumber(a.giornateVendute) : null,
            giornateConsuntivate: a.giornateConsuntivate !== null ? toNumber(a.giornateConsuntivate) : null,
            riferimentoOrdineVendita: a.riferimentoOrdineVendita,
            stato: a.stato,
            inizio: a.inizio?.toISOString().split('T')[0] ?? null,
            deadline: a.deadline?.toISOString().split('T')[0] ?? null,
            note: a.note,
          }
        })

        const attivitaContabili = attivitaMapped.filter(a => !escludiChiavi.has(a.stato))
        const totaleVendute = attivitaContabili.reduce((s, a) => s + (a.giornateVendute ?? 0), 0)
        const totaleConsuntivate = attivitaContabili.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0)

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
          totaleConsuntivate: Math.round(totaleConsuntivate * 100) / 100,
          inSforamento,
          attivita: attivitaMapped,
        }
      })

      gruppi.sort((a, b) => a.cliente.localeCompare(b.cliente, 'it') || a.progetto.localeCompare(b.progetto, 'it'))

      const allAttivita = gruppi.flatMap(g => g.attivita)
      const allContabili = allAttivita.filter(a => !escludiChiavi.has(a.stato))
      const riepilogo = {
        totaleProgetti: gruppi.length,
        totaleAttivita: allAttivita.length,
        attivitaInSforamento: allContabili.filter(a =>
          (a.giornateConsuntivate ?? 0) > 0 &&
          (a.giornateVendute === null || (a.giornateConsuntivate ?? 0) > (a.giornateVendute ?? 0))
        ).length,
        attivitaInApprovazione: allAttivita.filter(a => escludiChiavi.has(a.stato)).length,
        totaleGiornateVendute: Math.round(allContabili.reduce((s, a) => s + (a.giornateVendute ?? 0), 0) * 100) / 100,
        totaleGiornateConsuntivate: Math.round(allContabili.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0) * 100) / 100,
      }

      return c.json({ gruppi, riepilogo })
    } catch (err) {
      console.error('[attivita] GET error:', err)
      return c.json({ error: 'Errore nel recupero delle attività' }, 500)
    }
  })

  // POST /api/attivita
  hono.post('/api/attivita', requireAuth(), async (c) => {
    const prisma = c.get('prisma')
    const {
      clienteId, progettoId, pmIds, attivita,
      giornateVendute, giornateConsuntivate, riferimentoOrdineVendita,
      stato, inizio, deadline, note,
    } = await readJSON<{
      clienteId?: string; progettoId?: string; pmIds?: string[]
      attivita?: string
      giornateVendute?: number | null; giornateConsuntivate?: number | null
      riferimentoOrdineVendita?: string; stato?: string
      inizio?: string | null; deadline?: string | null; note?: string
    }>(c)

    if (!clienteId?.trim() || !progettoId?.trim() || !attivita?.trim()) {
      return c.json({ error: 'cliente, progetto e attivita sono obbligatori' }, 400)
    }

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

    const statoVal = stato?.trim() ?? 'IN_CORSO'
    const statiValidi = await prisma.statoAttivitaConfig.findMany({ select: { chiave: true } })
    if (!statiValidi.some(s => s.chiave === statoVal)) {
      return c.json({ error: 'Stato non valido' }, 400)
    }

    try {
      const row = await prisma.attivita.create({
        data: {
          cliente: linkedCliente.nome,
          clienteId: clienteId.trim(),
          progetto: linkedProgetto.nome,
          progettoId: progettoId.trim(),
          accountId: linkedCliente.accountId ?? null,
          attivita: attivita.trim(),
          giornateVendute: giornateVendute != null ? giornateVendute : null,
          giornateConsuntivate: giornateConsuntivate != null ? giornateConsuntivate : null,
          riferimentoOrdineVendita: riferimentoOrdineVendita?.trim() || null,
          stato: statoVal,
          inizio: inizio ? new Date(inizio) : null,
          deadline: deadline ? new Date(deadline) : null,
          note: note?.trim() || null,
          pms: pmIds?.length ? { create: pmIds.map(pmId => ({ pmId })) } : undefined,
        },
      })
      return c.json(row, 201)
    } catch (err) {
      console.error('[attivita] POST error:', err)
      return c.json({ error: 'Errore nella creazione dell\'attività' }, 500)
    }
  })

  // PUT /api/attivita/:id
  hono.put('/api/attivita/:id', requireAuth(), async (c) => {
    const id = c.req.param('id')
    const prisma = c.get('prisma')
    const {
      clienteId, progettoId, pmIds, attivita,
      giornateVendute, giornateConsuntivate, riferimentoOrdineVendita,
      stato, inizio, deadline, note,
    } = await readJSON<{
      clienteId?: string; progettoId?: string; pmIds?: string[]
      attivita?: string
      giornateVendute?: number | null; giornateConsuntivate?: number | null
      riferimentoOrdineVendita?: string; stato?: string
      inizio?: string | null; deadline?: string | null; note?: string
    }>(c)

    if (!clienteId?.trim() || !progettoId?.trim() || !attivita?.trim()) {
      return c.json({ error: 'cliente, progetto e attivita sono obbligatori' }, 400)
    }

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

    const statoVal = stato?.trim() ?? 'IN_CORSO'
    const statiValidi = await prisma.statoAttivitaConfig.findMany({ select: { chiave: true } })
    if (!statiValidi.some(s => s.chiave === statoVal)) {
      return c.json({ error: 'Stato non valido' }, 400)
    }

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
          giornateConsuntivate: giornateConsuntivate != null ? giornateConsuntivate : null,
          riferimentoOrdineVendita: riferimentoOrdineVendita?.trim() || null,
          stato: statoVal,
          inizio: inizio ? new Date(inizio) : null,
          deadline: deadline ? new Date(deadline) : null,
          note: note?.trim() || null,
          pms: {
            deleteMany: {},
            ...(pmIds?.length ? { create: pmIds.map(pmId => ({ pmId })) } : {}),
          },
        },
      })
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
