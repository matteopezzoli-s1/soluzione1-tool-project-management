import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createPrismaClient } from './lib/prisma'
import { registerRoutes, type Env } from './app'

const PORT = Number(process.env.PORT) || 8080
const BACKEND_URL = process.env.BACKEND_URL ?? `http://localhost:${PORT}`
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''

const prisma = createPrismaClient(process.env.DATABASE_URL ?? '')

// Integrazione Zoho Projects: attiva solo se tutte le credenziali sono presenti
const zohoConfig =
  process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET &&
  process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_PORTAL_ID
    ? {
        clientId: process.env.ZOHO_CLIENT_ID,
        clientSecret: process.env.ZOHO_CLIENT_SECRET,
        refreshToken: process.env.ZOHO_REFRESH_TOKEN,
        portalId: process.env.ZOHO_PORTAL_ID,
        accountsUrl: process.env.ZOHO_ACCOUNTS_URL ?? 'https://accounts.zoho.eu',
        apiUrl: process.env.ZOHO_PROJECTS_API_URL ?? 'https://projectsapi.zoho.eu',
      }
    : null

const app = new Hono<Env>()

app.use('*', async (c, next) => {
  c.set('prisma', prisma)
  c.set('config', {
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    callbackUrl: `${BACKEND_URL}/auth/google/callback`,
    isProd: process.env.NODE_ENV === 'production',
    zoho: zohoConfig,
  })
  await next()
})

registerRoutes(app)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[tpm] Backend → http://localhost:${info.port}`)
  console.log(`[tpm] Callback → ${BACKEND_URL}/auth/google/callback`)
  if (!GOOGLE_CLIENT_ID) {
    console.warn('[tpm] ⚠️  GOOGLE_CLIENT_ID non impostato — OAuth non funzionerà')
  }
})
