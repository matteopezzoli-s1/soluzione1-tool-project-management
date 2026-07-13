// ============================================================
// auth.ts — Google OAuth2 + JWT (stateless, no passport)
// ============================================================
import jwt from 'jsonwebtoken'

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_INFO_URL  = 'https://www.googleapis.com/oauth2/v2/userinfo'

// ── Step 1: build redirect URL ────────────────────────────────
export function buildGoogleAuthURL(clientId: string, callbackUrl: string): string {
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  callbackUrl,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

// ── Step 2: exchange code → profile ──────────────────────────
interface GoogleTokenResponse {
  access_token: string
  token_type:   string
  expires_in:   number
  id_token:     string
}

export interface GoogleProfile {
  id:         string
  email:      string
  name:       string
  picture:    string
  verified_email: boolean
}

export async function fetchGoogleProfile(
  code: string,
  clientId: string,
  clientSecret: string,
  callbackUrl: string,
): Promise<GoogleProfile> {
  // Exchange authorization code for access token
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  callbackUrl,
      grant_type:    'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`)
  }

  const tokens = await tokenRes.json() as GoogleTokenResponse

  // Fetch user profile
  const infoRes = await fetch(GOOGLE_INFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  if (!infoRes.ok) {
    throw new Error(`UserInfo fetch failed (${infoRes.status})`)
  }

  return infoRes.json() as Promise<GoogleProfile>
}

// ── JWT ───────────────────────────────────────────────────────
export interface JWTPayload {
  sub:     string
  email:   string
  name:    string
  picture: string
  userId:  string | null
  roles?:  string[]
}

export function signJWT(payload: JWTPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' })
}

export function verifyJWT(token: string, secret: string): JWTPayload {
  return jwt.verify(token, secret) as JWTPayload
}
