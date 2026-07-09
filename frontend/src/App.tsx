import { useState, type ReactNode } from 'react'
import LoginPage             from './pages/LoginPage'
import TeamPage              from './pages/TeamPage'
import TeamAccountPage       from './pages/TeamAccountPage'
import ElencoAttivitaPage    from './pages/ElencoAttivitaPage'
import ClientiPage           from './pages/ClientiPage'
import ProgettiPage          from './pages/ProgettiPage'
import ImpostazioniPage      from './pages/ImpostazioniPage'
import GanttPage             from './pages/GanttPage'
import DashboardPage         from './pages/DashboardPage'
import RoadmapPage           from './pages/RoadmapPage'
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

function IconBuilding() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M3 18V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v13" strokeLinecap="round" />
      <path d="M1 18h18" strokeLinecap="round" />
      <rect x="7"  y="9"  width="2.5" height="2.5" rx="0.5" />
      <rect x="10.5" y="9"  width="2.5" height="2.5" rx="0.5" />
      <rect x="7"  y="13" width="2.5" height="2.5" rx="0.5" />
      <rect x="10.5" y="13" width="2.5" height="2.5" rx="0.5" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M2 6a2 2 0 0 1 2-2h3.586a1 1 0 0 1 .707.293L9.707 5.7A1 1 0 0 0 10.414 6H16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconRoadmap() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M2 10h4l2-6 4 12 2-6h4" strokeLinecap="round" strokeLinejoin="round" />
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

// ─── Sezione placeholder ─────────────────────────────────────────────────────

type NavPage = 'dashboard' | 'clienti' | 'progetti' | 'timeline' | 'attivita' | 'team-pm' | 'team-account' | 'roadmap' | 'impostazioni'

const PAGE_LABELS: Record<NavPage, string> = {
  dashboard:      'Dashboard',
  clienti:        'Anagrafica Clienti',
  progetti:       'Progetti & Prodotti',
  timeline:       'Gantt Attività',
  attivita:       'Elenco Attività',
  'team-pm':      'Anagrafica PM / PO',
  'team-account': 'Anagrafica Account',
  roadmap:        'Roadmap Prodotti',
  impostazioni:   'Impostazioni',
}

function PlaceholderPage({ page }: { page: Exclude<NavPage, 'dashboard' | 'attivita' | 'clienti' | 'progetti'> }) {
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

// ─── Utente loggato (decodificato dal JWT) ──────────────────────────────────

interface JwtUser {
  name?: string
  email?: string
}

function decodeJwtPayload(token: string): JwtUser | null {
  try {
    const base64 = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function getInitials(user: JwtUser | null): string {
  const source = user?.name?.trim() || user?.email?.trim()
  if (!source) return '?'
  const parts = source.split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'
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

  const user = decodeJwtPayload(token)

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
        <div className="db-sidebar-brand" aria-label="TPM">
          <BrandMark />
        </div>

        <div className="db-sidebar-nav">
          {navBtn('dashboard',     'Dashboard',            <IconGrid />)}
          {navBtn('attivita',      'Elenco Attività',      <IconClipboard />)}
          {/* Gantt nascosto dalla nav — pagina e routing rimangono attivi, vedi riga con GanttPage più sotto */}
          {navBtn('team-pm',       'Anagrafica PM / PO',   <IconUsers />)}
          {navBtn('team-account',  'Anagrafica Account',   <IconAccount />)}
          {navBtn('clienti',       'Anagrafica Clienti',   <IconBuilding />)}
          {navBtn('progetti',      'Progetti & Prodotti',  <IconFolder />)}
          {navBtn('roadmap',       'Roadmap Prodotti',     <IconRoadmap />)}
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
            <span className="db-header-app">TPM</span>
            <span className="db-header-divider" aria-hidden="true">/</span>
            <span className="db-header-page">{PAGE_LABELS[page]}</span>
          </div>
          <div className="db-header-right">
            <div className="db-avatar" aria-label={user?.name ? `Profilo di ${user.name}` : 'Profilo utente'} title={user?.name ?? user?.email}>
              {getInitials(user)}
            </div>
          </div>
        </header>

        {/* Content */}
        {page === 'dashboard'     && <DashboardPage         token={token} onNavigate={(p) => setPage(p as NavPage)} />}
        {page === 'clienti'       && <ClientiPage           token={token} />}
        {page === 'progetti'      && <ProgettiPage          token={token} />}
        {page === 'team-pm'       && <TeamPage              token={token} />}
        {page === 'team-account'  && <TeamAccountPage       token={token} />}
        {page === 'attivita'      && <ElencoAttivitaPage    token={token} />}
        {page === 'roadmap'       && <RoadmapPage           token={token} />}
        {page === 'impostazioni'  && <ImpostazioniPage      token={token} />}
        {page === 'timeline'      && <GanttPage             token={token} />}
        {page !== 'dashboard' && page !== 'clienti' && page !== 'progetti' && page !== 'team-pm' && page !== 'team-account' && page !== 'attivita' && page !== 'roadmap' && page !== 'impostazioni' && page !== 'timeline' && (
          <PlaceholderPage page={page} />
        )}
      </div>
    </div>
  )
}
