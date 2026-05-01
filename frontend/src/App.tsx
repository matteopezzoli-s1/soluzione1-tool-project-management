import { useState, type ReactNode } from 'react'
import LoginPage             from './pages/LoginPage'
import TeamPage              from './pages/TeamPage'
import TeamAccountPage       from './pages/TeamAccountPage'
import ElencoAttivitaPage    from './pages/ElencoAttivitaPage'
import './App.css'

// ─── Sidebar icons ──────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <rect x="2"    y="2"    width="6.5" height="6.5" rx="1.5" />
      <rect x="11.5" y="2"    width="6.5" height="6.5" rx="1.5" />
      <rect x="2"    y="11.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="11.5" y="11.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  )
}

function IconBars() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <rect x="2" y="4"  width="10" height="3" rx="1.5" />
      <rect x="5" y="9"  width="13" height="3" rx="1.5" />
      <rect x="3" y="14" width="11" height="3" rx="1.5" />
    </svg>
  )
}

function IconTimeline() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h9" strokeLinecap="round" />
      <circle cx="7"  cy="5"  r="2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="2" fill="currentColor" stroke="none" />
      <circle cx="9"  cy="15" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.5 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 17a9.953 9.953 0 0 1-5.385-1.572zM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 4.575.8.8 0 0 1-.36.734A7.506 7.506 0 0 1 14.5 16z" />
    </svg>
  )
}

function IconAccount() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-7 9a7 7 0 1 1 14 0H3z" clipRule="evenodd" />
    </svg>
  )
}

function IconClipboard() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M8 3H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-3"
        strokeLinecap="round" strokeLinejoin="round" />
      <rect x="7" y="2" width="6" height="3" rx="1" strokeLinecap="round" />
      <path d="M7 9h6M7 12h4" strokeLinecap="round" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
      <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M7 17H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3M13 14l4-4-4-4M17 10H7"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BrandMark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" width="22" height="22" aria-hidden="true">
      <rect x="2" y="5"  width="16" height="4" rx="2" fill="#F59E0B" />
      <rect x="7" y="12" width="14" height="4" rx="2" fill="#14B8A6" />
      <rect x="4" y="19" width="18" height="4" rx="2" fill="#F59E0B" opacity="0.7" />
    </svg>
  )
}

// ─── Mini Gantt preview (light-background version) ──────────────────────────

function GanttPreview() {
  const LABEL_W = 78
  const COL_W   = 52
  const ROW_H   = 30
  const TOP     = 34

  type TaskEntry = [label: string, startCol: number, spanCols: number, color: 0 | 1 | 2]
  const TASKS: TaskEntry[] = [
    ['E-Commerce', 0.0, 2.2, 0],
    ['App Mobile', 0.5, 1.8, 1],
    ['CRM Interno', 1.2, 2.4, 0],
    ['Portal HR',   1.8, 1.6, 2],
    ['API Gateway', 2.2, 2.0, 1],
  ]
  const MONTHS = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU']
  const COLORS = [
    { base: '#F59E0B', dim: 'rgba(245,158,11,0.2)' },
    { base: '#0D9488', dim: 'rgba(13,148,136,0.2)'  },
    { base: '#6366F1', dim: 'rgba(99,102,241,0.2)'  },
  ]
  const PROGRESS = [0.8, 0.6, 0.7, 0.5, 0.45]
  const SVG_W = LABEL_W + COL_W * 6 + 12
  const SVG_H = TOP + TASKS.length * ROW_H + 22

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="db-gantt-svg" aria-hidden="true">
      {TASKS.map((_, i) => (
        <rect key={i} x={0} y={TOP + i * ROW_H} width={SVG_W} height={ROW_H}
          fill={i % 2 === 0 ? 'rgba(13,148,136,0.05)' : 'transparent'} />
      ))}

      {Array.from({ length: 7 }, (_, i) => (
        <line key={i}
          x1={LABEL_W + i * COL_W} y1={TOP - 6}
          x2={LABEL_W + i * COL_W} y2={SVG_H - 4}
          stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
      ))}

      {MONTHS.map((m, i) => (
        <text key={m}
          x={LABEL_W + i * COL_W + COL_W / 2} y={TOP - 12}
          textAnchor="middle" fill="rgba(71,85,105,0.55)"
          fontSize="8" fontFamily="system-ui" letterSpacing="0.1em" fontWeight="600">
          {m}
        </text>
      ))}

      <line x1={LABEL_W} y1={TOP - 3} x2={SVG_W - 5} y2={TOP - 3}
        stroke="rgba(0,0,0,0.08)" strokeWidth="1" />

      {(() => {
        const tx = LABEL_W + 3.1 * COL_W
        return (
          <g>
            <line x1={tx} y1={TOP - 3} x2={tx} y2={SVG_H - 4}
              stroke="#0D9488" strokeWidth="1.5" opacity="0.65" />
            <polygon points={`${tx - 4},${TOP - 9} ${tx + 4},${TOP - 9} ${tx},${TOP - 3}`}
              fill="#0D9488" opacity="0.65" />
          </g>
        )
      })()}

      {TASKS.map(([label, startCol, spanCols, colorIdx], i) => {
        const c     = COLORS[colorIdx]
        const barX  = LABEL_W + startCol * COL_W + 3
        const barY  = TOP + i * ROW_H + 7
        const barW  = spanCols * COL_W - 6
        const barH  = ROW_H - 14
        const r     = barH / 2
        const progW = barW * PROGRESS[i]
        return (
          <g key={label}>
            <text x={LABEL_W - 7} y={TOP + i * ROW_H + ROW_H / 2 + 3.5}
              textAnchor="end" fill="rgba(30,41,59,0.6)"
              fontSize="8.5" fontFamily="system-ui">
              {label}
            </text>
            <rect x={barX} y={barY} width={barW} height={barH} rx={r} fill={c.dim} />
            {progW > 0 && (
              <>
                <rect x={barX} y={barY} width={progW} height={barH} rx={r} fill={c.base} />
                <rect x={barX + 2} y={barY + 1}
                  width={Math.max(progW - 4, 0)} height={barH / 2 - 1}
                  rx={r / 2} fill="rgba(255,255,255,0.25)" />
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Sezione placeholder ─────────────────────────────────────────────────────

type NavPage = 'dashboard' | 'progetti' | 'timeline' | 'attivita' | 'team-pm' | 'team-account' | 'impostazioni'

const PAGE_LABELS: Record<NavPage, string> = {
  dashboard:      'Dashboard',
  progetti:       'Progetti',
  timeline:       'Gantt',
  attivita:       'Elenco Attività',
  'team-pm':      'Team PM',
  'team-account': 'Team Account',
  impostazioni:   'Impostazioni',
}

function PlaceholderPage({ page }: { page: Exclude<NavPage, 'dashboard' | 'attivita'> }) {
  return (
    <div className="db-placeholder">
      <div className="db-placeholder-inner">
        <div className="db-placeholder-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
            <rect x="4" y="10" width="26" height="6"  rx="3" fill="#0D9488" opacity="0.6" />
            <rect x="10" y="22" width="28" height="6" rx="3" fill="#F59E0B" opacity="0.5" />
            <rect x="6"  y="34" width="22" height="6" rx="3" fill="#0D9488" opacity="0.35" />
          </svg>
        </div>
        <h2 className="db-placeholder-title">{PAGE_LABELS[page]}</h2>
        <p className="db-placeholder-desc">Questa sezione è in sviluppo e sarà disponibile a breve.</p>
      </div>
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('auth_token')
  )
  const [page, setPage] = useState<NavPage>('dashboard')

  const handleLogin  = (t: string) => setToken(t)
  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    setToken(null)
  }

  if (!token) return <LoginPage onLogin={handleLogin} />

  const navBtn = (id: NavPage, label: string, icon: ReactNode) => (
    <button
      className={`db-nav-btn${page === id ? ' db-nav-btn--active' : ''}`}
      type="button" title={label} aria-label={label}
      aria-current={page === id ? 'page' : undefined}
      onClick={() => setPage(id)}
    >
      {icon}
    </button>
  )

  return (
    <div className="db-shell">

      {/* ── Sidebar ── */}
      <nav className="db-sidebar" aria-label="Navigazione principale">
        <div className="db-sidebar-brand" aria-label="s1 Gantt">
          <BrandMark />
        </div>

        <div className="db-sidebar-nav">
          {navBtn('dashboard',     'Dashboard',      <IconGrid />)}
          {navBtn('progetti',      'Progetti',       <IconBars />)}
          {navBtn('timeline',      'Gantt',          <IconTimeline />)}
          {navBtn('attivita',      'Elenco Attività', <IconClipboard />)}
          {navBtn('team-pm',       'Team PM',        <IconUsers />)}
          {navBtn('team-account',  'Team Account',   <IconAccount />)}
        </div>

        <div className="db-sidebar-foot">
          {navBtn('impostazioni', 'Impostazioni',   <IconSettings />)}
          <button className="db-nav-btn db-nav-btn--logout" type="button"
            title="Esci" aria-label="Esci dall'applicazione" onClick={handleLogout}>
            <IconLogout />
          </button>
        </div>
      </nav>

      {/* ── Main body ── */}
      <div className="db-body">

        {/* Top bar */}
        <header className="db-header">
          <div className="db-header-left">
            <span className="db-header-app">s1 Gantt</span>
            <span className="db-header-divider" aria-hidden="true">/</span>
            <span className="db-header-page">{PAGE_LABELS[page]}</span>
          </div>
          <div className="db-header-right">
            <div className="db-avatar" aria-label="Profilo utente">MP</div>
          </div>
        </header>

        {/* Content */}
        {page === 'team-pm'      && <TeamPage              token={token} />}
        {page === 'team-account' && <TeamAccountPage       token={token} />}
        {page === 'attivita'     && <ElencoAttivitaPage    token={token} />}
        {page !== 'dashboard' && page !== 'team-pm' && page !== 'team-account' && page !== 'attivita' && (
          <PlaceholderPage page={page} />
        )}
        <main className="db-content" style={page !== 'dashboard' ? { display: 'none' } : undefined}>

          {/* Hero card */}
          <div className="db-hero">
            <div className="db-hero-text">
              <span className="db-hero-badge">In arrivo</span>
              <h1 className="db-hero-title">
                La tua vista Gantt<br />
                <span className="db-hero-title--accent">sta arrivando</span>
              </h1>
              <p className="db-hero-desc">
                Timeline interattive, milestone e collaborazione in tempo reale — tutto in un unico posto.
              </p>
              <ul className="db-features" aria-label="Funzionalità in arrivo">
                <li className="db-feature">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75"
                    width="14" height="14" aria-hidden="true">
                    <rect x="1" y="4"  width="8"  height="2.5" rx="1.25" />
                    <rect x="4" y="8"  width="10" height="2.5" rx="1.25" />
                    <rect x="2" y="12" width="9"  height="2.5" rx="1.25" />
                  </svg>
                  Timeline Gantt
                </li>
                <li className="db-feature">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75"
                    width="14" height="14" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 5v3l2 1.5" strokeLinecap="round" />
                  </svg>
                  Milestones
                </li>
                <li className="db-feature">
                  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true">
                    <path d="M5.5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm5.5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM1.42 13.14A.96.96 0 0 1 .97 12.22a5 5 0 0 1 9.94 0c.048.39-.144.766-.474.977A8.3 8.3 0 0 1 5.5 14a8.3 8.3 0 0 1-4.08-1.86zM12 13h-.088c.058-.248.073-.51.04-.777a6.23 6.23 0 0 0-1.324-3.13 3.75 3.75 0 0 1 4.895 3.813.667.667 0 0 1-.3.611A6.255 6.255 0 0 1 12 13.5V13z" />
                  </svg>
                  Team & Collaborazione
                </li>
              </ul>
            </div>

            <div className="db-hero-preview" aria-hidden="true">
              <GanttPreview />
            </div>
          </div>

          {/* KPI cards */}
          <div className="db-kpis" aria-label="Metriche principali">
            <div className="db-kpi">
              <div className="db-kpi-label">Progetti Attivi</div>
              <div className="db-kpi-val db-kpi-val--teal">—</div>
              <div className="db-kpi-sub">Dati non ancora disponibili</div>
              <div className="db-kpi-bar db-kpi-bar--teal" />
            </div>
            <div className="db-kpi">
              <div className="db-kpi-label">Task Completate</div>
              <div className="db-kpi-val db-kpi-val--amber">—</div>
              <div className="db-kpi-sub">Dati non ancora disponibili</div>
              <div className="db-kpi-bar db-kpi-bar--amber" />
            </div>
            <div className="db-kpi">
              <div className="db-kpi-label">In Ritardo</div>
              <div className="db-kpi-val db-kpi-val--indigo">—</div>
              <div className="db-kpi-sub">Dati non ancora disponibili</div>
              <div className="db-kpi-bar db-kpi-bar--indigo" />
            </div>
            <div className="db-kpi">
              <div className="db-kpi-label">Membri Team</div>
              <div className="db-kpi-val db-kpi-val--sky">—</div>
              <div className="db-kpi-sub">Dati non ancora disponibili</div>
              <div className="db-kpi-bar db-kpi-bar--sky" />
            </div>
          </div>

        </main>
      </div>
    </div>
  )
}
