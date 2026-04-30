// v0.3.0 — Google OAuth + JWT + PM CRUD
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

const CORS_ORIGIN: string | boolean = FRONTEND_URL
  ? FRONTEND_URL
  : process.env.NODE_ENV === 'production' ? false : true

app.use(cors({
  origin:      CORS_ORIGIN,
  credentials: CORS_ORIGIN !== false,
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
  res.json({ status: 'ok', version: '0.3.0' })
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

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[s1-gantt] Backend → http://localhost:${PORT}`)
  console.log(`[s1-gantt] Callback → ${CALLBACK_URL}`)
  if (!GOOGLE_CLIENT_ID) {
    console.warn('[s1-gantt] ⚠️  GOOGLE_CLIENT_ID non impostato — OAuth non funzionerà')
  }
})
