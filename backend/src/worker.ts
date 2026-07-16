import { Hono } from 'hono'
import { createPrismaClient } from './lib/prisma'
import { registerRoutes, type Vars } from './app'

interface Bindings {
  HYPERDRIVE: { connectionString: string }
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  JWT_SECRET?: string
  FRONTEND_URL?: string
  BACKEND_URL?: string
  ZOHO_CLIENT_ID?: string
  ZOHO_CLIENT_SECRET?: string
  ZOHO_REFRESH_TOKEN?: string
  ZOHO_PORTAL_ID?: string
  ZOHO_ACCOUNTS_URL?: string
  ZOHO_PROJECTS_API_URL?: string
}

type WorkerEnv = { Bindings: Bindings; Variables: Vars }

const app = new Hono<WorkerEnv>()

// Il runtime Workers vieta di riusare oggetti I/O (socket, pool pg) creati
// durante una richiesta precedente: il Pool/PrismaClient va creato e chiuso
// ad ogni richiesta. Hyperdrive gestisce il pooling reale lato edge.
app.use('*', async (c, next) => {
  const prisma = createPrismaClient(c.env.HYPERDRIVE.connectionString)

  const backendUrl = c.env.BACKEND_URL ?? new URL(c.req.url).origin

  c.set('prisma', prisma)
  c.set('config', {
    googleClientId: c.env.GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET ?? '',
    jwtSecret: c.env.JWT_SECRET ?? 'dev-secret-change-me',
    frontendUrl: c.env.FRONTEND_URL ?? 'http://localhost:5173',
    callbackUrl: `${backendUrl}/auth/google/callback`,
    isProd: true,
    zoho:
      c.env.ZOHO_CLIENT_ID && c.env.ZOHO_CLIENT_SECRET &&
      c.env.ZOHO_REFRESH_TOKEN && c.env.ZOHO_PORTAL_ID
        ? {
            clientId: c.env.ZOHO_CLIENT_ID,
            clientSecret: c.env.ZOHO_CLIENT_SECRET,
            refreshToken: c.env.ZOHO_REFRESH_TOKEN,
            portalId: c.env.ZOHO_PORTAL_ID,
            accountsUrl: c.env.ZOHO_ACCOUNTS_URL ?? 'https://accounts.zoho.eu',
            apiUrl: c.env.ZOHO_PROJECTS_API_URL ?? 'https://projectsapi.zoho.eu',
          }
        : null,
  })
  try {
    await next()
  } finally {
    c.executionCtx.waitUntil(prisma.$disconnect())
  }
})

registerRoutes(app)

export default app
