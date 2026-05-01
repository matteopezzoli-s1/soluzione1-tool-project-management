// v0.4.0 — Google OAuth + JWT + PM CRUD + Account CRUD
import express, { Request, Response, NextFunction } from 'express'
import cors    from 'cors'
import { PrismaClient } from '@prisma/client'
import {
  buildGoogleAuthURL,
  fetchGoogleProfile,
  signJWT,
  verifyJWT,
} from './auth'

const app    = express()
const prisma = new PrismaClient()
const PORT   = process.env.PORT || 8080

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
  origin: IS_PROD
    ? FRONTEND_URL
    : (origin, cb) => {
        // In dev: accetta qualsiasi localhost (qualsiasi porta) + richieste senza origin (curl/Postman)
        if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true)
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
  res.json({ status: 'ok', version: '0.4.0' })
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

// GET /pm — lista tutti i PM
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

// POST /pm — crea PM
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

// PUT /pm/:id — aggiorna PM
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

// DELETE /pm/:id — elimina PM
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

// GET /accounts
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

// POST /accounts
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

// PUT /accounts/:id
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

// DELETE /accounts/:id
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

// GET /clienti
app.get('/clienti', requireAuth, async (_req, res) => {
  try {
    const clienti = await prisma.cliente.findMany({
      orderBy: { nome: 'asc' },
      include: {
        _count: { select: { progetti: true } },
        account: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    res.json(clienti)
  } catch (err) {
    console.error('[clienti] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero dei clienti' })
  }
})

const CLIENTI_INCLUDE = {
  _count: { select: { progetti: true } },
  account: { select: { id: true, firstName: true, lastName: true } },
} as const

// POST /clienti
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

// PUT /clienti/:id
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

// DELETE /clienti/:id
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

const STATI_PROGETTO = ['ATTIVO', 'IN_PAUSA', 'COMPLETATO', 'ANNULLATO'] as const
type StatoProgetto = typeof STATI_PROGETTO[number]

// GET /progetti
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

// POST /progetti
app.post('/progetti', requireAuth, async (req, res) => {
  const { nome, descrizione, stato, clienteId, dataInizio, dataFine } = req.body as {
    nome?: string; descrizione?: string; stato?: string
    clienteId?: string; dataInizio?: string; dataFine?: string
  }
  if (!nome?.trim()) { res.status(400).json({ error: 'Il nome è obbligatorio' }); return }
  const statoVal = (stato?.trim() ?? 'ATTIVO') as StatoProgetto
  if (!STATI_PROGETTO.includes(statoVal)) { res.status(400).json({ error: 'Stato non valido' }); return }
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

// PUT /progetti/:id
app.put('/progetti/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string
  const { nome, descrizione, stato, clienteId, dataInizio, dataFine } = req.body as {
    nome?: string; descrizione?: string; stato?: string
    clienteId?: string; dataInizio?: string; dataFine?: string
  }
  if (!nome?.trim()) { res.status(400).json({ error: 'Il nome è obbligatorio' }); return }
  const statoVal = (stato?.trim() ?? 'ATTIVO') as StatoProgetto
  if (!STATI_PROGETTO.includes(statoVal)) { res.status(400).json({ error: 'Stato non valido' }); return }
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

// DELETE /progetti/:id
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

// ── Attività ──────────────────────────────────────────────────

const STATO_LABEL: Record<string, string> = {
  IN_CORSO:        'In corso',
  COMPLETATO:      'Completato',
  DA_INIZIARE:     'Da iniziare',
  IN_APPROVAZIONE: 'In approvazione',
  ANALISI:         'Analisi',
  FERMI:           'Fermi',
  RIFIUTATO:       'Rifiutato',
}

const STATO_FROM_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATO_LABEL).map(([k, v]) => [v, k])
)

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

    // Build Prisma where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {}

    if (account?.trim()) where['account'] = account.trim()
    if (pm?.trim()) where['projectManager'] = pm.trim()

    const statoAttivi = soloAttivi === 'true'
      ? ['IN_CORSO', 'DA_INIZIARE', 'IN_APPROVAZIONE', 'ANALISI', 'FERMI']
      : undefined

    if (stato?.trim()) {
      const labels = stato.split(',').map(s => s.trim()).filter(Boolean)
      const dbValues = labels.map(l => STATO_FROM_LABEL[l] ?? l).filter(Boolean)
      if (dbValues.length > 0) {
        where['stato'] = { in: statoAttivi
          ? dbValues.filter(v => statoAttivi.includes(v))
          : dbValues }
      }
    } else if (statoAttivi) {
      where['stato'] = { in: statoAttivi }
    }

    const [rows, clientiRows] = await Promise.all([
      prisma.attivita.findMany({
        where,
        orderBy: [{ cliente: 'asc' }, { progetto: 'asc' }, { attivita: 'asc' }],
      }),
      prisma.cliente.findMany({
        select: { nome: true, account: { select: { firstName: true, lastName: true } } },
      }),
    ])

    // Map cliente nome (lowercase) → account full name
    const clienteAccountMap = new Map<string, string>()
    for (const c of clientiRows) {
      if (c.account) {
        clienteAccountMap.set(
          c.nome.toLowerCase(),
          `${c.account.firstName} ${c.account.lastName}`.trim()
        )
      }
    }

    // Group by cliente+progetto
    const groupMap = new Map<string, {
      cliente: string
      progetto: string
      account: string
      projectManager: string
      attivita: typeof rows
    }>()

    for (const row of rows) {
      const key = `${row.cliente}|||${row.progetto}`
      if (!groupMap.has(key)) {
        // Account: prefer the one linked to the Cliente record, fallback to the activity field
        const clienteAccount = clienteAccountMap.get(row.cliente.toLowerCase()) ?? ''
        groupMap.set(key, {
          cliente:        row.cliente,
          progetto:       row.progetto,
          account:        clienteAccount || row.account,
          projectManager: row.projectManager,
          attivita:       [],
        })
      }
      groupMap.get(key)!.attivita.push(row)
    }

    const gruppi = Array.from(groupMap.values()).map(g => {
      const attivitaMapped = g.attivita.map(a => ({
        id:                       a.id,
        cliente:                  a.cliente,
        progetto:                 a.progetto,
        attivita:                 a.attivita,
        risorseCoinvolte:         a.risorseCoinvolte,
        account:                  a.account,
        projectManager:           a.projectManager,
        giornateVendute:          a.giornateVendute !== null ? toNumber(a.giornateVendute) : null,
        giornateConsuntivate:     a.giornateConsuntivate !== null ? toNumber(a.giornateConsuntivate) : null,
        riferimentoOrdineVendita: a.riferimentoOrdineVendita,
        stato:                    STATO_LABEL[a.stato] ?? a.stato,
        inizio:                   a.inizio?.toISOString().split('T')[0] ?? null,
        deadline:                 a.deadline?.toISOString().split('T')[0] ?? null,
        note:                     a.note,
      }))

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

    // Sforamento groups first, then alphabetically
    gruppi.sort((a, b) => {
      if (a.inSforamento !== b.inSforamento) return a.inSforamento ? -1 : 1
      return `${a.cliente}${a.progetto}`.localeCompare(`${b.cliente}${b.progetto}`, 'it')
    })

    const allAttivita = gruppi.flatMap(g => g.attivita)
    const riepilogo = {
      totaleProgetti:           gruppi.length,
      totaleAttivita:           allAttivita.length,
      attivitaInSforamento:     allAttivita.filter(a =>
        (a.giornateConsuntivate ?? 0) > 0 &&
        (a.giornateVendute === null || (a.giornateConsuntivate ?? 0) > (a.giornateVendute ?? 0))
      ).length,
      attivitaInApprovazione:   allAttivita.filter(a => a.stato === 'In approvazione').length,
      totaleGiornateVendute:    Math.round(allAttivita.reduce((s, a) => s + (a.giornateVendute ?? 0), 0) * 100) / 100,
      totaleGiornateConsuntivate: Math.round(allAttivita.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0) * 100) / 100,
    }

    res.json({ gruppi, riepilogo })
  } catch (err) {
    console.error('[attivita] GET error:', err)
    res.status(500).json({ error: 'Errore nel recupero delle attività' })
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
