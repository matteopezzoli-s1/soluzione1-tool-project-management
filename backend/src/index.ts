// v0.6.0 — import CSV
import express, { Request, Response, NextFunction } from 'express'
import cors    from 'cors'
import multer  from 'multer'
import { PrismaClient } from '@prisma/client'
import {
  buildGoogleAuthURL,
  fetchGoogleProfile,
  signJWT,
  verifyJWT,
} from './auth'
import { importCSV } from './services/importService'

const app    = express()
const prisma = new PrismaClient()
const PORT   = process.env.PORT || 8080
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// ── Env ───────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const JWT_SECRET           = process.env.JWT_SECRET           ?? 'dev-secret-change-me'
const FRONTEND_URL         = process.env.FRONTEND_URL         ?? 'http://localhost:5173'
const BACKEND_URL          = process.env.BACKEND_URL          ?? `http://localhost:${PORT}`
const CALLBACK_URL         = `${BACKEND_URL}/auth/google/callback`

// ── Middleware ────────────────────────────────────────────────
app.use(express.json())

const IS_PROD = process.env.NODE_ENV === 'production'

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (origin === FRONTEND_URL) return cb(null, true)
    if (!IS_PROD && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true)
    return cb(null, false)
  },
  credentials: true,
}))

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token mancante' })
    return
  }
  try {
    verifyJWT(header.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token non valido o scaduto' })
  }
}

// ── Health ────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.5.0' })
})

// ── Auth: Step 1 — redirect a Google ─────────────────────────
app.get('/auth/google', (_req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    res.status(500).json({ error: 'GOOGLE_CLIENT_ID non configurato' })
    return
  }
  const url = buildGoogleAuthURL(GOOGLE_CLIENT_ID, CALLBACK_URL)
  res.redirect(url)
})

// ── Auth: Step 2 — callback da Google ────────────────────────
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query as { code?: string; error?: string }

  if (error || !code) {
    console.warn('[auth] Google rifiutato o codice mancante:', error)
    res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(error ?? 'no_code')}`)
    return
  }

  try {
    const profile = await fetchGoogleProfile(
      code,
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      CALLBACK_URL,
    )

    console.log(`[auth] Login: ${profile.email}`)

    const token = signJWT({
      sub:     profile.id,
      email:   profile.email,
      name:    profile.name,
      picture: profile.picture,
    }, JWT_SECRET)

    res.redirect(`${FRONTEND_URL}?token=${token}`)
  } catch (err) {
    console.error('[auth] OAuth error:', err)
    res.redirect(`${FRONTEND_URL}?auth_error=oauth_failed`)
  }
})

// ── Auth: verifica token ──────────────────────────────────────
app.get('/auth/me', (req, res) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token mancante' })
    return
  }
  try {
    const payload = verifyJWT(header.slice(7), JWT_SECRET)
    res.json({ user: payload })
  } catch {
    res.status(401).json({ error: 'Token non valido o scaduto' })
  }
})

// ── PM CRUD ───────────────────────────────────────────────────

app.get('/pm', requireAuth, async (_req, res) => {
  try {
    const pms = await prisma.projectManager.findMany({
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })
    res.json(pms)
  } catch (err) {
    console.error('[pm] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero dei PM' })
  }
})

app.post('/pm', requireAuth, async (req, res) => {
  const { firstName, lastName, email } = req.body as {
    firstName?: string; lastName?: string; email?: string
  }

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'firstName, lastName ed email sono obbligatori' })
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Email non valida' })
    return
  }

  try {
    const pm = await prisma.projectManager.create({
      data: {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        email:     email.trim().toLowerCase(),
      },
    })
    res.status(201).json(pm)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'Email già presente' })
      return
    }
    console.error('[pm] POST error:', err)
    res.status(500).json({ error: 'Errore nella creazione del PM' })
  }
})

app.put('/pm/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { firstName, lastName, email } = req.body as {
    firstName?: string; lastName?: string; email?: string
  }

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'firstName, lastName ed email sono obbligatori' })
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Email non valida' })
    return
  }

  try {
    const pm = await prisma.projectManager.update({
      where: { id },
      data: {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        email:     email.trim().toLowerCase(),
      },
    })
    res.json(pm)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'PM non trovato' })
      return
    }
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'Email già presente' })
      return
    }
    console.error('[pm] PUT error:', err)
    res.status(500).json({ error: 'Errore nell\'aggiornamento del PM' })
  }
})

app.delete('/pm/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    await prisma.projectManager.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'PM non trovato' })
      return
    }
    console.error('[pm] DELETE error:', err)
    res.status(500).json({ error: 'Errore nella cancellazione del PM' })
  }
})

// ── Account CRUD ──────────────────────────────────────────────

app.get('/accounts', requireAuth, async (_req, res) => {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })
    res.json(accounts)
  } catch (err) {
    console.error('[accounts] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero degli account' })
  }
})

app.post('/accounts', requireAuth, async (req, res) => {
  const { firstName, lastName, email } = req.body as {
    firstName?: string; lastName?: string; email?: string
  }

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'firstName, lastName ed email sono obbligatori' })
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Email non valida' })
    return
  }

  try {
    const account = await prisma.account.create({
      data: {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        email:     email.trim().toLowerCase(),
      },
    })
    res.status(201).json(account)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'Email già presente' })
      return
    }
    console.error('[accounts] POST error:', err)
    res.status(500).json({ error: 'Errore nella creazione dell\'account' })
  }
})

app.put('/accounts/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { firstName, lastName, email } = req.body as {
    firstName?: string; lastName?: string; email?: string
  }

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'firstName, lastName ed email sono obbligatori' })
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Email non valida' })
    return
  }

  try {
    const account = await prisma.account.update({
      where: { id },
      data: {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        email:     email.trim().toLowerCase(),
      },
    })
    res.json(account)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Account non trovato' })
      return
    }
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'Email già presente' })
      return
    }
    console.error('[accounts] PUT error:', err)
    res.status(500).json({ error: 'Errore nell\'aggiornamento dell\'account' })
  }
})

app.delete('/accounts/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    await prisma.account.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Account non trovato' })
      return
    }
    console.error('[accounts] DELETE error:', err)
    res.status(500).json({ error: 'Errore nella cancellazione dell\'account' })
  }
})

// ── Clienti CRUD ─────────────────────────────────────────────

const CLIENTI_INCLUDE = {
  _count: { select: { progetti: true } },
  account: { select: { id: true, firstName: true, lastName: true } },
} as const

app.get('/clienti', requireAuth, async (_req, res) => {
  try {
    const clienti = await prisma.cliente.findMany({
      orderBy: { nome: 'asc' },
      include: CLIENTI_INCLUDE,
    })
    res.json(clienti)
  } catch (err) {
    console.error('[clienti] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero dei clienti' })
  }
})

app.post('/clienti', requireAuth, async (req, res) => {
  const { nome, referente, email, telefono, note, accountId } = req.body as {
    nome?: string; referente?: string; email?: string; telefono?: string; note?: string; accountId?: string
  }
  if (!nome?.trim()) { res.status(400).json({ error: 'Il nome è obbligatorio' }); return }
  if (email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Email non valida' }); return
  }
  try {
    const cliente = await prisma.cliente.create({
      data: {
        nome:      nome.trim(),
        referente: referente?.trim() || null,
        email:     email?.trim().toLowerCase() || null,
        telefono:  telefono?.trim() || null,
        note:      note?.trim() || null,
        accountId: accountId?.trim() || null,
      },
      include: CLIENTI_INCLUDE,
    })
    res.status(201).json(cliente)
  } catch (err) {
    console.error('[clienti] POST error:', err)
    res.status(500).json({ error: 'Errore nella creazione del cliente' })
  }
})

app.put('/clienti/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { nome, referente, email, telefono, note, accountId } = req.body as {
    nome?: string; referente?: string; email?: string; telefono?: string; note?: string; accountId?: string
  }
  if (!nome?.trim()) { res.status(400).json({ error: 'Il nome è obbligatorio' }); return }
  if (email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Email non valida' }); return
  }
  try {
    const cliente = await prisma.cliente.update({
      where: { id },
      data: {
        nome:      nome.trim(),
        referente: referente?.trim() || null,
        email:     email?.trim().toLowerCase() || null,
        telefono:  telefono?.trim() || null,
        note:      note?.trim() || null,
        accountId: accountId?.trim() || null,
      },
      include: CLIENTI_INCLUDE,
    })
    res.json(cliente)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') { res.status(404).json({ error: 'Cliente non trovato' }); return }
    console.error('[clienti] PUT error:', err)
    res.status(500).json({ error: 'Errore nell\'aggiornamento del cliente' })
  }
})

app.delete('/clienti/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    await prisma.cliente.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') { res.status(404).json({ error: 'Cliente non trovato' }); return }
    console.error('[clienti] DELETE error:', err)
    res.status(500).json({ error: 'Errore nella cancellazione del cliente' })
  }
})

// ── Progetti CRUD ─────────────────────────────────────────────

app.get('/progetti', requireAuth, async (_req, res) => {
  try {
    const progetti = await prisma.progetto.findMany({
      orderBy: { nome: 'asc' },
      include: { cliente: { select: { id: true, nome: true } } },
    })
    res.json(progetti)
  } catch (err) {
    console.error('[progetti] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero dei progetti' })
  }
})

app.post('/progetti', requireAuth, async (req, res) => {
  const { nome, descrizione, stato, clienteId, dataInizio, dataFine } = req.body as {
    nome?: string; descrizione?: string; stato?: string
    clienteId?: string; dataInizio?: string; dataFine?: string
  }
  if (!nome?.trim()) { res.status(400).json({ error: 'Il nome è obbligatorio' }); return }
  const statoVal = stato?.trim() ?? 'ATTIVO'
  const statiValidi = await prisma.statoProgettoConfig.findMany({ select: { chiave: true } })
  if (!statiValidi.some(s => s.chiave === statoVal)) {
    res.status(400).json({ error: 'Stato non valido' }); return
  }
  try {
    const progetto = await prisma.progetto.create({
      data: {
        nome:        nome.trim(),
        descrizione: descrizione?.trim() || null,
        stato:       statoVal,
        clienteId:   clienteId?.trim() || null,
        dataInizio:  dataInizio ? new Date(dataInizio) : null,
        dataFine:    dataFine   ? new Date(dataFine)   : null,
      },
      include: { cliente: { select: { id: true, nome: true } } },
    })
    res.status(201).json(progetto)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2003') { res.status(400).json({ error: 'Cliente non trovato' }); return }
    console.error('[progetti] POST error:', err)
    res.status(500).json({ error: 'Errore nella creazione del progetto' })
  }
})

app.put('/progetti/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { nome, descrizione, stato, clienteId, dataInizio, dataFine } = req.body as {
    nome?: string; descrizione?: string; stato?: string
    clienteId?: string; dataInizio?: string; dataFine?: string
  }
  if (!nome?.trim()) { res.status(400).json({ error: 'Il nome è obbligatorio' }); return }
  const statoVal = stato?.trim() ?? 'ATTIVO'
  const statiValidi = await prisma.statoProgettoConfig.findMany({ select: { chiave: true } })
  if (!statiValidi.some(s => s.chiave === statoVal)) {
    res.status(400).json({ error: 'Stato non valido' }); return
  }
  try {
    const progetto = await prisma.progetto.update({
      where: { id },
      data: {
        nome:        nome.trim(),
        descrizione: descrizione?.trim() || null,
        stato:       statoVal,
        clienteId:   clienteId?.trim() || null,
        dataInizio:  dataInizio ? new Date(dataInizio) : null,
        dataFine:    dataFine   ? new Date(dataFine)   : null,
      },
      include: { cliente: { select: { id: true, nome: true } } },
    })
    res.json(progetto)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') { res.status(404).json({ error: 'Progetto non trovato' }); return }
    console.error('[progetti] PUT error:', err)
    res.status(500).json({ error: 'Errore nell\'aggiornamento del progetto' })
  }
})

app.delete('/progetti/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    await prisma.progetto.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') { res.status(404).json({ error: 'Progetto non trovato' }); return }
    console.error('[progetti] DELETE error:', err)
    res.status(500).json({ error: 'Errore nella cancellazione del progetto' })
  }
})

// ── Stati Attività Config CRUD ────────────────────────────────

app.get('/api/stati-attivita', requireAuth, async (_req, res) => {
  try {
    const stati = await prisma.statoAttivitaConfig.findMany({
      orderBy: [{ ordine: 'asc' }, { label: 'asc' }],
    })
    res.json(stati)
  } catch (err) {
    console.error('[stati-attivita] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero degli stati' })
  }
})

app.post('/api/stati-attivita', requireAuth, async (req, res) => {
  const { label, colore, isArchiviato, ordine } = req.body as {
    label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
  }
  if (!label?.trim()) {
    res.status(400).json({ error: 'label è obbligatorio' }); return
  }
  if (colore && !/^#[0-9a-fA-F]{3,8}$/.test(colore)) {
    res.status(400).json({ error: 'Colore non valido (usa formato hex, es. #3b82f6)' }); return
  }
  const chiave = label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || 'STATO'
  try {
    const stato = await prisma.statoAttivitaConfig.create({
      data: {
        chiave,
        label:        label.trim(),
        colore:       colore?.trim() ?? '#94a3b8',
        isArchiviato: isArchiviato ?? false,
        ordine:       ordine ?? 99,
      },
    })
    res.status(201).json(stato)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: `Esiste già uno stato con chiave "${chiave}"` }); return
    }
    console.error('[stati-attivita] POST error:', err)
    res.status(500).json({ error: 'Errore nella creazione dello stato' })
  }
})

app.put('/api/stati-attivita/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { label, colore, isArchiviato, ordine } = req.body as {
    label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
  }
  if (!label?.trim()) {
    res.status(400).json({ error: 'label è obbligatorio' }); return
  }
  if (colore && !/^#[0-9a-fA-F]{3,8}$/.test(colore)) {
    res.status(400).json({ error: 'Colore non valido' }); return
  }
  try {
    const stato = await prisma.statoAttivitaConfig.update({
      where: { id },
      data: {
        label:        label.trim(),
        colore:       colore?.trim() ?? '#94a3b8',
        isArchiviato: isArchiviato ?? false,
        ordine:       ordine ?? 99,
      },
    })
    res.json(stato)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Stato non trovato' }); return
    }
    console.error('[stati-attivita] PUT error:', err)
    res.status(500).json({ error: 'Errore nell\'aggiornamento dello stato' })
  }
})

app.delete('/api/stati-attivita/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    const stato = await prisma.statoAttivitaConfig.findUnique({ where: { id } })
    if (!stato) { res.status(404).json({ error: 'Stato non trovato' }); return }
    const inUso = await prisma.attivita.count({ where: { stato: stato.chiave } })
    if (inUso > 0) {
      res.status(409).json({ error: `Stato in uso da ${inUso} attività — riassegna prima le attività` }); return
    }
    await prisma.statoAttivitaConfig.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    console.error('[stati-attivita] DELETE error:', err)
    res.status(500).json({ error: 'Errore nella cancellazione dello stato' })
  }
})

// ── Stati Progetto Config CRUD ────────────────────────────────

app.get('/api/stati-progetto', requireAuth, async (_req, res) => {
  try {
    const stati = await prisma.statoProgettoConfig.findMany({
      orderBy: [{ ordine: 'asc' }, { label: 'asc' }],
    })
    res.json(stati)
  } catch (err) {
    console.error('[stati-progetto] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero degli stati' })
  }
})

app.post('/api/stati-progetto', requireAuth, async (req, res) => {
  const { label, colore, isArchiviato, ordine } = req.body as {
    label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
  }
  if (!label?.trim()) {
    res.status(400).json({ error: 'label è obbligatorio' }); return
  }
  if (colore && !/^#[0-9a-fA-F]{3,8}$/.test(colore)) {
    res.status(400).json({ error: 'Colore non valido (usa formato hex, es. #10b981)' }); return
  }
  const chiave = label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || 'STATO'
  try {
    const stato = await prisma.statoProgettoConfig.create({
      data: {
        chiave,
        label:        label.trim(),
        colore:       colore?.trim() ?? '#94a3b8',
        isArchiviato: isArchiviato ?? false,
        ordine:       ordine ?? 99,
      },
    })
    res.status(201).json(stato)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: `Esiste già uno stato con chiave "${chiave}"` }); return
    }
    console.error('[stati-progetto] POST error:', err)
    res.status(500).json({ error: 'Errore nella creazione dello stato' })
  }
})

app.put('/api/stati-progetto/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { label, colore, isArchiviato, ordine } = req.body as {
    label?: string; colore?: string; isArchiviato?: boolean; ordine?: number
  }
  if (!label?.trim()) {
    res.status(400).json({ error: 'label è obbligatorio' }); return
  }
  if (colore && !/^#[0-9a-fA-F]{3,8}$/.test(colore)) {
    res.status(400).json({ error: 'Colore non valido' }); return
  }
  try {
    const stato = await prisma.statoProgettoConfig.update({
      where: { id },
      data: {
        label:        label.trim(),
        colore:       colore?.trim() ?? '#94a3b8',
        isArchiviato: isArchiviato ?? false,
        ordine:       ordine ?? 99,
      },
    })
    res.json(stato)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Stato non trovato' }); return
    }
    console.error('[stati-progetto] PUT error:', err)
    res.status(500).json({ error: 'Errore nell\'aggiornamento dello stato' })
  }
})

app.delete('/api/stati-progetto/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    const stato = await prisma.statoProgettoConfig.findUnique({ where: { id } })
    if (!stato) { res.status(404).json({ error: 'Stato non trovato' }); return }
    const inUso = await prisma.progetto.count({ where: { stato: stato.chiave } })
    if (inUso > 0) {
      res.status(409).json({ error: `Stato in uso da ${inUso} progetti — riassegna prima i progetti` }); return
    }
    await prisma.statoProgettoConfig.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    console.error('[stati-progetto] DELETE error:', err)
    res.status(500).json({ error: 'Errore nella cancellazione dello stato' })
  }
})

// ── Attività CRUD ─────────────────────────────────────────────

function toNumber(d: unknown): number {
  if (d === null || d === undefined) return 0
  return typeof d === 'object' && 'toNumber' in (d as object)
    ? (d as { toNumber(): number }).toNumber()
    : Number(d)
}

// GET /api/attivita — lista raggruppata per cliente+progetto
app.get('/api/attivita', requireAuth, async (req, res) => {
  try {
    const { account, pm, stato, soloAttivi } = req.query as {
      account?: string; pm?: string; stato?: string; soloAttivi?: string
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {}

    if (account?.trim()) where['account'] = account.trim()
    if (pm?.trim()) where['projectManager'] = pm.trim()

    // Usa la config per determinare gli stati "attivi" (non archiviati)
    let statoAttiviChiavi: string[] | undefined = undefined
    if (soloAttivi === 'true') {
      const statiAttivi = await prisma.statoAttivitaConfig.findMany({
        where: { isArchiviato: false },
        select: { chiave: true },
      })
      statoAttiviChiavi = statiAttivi.map(s => s.chiave)
    }

    if (stato?.trim()) {
      const chiavi = stato.split(',').map(s => s.trim()).filter(Boolean)
      if (chiavi.length > 0) {
        where['stato'] = { in: statoAttiviChiavi
          ? chiavi.filter(v => statoAttiviChiavi!.includes(v))
          : chiavi }
      }
    } else if (statoAttiviChiavi) {
      where['stato'] = { in: statoAttiviChiavi }
    }

    const rows = await prisma.attivita.findMany({
      where,
      orderBy: [{ cliente: 'asc' }, { progetto: 'asc' }, { attivita: 'asc' }],
      include: {
        clienteRel:  { select: { id: true, nome: true, accountId: true, account: { select: { id: true, firstName: true, lastName: true } } } },
        progettoRel: { select: { id: true, nome: true } },
        pms:         { include: { pm: { select: { id: true, firstName: true, lastName: true } } } },
      },
    })

    const resolvedName = (first: string | null, last: string) =>
      [first, last].filter(Boolean).join(' ')

    const groupMap = new Map<string, {
      cliente: string; progetto: string; account: string
      projectManager: string; attivita: typeof rows
    }>()

    for (const row of rows) {
      const clienteNome   = row.clienteRel?.nome  ?? row.cliente
      const progettoNome  = row.progettoRel?.nome ?? row.progetto
      const key = `${clienteNome}|||${progettoNome}`
      if (!groupMap.has(key)) {
        const accountName = row.clienteRel?.account
          ? resolvedName(row.clienteRel.account.firstName, row.clienteRel.account.lastName)
          : row.account
        const pmName = row.pms.length > 0
          ? row.pms.map(p => resolvedName(p.pm.firstName, p.pm.lastName)).join(', ')
          : row.projectManager
        groupMap.set(key, {
          cliente:        clienteNome,
          progetto:       progettoNome,
          account:        accountName,
          projectManager: pmName,
          attivita:       [],
        })
      }
      groupMap.get(key)!.attivita.push(row)
    }

    const gruppi = Array.from(groupMap.values()).map(g => {
      const attivitaMapped = g.attivita.map(a => {
        const clienteNome  = a.clienteRel?.nome  ?? a.cliente
        const progettoNome = a.progettoRel?.nome ?? a.progetto
        const accountName  = a.clienteRel?.account
          ? resolvedName(a.clienteRel.account.firstName, a.clienteRel.account.lastName)
          : a.account
        const pmNames = a.pms.length > 0
          ? a.pms.map(p => resolvedName(p.pm.firstName, p.pm.lastName)).join(', ')
          : a.projectManager
        return {
          id:                       a.id,
          cliente:                  clienteNome,
          clienteId:                a.clienteId ?? null,
          progetto:                 progettoNome,
          progettoId:               a.progettoId ?? null,
          account:                  accountName,
          accountId:                a.clienteRel?.accountId ?? null,
          projectManager:           pmNames,
          pmIds:                    a.pms.map(p => p.pmId),
          attivita:                 a.attivita,
          giornateVendute:          a.giornateVendute !== null ? toNumber(a.giornateVendute) : null,
          giornateConsuntivate:     a.giornateConsuntivate !== null ? toNumber(a.giornateConsuntivate) : null,
          riferimentoOrdineVendita: a.riferimentoOrdineVendita,
          stato:                    a.stato,
          inizio:                   a.inizio?.toISOString().split('T')[0] ?? null,
          deadline:                 a.deadline?.toISOString().split('T')[0] ?? null,
          note:                     a.note,
        }
      })

      const totaleVendute      = attivitaMapped.reduce((s, a) => s + (a.giornateVendute ?? 0), 0)
      const totaleConsuntivate = attivitaMapped.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0)

      const inSforamento = totaleConsuntivate > totaleVendute ||
        attivitaMapped.some(a =>
          (a.giornateConsuntivate ?? 0) > 0 &&
          (a.giornateVendute === null || (a.giornateConsuntivate ?? 0) > (a.giornateVendute ?? 0))
        )

      return {
        cliente:             g.cliente,
        progetto:            g.progetto,
        account:             g.account,
        projectManager:      g.projectManager,
        totaleVendute:       Math.round(totaleVendute * 100) / 100,
        totaleConsuntivate:  Math.round(totaleConsuntivate * 100) / 100,
        inSforamento,
        attivita:            attivitaMapped,
      }
    })

    gruppi.sort((a, b) =>
      a.cliente.localeCompare(b.cliente, 'it') ||
      a.progetto.localeCompare(b.progetto, 'it')
    )

    const allAttivita = gruppi.flatMap(g => g.attivita)
    const riepilogo = {
      totaleProgetti:             gruppi.length,
      totaleAttivita:             allAttivita.length,
      attivitaInSforamento:       allAttivita.filter(a =>
        (a.giornateConsuntivate ?? 0) > 0 &&
        (a.giornateVendute === null || (a.giornateConsuntivate ?? 0) > (a.giornateVendute ?? 0))
      ).length,
      attivitaInApprovazione:     allAttivita.filter(a => a.stato === 'IN_APPROVAZIONE').length,
      totaleGiornateVendute:      Math.round(allAttivita.reduce((s, a) => s + (a.giornateVendute ?? 0), 0) * 100) / 100,
      totaleGiornateConsuntivate: Math.round(allAttivita.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0) * 100) / 100,
    }

    res.json({ gruppi, riepilogo })
  } catch (err) {
    console.error('[attivita] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero delle attività' })
  }
})

// POST /api/attivita
app.post('/api/attivita', requireAuth, async (req, res) => {
  const {
    clienteId, progettoId, pmIds,
    attivita,
    giornateVendute, giornateConsuntivate, riferimentoOrdineVendita,
    stato, inizio, deadline, note,
  } = req.body as {
    clienteId?: string; progettoId?: string; pmIds?: string[]
    attivita?: string
    giornateVendute?: number | null; giornateConsuntivate?: number | null
    riferimentoOrdineVendita?: string; stato?: string
    inizio?: string | null; deadline?: string | null; note?: string
  }

  if (!clienteId?.trim() || !progettoId?.trim() || !attivita?.trim()) {
    res.status(400).json({ error: 'cliente, progetto e attivita sono obbligatori' })
    return
  }

  const [linkedCliente, linkedProgetto] = await Promise.all([
    prisma.cliente.findUnique({
      where: { id: clienteId.trim() },
      select: { nome: true, accountId: true, account: { select: { firstName: true, lastName: true } } },
    }),
    prisma.progetto.findUnique({ where: { id: progettoId.trim() }, select: { nome: true } }),
  ])

  if (!linkedCliente || !linkedProgetto) {
    res.status(400).json({ error: 'cliente o progetto non trovato' }); return
  }

  const statoVal = stato?.trim() ?? 'IN_CORSO'
  const statiValidi = await prisma.statoAttivitaConfig.findMany({ select: { chiave: true } })
  if (!statiValidi.some(s => s.chiave === statoVal)) {
    res.status(400).json({ error: 'Stato non valido' }); return
  }

  const accountName = linkedCliente.account
    ? [linkedCliente.account.firstName, linkedCliente.account.lastName].filter(Boolean).join(' ')
    : ''

  try {
    const row = await prisma.attivita.create({
      data: {
        cliente:                  linkedCliente.nome,
        clienteId:                clienteId.trim(),
        progetto:                 linkedProgetto.nome,
        progettoId:               progettoId.trim(),
        account:                  accountName,
        accountId:                linkedCliente.accountId ?? null,
        projectManager:           '',
        attivita:                 attivita.trim(),
        giornateVendute:          giornateVendute != null ? giornateVendute : null,
        giornateConsuntivate:     giornateConsuntivate != null ? giornateConsuntivate : null,
        riferimentoOrdineVendita: riferimentoOrdineVendita?.trim() || null,
        stato:                    statoVal,
        inizio:                   inizio   ? new Date(inizio)   : null,
        deadline:                 deadline ? new Date(deadline) : null,
        note:                     note?.trim() || null,
        pms: pmIds?.length
          ? { create: pmIds.map(pmId => ({ pmId })) }
          : undefined,
      },
    })
    res.status(201).json(row)
  } catch (err) {
    console.error('[attivita] POST error:', err)
    res.status(500).json({ error: 'Errore nella creazione dell\'attività' })
  }
})

// PUT /api/attivita/:id
app.put('/api/attivita/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const {
    clienteId, progettoId, pmIds,
    attivita,
    giornateVendute, giornateConsuntivate, riferimentoOrdineVendita,
    stato, inizio, deadline, note,
  } = req.body as {
    clienteId?: string; progettoId?: string; pmIds?: string[]
    attivita?: string
    giornateVendute?: number | null; giornateConsuntivate?: number | null
    riferimentoOrdineVendita?: string; stato?: string
    inizio?: string | null; deadline?: string | null; note?: string
  }

  if (!clienteId?.trim() || !progettoId?.trim() || !attivita?.trim()) {
    res.status(400).json({ error: 'cliente, progetto e attivita sono obbligatori' })
    return
  }

  const [linkedCliente, linkedProgetto] = await Promise.all([
    prisma.cliente.findUnique({
      where: { id: clienteId.trim() },
      select: { nome: true, accountId: true, account: { select: { firstName: true, lastName: true } } },
    }),
    prisma.progetto.findUnique({ where: { id: progettoId.trim() }, select: { nome: true } }),
  ])

  if (!linkedCliente || !linkedProgetto) {
    res.status(400).json({ error: 'cliente o progetto non trovato' }); return
  }

  const statoVal = stato?.trim() ?? 'IN_CORSO'
  const statiValidi = await prisma.statoAttivitaConfig.findMany({ select: { chiave: true } })
  if (!statiValidi.some(s => s.chiave === statoVal)) {
    res.status(400).json({ error: 'Stato non valido' }); return
  }

  const accountName = linkedCliente.account
    ? [linkedCliente.account.firstName, linkedCliente.account.lastName].filter(Boolean).join(' ')
    : ''

  try {
    const row = await prisma.attivita.update({
      where: { id },
      data: {
        cliente:                  linkedCliente.nome,
        clienteId:                clienteId.trim(),
        progetto:                 linkedProgetto.nome,
        progettoId:               progettoId.trim(),
        account:                  accountName,
        accountId:                linkedCliente.accountId ?? null,
        projectManager:           '',
        attivita:                 attivita.trim(),
        giornateVendute:          giornateVendute != null ? giornateVendute : null,
        giornateConsuntivate:     giornateConsuntivate != null ? giornateConsuntivate : null,
        riferimentoOrdineVendita: riferimentoOrdineVendita?.trim() || null,
        stato:                    statoVal,
        inizio:                   inizio   ? new Date(inizio)   : null,
        deadline:                 deadline ? new Date(deadline) : null,
        note:                     note?.trim() || null,
        pms: {
          deleteMany: {},
          ...(pmIds?.length ? { create: pmIds.map(pmId => ({ pmId })) } : {}),
        },
      },
    })
    res.json(row)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Attività non trovata' }); return
    }
    console.error('[attivita] PUT error:', err)
    res.status(500).json({ error: 'Errore nell\'aggiornamento dell\'attività' })
  }
})

// DELETE /api/attivita/:id
app.delete('/api/attivita/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    await prisma.attivita.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Attività non trovata' }); return
    }
    console.error('[attivita] DELETE error:', err)
    res.status(500).json({ error: 'Errore nella cancellazione dell\'attività' })
  }
})

// ── Gantt: PATCH date attività ────────────────────────────────
app.patch('/api/attivita/:id/dates', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { inizio, deadline } = req.body as { inizio?: string | null; deadline?: string | null }
  try {
    const row = await prisma.attivita.update({
      where: { id },
      data: {
        inizio:   inizio   !== undefined ? (inizio   ? new Date(inizio)   : null) : undefined,
        deadline: deadline !== undefined ? (deadline ? new Date(deadline) : null) : undefined,
      },
    })
    res.json(row)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Attività non trovata' }); return
    }
    res.status(500).json({ error: 'Errore aggiornamento date' })
  }
})

// ── Gantt Milestones ──────────────────────────────────────────

// GET /api/gantt/milestones — tutti (filtro opzionale ?activityId=)
app.get('/api/gantt/milestones', requireAuth, async (req, res) => {
  const activityId = req.query['activityId'] as string | undefined
  const rows = await prisma.ganttMilestone.findMany({
    where: activityId ? { activityId } : undefined,
    orderBy: { date: 'asc' },
  })
  res.json(rows)
})

// POST /api/gantt/milestones
app.post('/api/gantt/milestones', requireAuth, async (req, res) => {
  const { activityId, title, date, color, icon } = req.body as {
    activityId?: string; title?: string; date?: string; color?: string; icon?: string
  }
  if (!activityId?.trim() || !title?.trim() || !date) {
    res.status(400).json({ error: 'activityId, title e date sono obbligatori' }); return
  }
  const row = await prisma.ganttMilestone.create({
    data: {
      activityId: activityId.trim(),
      title:      title.trim(),
      date:       new Date(date),
      color:      color?.trim() || '#F59E0B',
      icon:       icon?.trim() || null,
    },
  })
  res.status(201).json(row)
})

// PUT /api/gantt/milestones/:id
app.put('/api/gantt/milestones/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { title, date, color, icon } = req.body as {
    title?: string; date?: string; color?: string; icon?: string
  }
  try {
    const row = await prisma.ganttMilestone.update({
      where: { id },
      data: {
        title: title?.trim(),
        date:  date ? new Date(date) : undefined,
        color: color?.trim(),
        icon:  icon !== undefined ? (icon?.trim() || null) : undefined,
      },
    })
    res.json(row)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Milestone non trovata' }); return
    }
    res.status(500).json({ error: 'Errore aggiornamento milestone' })
  }
})

// DELETE /api/gantt/milestones/:id
app.delete('/api/gantt/milestones/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  try {
    await prisma.ganttMilestone.delete({ where: { id } })
    res.status(204).send()
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Milestone non trovata' }); return
    }
    res.status(500).json({ error: 'Errore cancellazione milestone' })
  }
})

// ── Import CSV ────────────────────────────────────────────────

app.post('/api/import/csv', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'File mancante' })
    return
  }
  try {
    const result = await importCSV(req.file.buffer, prisma)
    res.json({ success: true, result })
  } catch (err) {
    console.error('[import] error:', err)
    res.status(422).json({ error: 'Errore import', detail: String(err) })
  }
})

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[s1-gantt] Backend → http://localhost:${PORT}`)
  console.log(`[s1-gantt] Callback → ${CALLBACK_URL}`)
  if (!GOOGLE_CLIENT_ID) {
    console.warn('[s1-gantt] ⚠️  GOOGLE_CLIENT_ID non impostato — OAuth non funzionerà')
  }
})
