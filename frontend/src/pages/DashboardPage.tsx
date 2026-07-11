import { useState, useEffect, useMemo } from 'react'
import './DashboardPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatoConfigItem {
  id: string
  chiave: string
  label: string
  colore: string
  isArchiviato: boolean
  ordine: number
}

interface AttivitaItem {
  id: string
  cliente: string
  progetto: string
  attivita: string
  stato: string
  inizio: string | null
  deadline: string | null
  account: string
  projectManager: string
  giornateVendute: number | null
  giornateConsuntivate: number | null
}

interface GruppoAttivita {
  cliente: string
  progetto: string
  account: string
  projectManager: string
  attivita: AttivitaItem[]
}

interface AttivitaResponse {
  gruppi: GruppoAttivita[]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface DashboardPageProps {
  token: string
  onNavigate: (page: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESI_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function fmtDate(d: Date): string {
  return `${d.getDate()} ${MESI_IT[d.getMonth()]}`
}

function parseDate(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ width, height, radius }: { width?: string; height?: string; radius?: string }) {
  return (
    <div
      className="dash-skeleton"
      style={{ width: width ?? '100%', height: height ?? '1rem', borderRadius: radius ?? '6px' }}
    />
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: number | null
  color: string
  icon: React.ReactNode
  loading: boolean
}

function KpiCard({ label, value, color, icon, loading }: KpiCardProps) {
  return (
    <div className="dash-kpi-card">
      <div className="dash-kpi-icon" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="dash-kpi-body">
        <span className="dash-kpi-label">{label}</span>
        {loading ? (
          <Skeleton width="60px" height="36px" radius="8px" />
        ) : (
          <span className="dash-kpi-value" style={{ color }}>
            {value ?? 0}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Activity Row ─────────────────────────────────────────────────────────────

interface ActivityRowProps {
  item: AttivitaItem
  statiMap: Map<string, StatoConfigItem>
}

function ActivityRow({ item, statiMap }: ActivityRowProps) {
  const stato = statiMap.get(item.stato)
  const deadlineDate = parseDate(item.deadline)

  return (
    <div className="dash-activity-row">
      <span
        className="dash-state-badge"
        style={{ background: stato ? `${stato.colore}22` : '#e2e8f080', color: stato?.colore ?? '#64748b' }}
      >
        {stato?.label ?? item.stato}
      </span>
      <div className="dash-activity-info">
        <span className="dash-activity-name">{item.attivita}</span>
        <span className="dash-activity-meta">
          {item.cliente} · {item.progetto}
        </span>
      </div>
      {deadlineDate && (
        <span className="dash-activity-deadline">{fmtDate(deadlineDate)}</span>
      )}
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyList({ message }: { message: string }) {
  return (
    <div className="dash-empty">
      <svg viewBox="0 0 20 20" fill="none" width="20" height="20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" stroke="#22c55e" strokeWidth="1.5" />
        <path d="M6.5 10l2.5 2.5 4.5-4.5" stroke="#22c55e" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{message}</span>
    </div>
  )
}

// ─── Shortcut Card ────────────────────────────────────────────────────────────

interface ShortcutCardProps {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

function ShortcutCard({ label, icon, onClick }: ShortcutCardProps) {
  return (
    <button className="dash-shortcut-card" onClick={onClick} type="button">
      <span className="dash-shortcut-icon">{icon}</span>
      <span className="dash-shortcut-label">{label}</span>
      <svg className="dash-shortcut-arrow" viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden="true">
        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconList() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="20" height="20" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h9" strokeLinecap="round" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="20" height="20" aria-hidden="true">
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

function IconBuilding() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="20" height="20" aria-hidden="true">
      <path d="M3 18V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v13" strokeLinecap="round" />
      <path d="M1 18h18" strokeLinecap="round" />
      <rect x="7"  y="9"  width="2.5" height="2.5" rx="0.5" />
      <rect x="10.5" y="9"  width="2.5" height="2.5" rx="0.5" />
      <rect x="7"  y="13" width="2.5" height="2.5" rx="0.5" />
      <rect x="10.5" y="13" width="2.5" height="2.5" rx="0.5" />
    </svg>
  )
}

function IconActivity() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="20" height="20" aria-hidden="true">
      <path d="M2 10h3l2-6 4 12 2-6h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconAlert() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v4M10 13.5v.5" strokeLinecap="round" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DashboardPage({ token, onNavigate }: DashboardPageProps) {
  const [gruppi, setGruppi] = useState<GruppoAttivita[]>([])
  const [stati, setStati] = useState<StatoConfigItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const headers = { Authorization: `Bearer ${token}` }

    Promise.all([
      fetch(`${API_URL}/api/attivita`, { headers })
        .then(r => r.ok ? r.json() as Promise<AttivitaResponse> : Promise.reject(r))
        .catch(() => ({ gruppi: [] } as AttivitaResponse)),
      fetch(`${API_URL}/api/stati-attivita`, { headers })
        .then(r => r.ok ? r.json() as Promise<StatoConfigItem[]> : Promise.reject(r))
        .catch(() => [] as StatoConfigItem[]),
    ]).then(([attivitaResp, statiResp]) => {
      setGruppi(attivitaResp.gruppi ?? [])
      setStati(statiResp ?? [])
      setLoading(false)
    })
  }, [token])

  const statiMap = useMemo(() => {
    const m = new Map<string, StatoConfigItem>()
    stati.forEach(s => m.set(s.chiave, s))
    return m
  }, [stati])

  const archiviatiSet = useMemo(() => {
    const s = new Set<string>()
    stati.filter(st => st.isArchiviato).forEach(st => s.add(st.chiave))
    return s
  }, [stati])

  const allAttivita = useMemo(
    () => gruppi.flatMap(g => g.attivita),
    [gruppi]
  )

  const today = useMemo(() => stripTime(new Date()), [])
  const in7days = useMemo(() => {
    const d = new Date(today)
    d.setDate(d.getDate() + 7)
    return d
  }, [today])

  const { attiveCount, clientiCount, inScadenzaList, inRitardoList } = useMemo(() => {
    const attive = allAttivita.filter(a => !archiviatiSet.has(a.stato))

    const attiveCount = attive.length

    const clientiSet = new Set(attive.map(a => a.cliente))
    const clientiCount = clientiSet.size

    const inScadenzaList = attive
      .filter(a => {
        const d = parseDate(a.deadline)
        if (!d) return false
        const ds = stripTime(d)
        return ds >= today && ds <= in7days
      })
      .sort((a, b) => {
        const da = parseDate(a.deadline)!
        const db = parseDate(b.deadline)!
        return da.getTime() - db.getTime()
      })
      .slice(0, 6)

    const inRitardoList = attive
      .filter(a => {
        const d = parseDate(a.deadline)
        if (!d) return false
        const ds = stripTime(d)
        return ds < today
      })
      .sort((a, b) => {
        const da = parseDate(a.deadline)!
        const db = parseDate(b.deadline)!
        return da.getTime() - db.getTime()
      })
      .slice(0, 6)

    return { attiveCount, clientiCount, inScadenzaList, inRitardoList }
  }, [allAttivita, archiviatiSet, today, in7days])

  return (
    <div className="dash-page">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-subtitle">Panoramica attività e scadenze</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dash-kpi-grid">
        <KpiCard
          label="Attività attive"
          value={attiveCount}
          color="#0D9488"
          loading={loading}
          icon={<IconActivity />}
        />
        <KpiCard
          label="Clienti"
          value={clientiCount}
          color="#3B82F6"
          loading={loading}
          icon={<IconUsers />}
        />
        <KpiCard
          label="In scadenza"
          value={inScadenzaList.length}
          color="#F59E0B"
          loading={loading}
          icon={<IconClock />}
        />
        <KpiCard
          label="In ritardo"
          value={inRitardoList.length}
          color="#EF4444"
          loading={loading}
          icon={<IconAlert />}
        />
      </div>

      {/* Lists */}
      <div className="dash-lists-grid">
        {/* In scadenza */}
        <div className="dash-list-section">
          <div className="dash-section-header">
            <span className="dash-section-title">In scadenza (7 giorni)</span>
            <span className="dash-section-count dash-section-count--amber">
              {inScadenzaList.length}
            </span>
          </div>
          <div className="dash-list">
            {loading ? (
              Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="dash-skeleton-row">
                  <Skeleton width="56px" height="22px" radius="20px" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <Skeleton width="70%" height="14px" />
                    <Skeleton width="50%" height="12px" />
                  </div>
                  <Skeleton width="40px" height="14px" />
                </div>
              ))
            ) : inScadenzaList.length === 0 ? (
              <EmptyList message="Nessuna attività in scadenza" />
            ) : (
              inScadenzaList.map(a => (
                <ActivityRow key={a.id} item={a} statiMap={statiMap} />
              ))
            )}
          </div>
        </div>

        {/* In ritardo */}
        <div className="dash-list-section">
          <div className="dash-section-header">
            <span className="dash-section-title">In ritardo</span>
            <span className="dash-section-count dash-section-count--red">
              {inRitardoList.length}
            </span>
          </div>
          <div className="dash-list">
            {loading ? (
              Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="dash-skeleton-row">
                  <Skeleton width="56px" height="22px" radius="20px" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <Skeleton width="70%" height="14px" />
                    <Skeleton width="50%" height="12px" />
                  </div>
                  <Skeleton width="40px" height="14px" />
                </div>
              ))
            ) : inRitardoList.length === 0 ? (
              <EmptyList message="Nessuna attività in ritardo" />
            ) : (
              inRitardoList.map(a => (
                <ActivityRow key={a.id} item={a} statiMap={statiMap} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Shortcuts */}
      <div className="dash-shortcuts-header">
        <span className="dash-section-title">Scorciatoie</span>
      </div>
      <div className="dash-shortcuts-grid">
        <ShortcutCard
          label="Elenco Attività"
          icon={<IconList />}
          onClick={() => onNavigate('attivita')}
        />
        <ShortcutCard
          label="Roadmap Prodotti"
          icon={<IconRoadmap />}
          onClick={() => onNavigate('roadmap')}
        />
        <ShortcutCard
          label="Progetti & Prodotti"
          icon={<IconFolder />}
          onClick={() => onNavigate('progetti')}
        />
        <ShortcutCard
          label="Anagrafica Clienti"
          icon={<IconBuilding />}
          onClick={() => onNavigate('clienti')}
        />
      </div>
    </div>
  )
}
