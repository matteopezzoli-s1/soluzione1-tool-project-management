import { useEffect, useCallback, useState } from 'react'
import './LoginPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Icons ────────────────────────────────────────────────────────────────────

function GanttBarIcon() {
  return (
    <svg className="brand-icon" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="16" height="4" rx="2" fill="#C9A84C" />
      <rect x="7" y="12" width="14" height="4" rx="2" fill="#6AADFF" />
      <rect x="4" y="19" width="18" height="4" rx="2" fill="#C9A84C" opacity="0.75" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="google-icon" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

// ─── Gantt Illustration ───────────────────────────────────────────────────────

const LABEL_W = 88
const COL_W = 66
const ROW_H = 38
const TOP = 44

type TaskEntry = [label: string, startCol: number, spanCols: number, color: 0 | 1 | 2]

const TASKS: TaskEntry[] = [
  ['E-Commerce',    0.0, 2.2, 0],
  ['App Mobile',    0.5, 1.8, 1],
  ['CRM Interno',   1.2, 2.4, 0],
  ['Portal HR',     1.8, 1.6, 2],
  ['API Gateway',   2.2, 2.0, 1],
  ['Analytics',     3.4, 1.4, 0],
  ['Migrazione DB', 4.0, 1.0, 2],
]

const MONTHS = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU']

const BAR_COLORS = [
  { base: '#C9A84C', light: '#E8D080', dim: 'rgba(201,168,76,0.35)' },
  { base: '#2A6DB5', light: '#6AADFF', dim: 'rgba(42,109,181,0.35)' },
  { base: '#6B4FAD', light: '#A87EDB', dim: 'rgba(107,79,173,0.35)' },
]

const PROGRESS = [0.8, 0.6, 0.7, 0.5, 0.45, 0.2, 0.0]

const SVG_W = LABEL_W + COL_W * 6 + 16
const SVG_H = TOP + TASKS.length * ROW_H + 36

function GanttIllustration() {
  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      className="gantt-illustration"
      aria-hidden="true"
    >
      {/* Alternating row tints */}
      {TASKS.map((_, i) => (
        <rect
          key={i}
          x={0} y={TOP + i * ROW_H}
          width={SVG_W} height={ROW_H}
          fill={i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'transparent'}
        />
      ))}

      {/* Vertical grid lines */}
      {Array.from({ length: 7 }, (_, i) => (
        <line
          key={i}
          x1={LABEL_W + i * COL_W} y1={TOP - 10}
          x2={LABEL_W + i * COL_W} y2={SVG_H - 8}
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="1"
        />
      ))}

      {/* Month labels */}
      {MONTHS.map((m, i) => (
        <text
          key={m}
          x={LABEL_W + i * COL_W + COL_W / 2}
          y={TOP - 16}
          textAnchor="middle"
          fill="rgba(255,255,255,0.38)"
          fontSize="9.5"
          fontFamily="system-ui, sans-serif"
          letterSpacing="0.1em"
          fontWeight="600"
        >
          {m}
        </text>
      ))}

      {/* Header separator */}
      <line
        x1={LABEL_W} y1={TOP - 4}
        x2={SVG_W - 8} y2={TOP - 4}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="1"
      />

      {/* Today marker */}
      {(() => {
        const tx = LABEL_W + 3.1 * COL_W
        return (
          <g>
            <line
              x1={tx} y1={TOP - 4}
              x2={tx} y2={SVG_H - 8}
              stroke="#C9A84C"
              strokeWidth="1.5"
              opacity="0.75"
            />
            <polygon
              points={`${tx - 5},${TOP - 12} ${tx + 5},${TOP - 12} ${tx},${TOP - 4}`}
              fill="#C9A84C"
              opacity="0.75"
            />
            <text
              x={tx + 7} y={TOP - 9}
              fill="#C9A84C"
              fontSize="8.5"
              fontFamily="system-ui, sans-serif"
              opacity="0.75"
              letterSpacing="0.06em"
              fontWeight="600"
            >
              OGGI
            </text>
          </g>
        )
      })()}

      {/* Task rows */}
      {TASKS.map(([label, startCol, spanCols, colorIdx], i) => {
        const colors = BAR_COLORS[colorIdx]
        const barX = LABEL_W + startCol * COL_W + 3
        const barY = TOP + i * ROW_H + 9
        const barW = spanCols * COL_W - 6
        const barH = ROW_H - 18
        const r = barH / 2
        const progW = barW * PROGRESS[i]

        return (
          <g key={label}>
            {/* Task name */}
            <text
              x={LABEL_W - 10}
              y={TOP + i * ROW_H + ROW_H / 2 + 4}
              textAnchor="end"
              fill="rgba(255,255,255,0.65)"
              fontSize="10.5"
              fontFamily="system-ui, sans-serif"
            >
              {label}
            </text>

            {/* Bar track */}
            <rect
              x={barX} y={barY}
              width={barW} height={barH}
              rx={r}
              fill={colors.dim}
            />

            {/* Progress fill */}
            {progW > 0 && (
              <>
                <rect
                  x={barX} y={barY}
                  width={progW} height={barH}
                  rx={r}
                  fill={colors.base}
                />
                {/* Shine */}
                <rect
                  x={barX + 2} y={barY + 1}
                  width={Math.max(progW - 4, 0)} height={barH / 2 - 1}
                  rx={r / 2}
                  fill="rgba(255,255,255,0.18)"
                />
              </>
            )}

            {/* Tail dot (for not-started tasks) */}
            {progW === 0 && (
              <circle
                cx={barX + r} cy={barY + barH / 2}
                r={r * 0.6}
                fill={colors.base}
                opacity="0.6"
              />
            )}
          </g>
        )
      })}

      {/* Dependency arrows (2 examples) */}
      {[
        [0, 1, 1.4],
        [3, 4, 1.8],
      ].map(([from, to, col], k) => {
        const x = LABEL_W + col * COL_W
        const y1 = TOP + from * ROW_H + ROW_H - 9
        const y2 = TOP + to * ROW_H + 9
        return (
          <g key={k} opacity="0.45">
            <line x1={x} y1={y1} x2={x} y2={y2} stroke="#C9A84C" strokeWidth="1" strokeDasharray="3,3" />
            <polygon
              points={`${x - 3},${y2 - 4} ${x + 3},${y2 - 4} ${x},${y2}`}
              fill="#C9A84C"
            />
          </g>
        )
      })}
    </svg>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────

interface LoginPageProps {
  onLogin: (token: string) => void
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed:    'Autenticazione fallita. Riprova.',
  no_code:         'Sessione OAuth interrotta. Riprova.',
  access_denied:   'Accesso negato. Hai annullato il login.',
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [authError, setAuthError] = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)

  const handleOAuthCallback = useCallback(() => {
    const params = new URLSearchParams(window.location.search)

    // Successo: token presente
    const token = params.get('token')
    if (token) {
      localStorage.setItem('auth_token', token)
      window.history.replaceState({}, document.title, window.location.pathname)
      onLogin(token)
      return
    }

    // Errore: il backend ha rediretto con auth_error
    const error = params.get('auth_error')
    if (error) {
      const msg = AUTH_ERROR_MESSAGES[error] ?? 'Errore sconosciuto. Riprova.'
      setAuthError(msg)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [onLogin])

  useEffect(() => {
    queueMicrotask(() => { handleOAuthCallback() })
  }, [handleOAuthCallback])

  const handleGoogleLogin = () => {
    if (!API_URL) {
      setAuthError('Configurazione mancante: VITE_API_URL non impostato.')
      return
    }
    setLoading(true)
    setAuthError(null)
    window.location.href = `${API_URL}/auth/google`
  }

  return (
    <main className="lp-root">
      {/* ── Left panel: Gantt illustration ── */}
      <section className="lp-illustration" aria-hidden="true">
        <div className="lp-ill-inner">
          <span className="lp-ill-eyebrow">PIANIFICAZIONE PROGETTI</span>
          <GanttIllustration />
          <div className="lp-metrics" aria-hidden="true">
            <div className="lp-metric">
              <span className="lp-metric-val">12</span>
              <span className="lp-metric-lbl">Progetti attivi</span>
            </div>
            <div className="lp-metric lp-metric--hi">
              <span className="lp-metric-val">87%</span>
              <span className="lp-metric-lbl">On Schedule</span>
            </div>
            <div className="lp-metric">
              <span className="lp-metric-val">4</span>
              <span className="lp-metric-lbl">Scadenze oggi</span>
            </div>
          </div>
          <p className="lp-ill-tagline">
            Visibilità completa sul progresso.<br />
            Collaborazione al centro.
          </p>
        </div>
      </section>

      {/* ── Right panel: Form ── */}
      <section className="lp-form" aria-label="Accesso a Tool Project Management">
        <div className="lp-form-inner">

          <header className="lp-brand">
            <div className="lp-brand-icon">
              <GanttBarIcon />
            </div>
            <div>
              <h1 className="lp-brand-name">TPM</h1>
              <p className="lp-brand-sub">Project Management Interno</p>
            </div>
          </header>

          <div className="lp-cta">
            <p className="lp-message">
              Accedi con il tuo account Google aziendale per gestire i progetti e visualizzare le timeline.
            </p>

            {authError && (
              <p className="lp-error" role="alert">
                ⚠ {authError}
              </p>
            )}

            <button
              className={`lp-google-btn${loading ? ' lp-google-btn--loading' : ''}`}
              onClick={handleGoogleLogin}
              type="button"
              disabled={loading}
              aria-label="Accedi con Google — avvia l'autenticazione tramite il tuo account Google aziendale"
            >
              <span className="lp-google-btn__icon">
                <GoogleIcon />
              </span>
              <span className="lp-google-btn__label">
                {loading ? 'Reindirizzamento…' : 'Accedi con Google'}
              </span>
              <span className="lp-google-btn__arrow" aria-hidden="true">→</span>
            </button>
          </div>

          <footer className="lp-footer">
            <p>Accesso riservato ai membri dell'organizzazione</p>
          </footer>

        </div>
      </section>
    </main>
  )
}
