// v0.2.0 — Google OAuth + JWT
import express from 'express'
import cors    from 'cors'
import {
  buildGoogleAuthURL,
  fetchGoogleProfile,
  signJWT,
  verifyJWT,
} from './auth'

const app  = express()
const PORT = process.env.PORT || 8080

// ── Env ───────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const JWT_SECRET           = process.env.JWT_SECRET           ?? 'dev-secret-change-me'
const FRONTEND_URL         = process.env.FRONTEND_URL         ?? 'http://localhost:5173'
const BACKEND_URL          = process.env.BACKEND_URL          ?? `http://localhost:${PORT}`
const CALLBACK_URL         = `${BACKEND_URL}/auth/google/callback`

// ── Middleware ────────────────────────────────────────────────
app.use(express.json())

// CORS: se FRONTEND_URL non è ancora impostato (primo deploy bootstrap),
// si usa true in dev (riflette l'origin) o si blocca in prod.
const CORS_ORIGIN: string | boolean = FRONTEND_URL
  ? FRONTEND_URL
  : process.env.NODE_ENV === 'production' ? false : true

app.use(cors({
  origin:      CORS_ORIGIN,
  credentials: CORS_ORIGIN !== false,
}))

// ── Health ────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.2.0' })
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

// ── Auth: Step 3 — verifica token (opzionale, per il frontend) ─
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

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[s1-gantt] Backend → http://localhost:${PORT}`)
  console.log(`[s1-gantt] Callback → ${CALLBACK_URL}`)
  if (!GOOGLE_CLIENT_ID) {
    console.warn('[s1-gantt] ⚠️  GOOGLE_CLIENT_ID non impostato — OAuth non funzionerà')
  }
})
