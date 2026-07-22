import { useEffect, useState, type ReactNode } from 'react'
import LoginPage             from './pages/LoginPage'
import NonAutorizzatoPage    from './pages/NonAutorizzatoPage'
import UtentiPage            from './pages/UtentiPage'
import ElencoAttivitaPage    from './pages/ElencoAttivitaPage'
import ClientiPage           from './pages/ClientiPage'
import ProgettiPage          from './pages/ProgettiPage'
import ImpostazioniPage      from './pages/ImpostazioniPage'
import GanttPage             from './pages/GanttPage'
import DashboardPage         from './pages/DashboardPage'
import RoadmapPage           from './pages/RoadmapPage'
import PresalePage           from './pages/PresalePage'
import ConsuntiviZohoPage    from './pages/ConsuntiviZohoPage'
import ContrattiPage         from './pages/ContrattiPage'
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

function IconTimeLog() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
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

function IconPresale() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M2.5 4h15l-5.5 6.5V17l-4-2v-4.5L2.5 4z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconContract() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
      width="20" height="20" aria-hidden="true">
      <path d="M6 2h6.586a1 1 0 0 1 .707.293l2.414 2.414a1 1 0 0 1 .293.707V17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 8h5M8 11h5M8 14h2.5" strokeLinecap="round" />
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

type NavPage = 'dashboard' | 'clienti' | 'progetti' | 'timeline' | 'attivita' | 'presale' | 'consuntivi' | 'contratti' | 'utenti' | 'roadmap' | 'impostazioni'

const PAGE_LABELS: Record<NavPage, string> = {
  dashboard:    'Dashboard',
  clienti:      'Anagrafica Clienti',
  progetti:     'Progetti & Prodotti',
  timeline:     'Gantt Attività',
  attivita:     'Attività Progetti / Prodotti',
  presale:      'Presale',
  consuntivi:   'Consuntivi Zoho',
  contratti:    'Contratti Assistenza',
  utenti:       'Anagrafica Utenti',
  roadmap:      'Roadmap Prodotti',
  impostazioni: 'Impostazioni',
}

function PlaceholderPage({ page }: { page: Exclude<NavPage, 'dashboard' | 'attivita' | 'presale' | 'clienti' | 'progetti'> }) {
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

// ─── Utente loggato (decodificato dal JWT, poi rifinito da /auth/me) ────────

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

type Role = 'ACCOUNT' | 'PM' | 'BOARD' | 'DEVHUB'

const ROLE_META: Record<Role, { label: string; className: string }> = {
  ACCOUNT: { label: 'Account', className: 'db-role-chip--account' },
  PM:      { label: 'PM',      className: 'db-role-chip--pm' },
  BOARD:   { label: 'Board',   className: 'db-role-chip--board' },
  DEVHUB:  { label: 'DevHub',  className: 'db-role-chip--devhub' },
}

interface JwtUser {
  name?: string
  email?: string
  roles?: Role[]
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

function RoleChips({ roles }: { roles: Role[] }) {
  if (roles.length === 0) return <span className="db-role-chip-empty">Nessun ruolo assegnato</span>
  return (
    <div className="db-role-chips">
      {roles.map((r) => (
        <span key={r} className={`db-role-chip ${ROLE_META[r].className}`}>{ROLE_META[r].label}</span>
      ))}
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('auth_token')
  )
  const [page, setPage] = useState<NavPage>('dashboard')
  const [fetchedRoles, setFetchedRoles] = useState<{ token: string; roles: Role[] } | null>(null)
  const [fetchedAuth, setFetchedAuth] = useState<{ token: string; status: 'authorized' | 'unauthorized' } | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const handleLogin  = (t: string) => setToken(t)
  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    setToken(null)
  }

  // Verifica lo stato dell'utente su /auth/me (fonte di verità sul DB):
  // - 200 → utente censito e attivo, rifinisce anche i ruoli (che nel JWT
  //   potrebbero essere fino a 7gg stantii) così un cambio ruoli/disabilitazione
  //   lato Board si riflette senza attendere la scadenza del token
  // - 403 → token valido ma utente non censito o disabilitato → pagina bloccata
  // - 401 → token invalido/scaduto → si torna al login
  // authStatus è derivato a render-time da fetchedAuth (mai settato in modo
  // sincrono nel corpo dell'effect): finché fetchedAuth non è per il token
  // corrente, lo stato resta "checking".
  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (cancelled) return
        if (r.ok) {
          const data = (await r.json()) as { user?: { roles?: Role[] } }
          if (data?.user?.roles) setFetchedRoles({ token, roles: data.user.roles })
          setFetchedAuth({ token, status: 'authorized' })
        } else if (r.status === 403) {
          setFetchedAuth({ token, status: 'unauthorized' })
        } else {
          handleLogout()
        }
      })
      .catch(() => { if (!cancelled) setFetchedAuth({ token, status: 'authorized' }) })
    return () => { cancelled = true }
  }, [token])

  if (!token) return <LoginPage onLogin={handleLogin} />

  const user = decodeJwtPayload(token)
  const authStatus = fetchedAuth?.token === token ? fetchedAuth.status : 'checking'

  if (authStatus === 'checking') return null
  if (authStatus === 'unauthorized') {
    return <NonAutorizzatoPage email={user?.email} onBackToLogin={handleLogout} />
  }
  const roles = fetchedRoles?.token === token ? fetchedRoles.roles : (user?.roles ?? [])
  const isBoard = roles.includes('BOARD')
  const isDevHub = roles.includes('DEVHUB')
  // Consuntivi Zoho: import consuntivazioni, riservato a Board/PM/Account
  // (stesso gating delle route /api/zoho/* lato backend)
  const canConsuntivi = isBoard || roles.includes('PM') || roles.includes('ACCOUNT')
  // Contratti assistenza/AMS: stesso gating (route /api/contratti lato backend)
  const canContratti = canConsuntivi
  // Presale: visibile a Board/PM/Account, stesso gating di Consuntivi e Contratti
  const canPresale = canConsuntivi

  // Dashboard, Anagrafica Clienti e Progetti & Prodotti sono nascoste per il
  // ruolo DevHub. `page` può comunque puntare a una di queste (stato iniziale
  // di default, o residuo da prima che i ruoli fossero noti): si calcola una
  // pagina "effettiva" per contenuto/header/nav-attiva, senza bisogno di un
  // effect (che violerebbe le regole degli hook dopo i return sopra).
  const devHubHiddenPages: NavPage[] = ['dashboard', 'clienti', 'progetti']
  const effectivePage: NavPage = isDevHub && devHubHiddenPages.includes(page) ? 'attivita' : page

  const navBtn = (id: NavPage, label: string, icon: ReactNode) => (
    <button
      className={`db-nav-btn${effectivePage === id ? ' db-nav-btn--active' : ''}`}
      type="button" title={label} aria-label={label}
      aria-current={effectivePage === id ? 'page' : undefined}
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
          {!isDevHub && navBtn('dashboard', 'Dashboard',            <IconGrid />)}
          {canPresale && navBtn('presale', 'Presale',      <IconPresale />)}
          {navBtn('roadmap',       'Roadmap Prodotti',     <IconRoadmap />)}
          {navBtn('attivita',      'Attività Progetti / Prodotti', <IconClipboard />)}
          {canContratti && navBtn('contratti', 'Contratti Assistenza', <IconContract />)}
          {/* Gantt nascosto dalla nav — pagina e routing rimangono attivi, vedi riga con GanttPage più sotto */}
          {!isDevHub && navBtn('clienti',   'Anagrafica Clienti',   <IconBuilding />)}
          {!isDevHub && navBtn('progetti',  'Progetti & Prodotti',  <IconFolder />)}
        </div>

        <div className="db-sidebar-foot">
          {canConsuntivi && navBtn('consuntivi', 'Consuntivi Zoho',   <IconTimeLog />)}
          {isBoard && navBtn('utenti',        'Anagrafica Utenti',    <IconUsers />)}
          {isBoard && navBtn('impostazioni', 'Impostazioni',   <IconSettings />)}
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
            <span className="db-header-page">{PAGE_LABELS[effectivePage]}</span>
          </div>
          <div className="db-header-right">
            <div className="db-user-menu">
              <button
                type="button"
                className="db-avatar"
                aria-label={user?.name ? `Profilo di ${user.name}` : 'Profilo utente'}
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
                title={user?.name ?? user?.email}
                onClick={() => setUserMenuOpen((o) => !o)}
              >
                {getInitials(user)}
              </button>

              {userMenuOpen && (
                <>
                  <div className="db-user-menu-overlay" onClick={() => setUserMenuOpen(false)} />
                  <div className="db-user-menu-panel" role="menu">
                    <div className="db-user-menu-identity">
                      <span className="db-user-menu-name">{user?.name || 'Utente'}</span>
                      {user?.email && <span className="db-user-menu-email">{user.email}</span>}
                    </div>
                    <div className="db-user-menu-roles">
                      <span className="db-user-menu-roles-label">Ruoli</span>
                      <RoleChips roles={roles} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        {effectivePage === 'dashboard'     && <DashboardPage         token={token} onNavigate={(p) => setPage(p as NavPage)} />}
        {effectivePage === 'clienti'       && <ClientiPage           token={token} />}
        {effectivePage === 'progetti'      && <ProgettiPage          token={token} />}
        {effectivePage === 'utenti'        && <UtentiPage            token={token} />}
        {effectivePage === 'attivita'      && <ElencoAttivitaPage    token={token} readOnly={isDevHub} />}
        {effectivePage === 'presale'       && canPresale && <PresalePage token={token} />}
        {effectivePage === 'consuntivi'    && canConsuntivi && <ConsuntiviZohoPage token={token} />}
        {effectivePage === 'contratti'     && canContratti && <ContrattiPage token={token} />}
        {effectivePage === 'roadmap'       && <RoadmapPage           token={token} readOnly={isDevHub} />}
        {effectivePage === 'impostazioni'  && <ImpostazioniPage      token={token} showPresaleEmail={isBoard} />}
        {effectivePage === 'timeline'      && <GanttPage             token={token} />}
        {effectivePage !== 'dashboard' && effectivePage !== 'clienti' && effectivePage !== 'progetti' && effectivePage !== 'utenti' && effectivePage !== 'attivita' && effectivePage !== 'presale' && effectivePage !== 'consuntivi' && effectivePage !== 'contratti' && effectivePage !== 'roadmap' && effectivePage !== 'impostazioni' && effectivePage !== 'timeline' && (
          <PlaceholderPage page={effectivePage} />
        )}
      </div>
    </div>
  )
}
