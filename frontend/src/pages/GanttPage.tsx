import {
  useState, useEffect, useCallback, useMemo, useRef, memo
} from 'react'
import './GanttPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttivitaRaw {
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

interface GruppoRaw {
  cliente: string
  progetto: string
  account: string
  projectManager: string
  attivita: AttivitaRaw[]
}

interface StatoConfig {
  id: string; chiave: string; label: string
  colore: string; isArchiviato: boolean; ordine: number
}

interface GanttMilestone {
  id: string; activityId: string; title: string
  date: string; color: string; icon: string | null
}

interface AttivitaGantt {
  id: string; cliente: string; progetto: string; attivita: string
  stato: string
  inizio: Date; deadline: Date
  fallbackInizio: boolean; fallbackDeadline: boolean
  account: string; pm: string
  giornateVendute: number | null; giornateConsuntivate: number | null
}

type ZoomLevel = 'week' | 'month' | 'quarter' | 'year'

type GanttRow =
  | { type: 'cliente'; cliente: string; count: number }
  | { type: 'progetto'; cliente: string; progetto: string; pm: string; account: string; count: number }
  | { type: 'attivita'; item: AttivitaGantt; rowIndex: number }

interface DragState {
  activityId: string
  mode: 'move' | 'resize-right' | 'resize-left'
  startX: number
  origInizio: Date
  origDeadline: Date
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_W: Record<ZoomLevel, number> = {
  week: 40, month: 14, quarter: 6, year: 2.5,
}
const ROW_H_CLIENTE  = 38
const ROW_H_PROGETTO = 36
const ROW_H_ATTIVITA = 44
const SIDEBAR_W = 292
const BAR_H     = 28
const HEADER_H  = 52
const MS_DAY    = 86_400_000

// ─── Utilities ────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function addMonths(d: Date, n: number): Date {
  const r = new Date(d); r.setMonth(r.getMonth() + n); return r
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}
function quarterStart(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
}

const MONTHS_IT  = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
const MONTHS_IT2 = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']

function fmtShort(d: Date) {
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`
}
function fmtIso(d: Date) {
  return d.toISOString().slice(0, 10)
}
function dateToX(date: Date, start: Date, dw: number): number {
  return ((date.getTime() - start.getTime()) / MS_DAY) * dw
}
function hashColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h)
  const p = ['#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#06B6D4','#6366F1','#EC4899']
  return p[Math.abs(h) % p.length]
}
function initials(s: string) {
  return s.trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() ?? '').join('')
}
function authH(token: string) {
  return { Authorization: `Bearer ${token}` }
}
function authHJ(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function getInizio(raw: string | null) {
  if (raw) return { date: startOfDay(new Date(raw)), fallback: false }
  return { date: startOfDay(quarterStart(new Date())), fallback: true }
}
function getDeadline(raw: string | null) {
  if (raw) return { date: startOfDay(new Date(raw)), fallback: false }
  return { date: startOfDay(addMonths(new Date(), 3)), fallback: true }
}

function parseActivities(gruppi: GruppoRaw[]): AttivitaGantt[] {
  const all: AttivitaGantt[] = []
  for (const g of gruppi) {
    for (const a of g.attivita) {
      const { date: inizio, fallback: fi } = getInizio(a.inizio)
      const { date: deadline, fallback: fd } = getDeadline(a.deadline)
      all.push({
        id: a.id, cliente: a.cliente, progetto: a.progetto, attivita: a.attivita,
        stato: a.stato, inizio, deadline,
        fallbackInizio: fi, fallbackDeadline: fd,
        account: a.account || g.account,
        pm: a.projectManager || g.projectManager,
        giornateVendute: a.giornateVendute,
        giornateConsuntivate: a.giornateConsuntivate,
      })
    }
  }
  return all
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonGantt() {
  const rows = [1, 0.4, 1, 0.6, 1, 1, 0.3, 1]
  return (
    <div className="gp-skeleton">
      <div className="gp-skeleton-toolbar">
        {[80,60,90,70].map((w,i) => <div key={i} className="gp-sk-pill" style={{ width: w }} />)}
      </div>
      <div className="gp-skeleton-body">
        <div className="gp-skeleton-sidebar">
          {rows.map((d,i) => (
            <div key={i} className="gp-sk-row">
              <div className="gp-sk-label" style={{ width: `${30 + d * 60}%`, marginLeft: d < 0.5 ? 0 : 16 }} />
            </div>
          ))}
        </div>
        <div className="gp-skeleton-timeline">
          <div className="gp-sk-header">
            {[1,2,3,4,5,6].map(i => <div key={i} className="gp-sk-month" />)}
          </div>
          {rows.map((d,i) => (
            <div key={i} className="gp-sk-row">
              {d > 0.5 && (
                <div className="gp-sk-bar" style={{
                  marginLeft: `${10 + i * 7}%`,
                  width: `${15 + d * 25}%`,
                  animationDelay: `${i * 0.1}s`,
                }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipData {
  item: AttivitaGantt
  statiMap: Map<string, StatoConfig>
  x: number; y: number
}

function GanttTooltip({ item, statiMap, x, y }: TooltipData) {
  const sc = statiMap.get(item.stato)
  const gv = item.giornateVendute
  const gc = item.giornateConsuntivate
  const pct = gv && gv > 0 ? Math.round(((gc ?? 0) / gv) * 100) : null
  const overrun = gv !== null && gc !== null && gc > gv

  return (
    <div className="gp-tooltip" style={{ left: x, top: y }}>
      <div className="gp-tt-title">{item.attivita}</div>
      <div className="gp-tt-row">
        <span className="gp-tt-badge" style={{ background: sc?.colore ?? '#6B7280' }}>
          {sc?.label ?? item.stato}
        </span>
      </div>
      <div className="gp-tt-grid">
        <span className="gp-tt-key">Cliente</span>
        <span className="gp-tt-val">{item.cliente}</span>
        <span className="gp-tt-key">Progetto</span>
        <span className="gp-tt-val">{item.progetto}</span>
        {item.pm && <><span className="gp-tt-key">PM</span><span className="gp-tt-val">{item.pm}</span></>}
        {item.account && <><span className="gp-tt-key">Account</span><span className="gp-tt-val">{item.account}</span></>}
        <span className="gp-tt-key">Inizio</span>
        <span className="gp-tt-val">{item.fallbackInizio ? `~${fmtShort(item.inizio)}` : fmtShort(item.inizio)}</span>
        <span className="gp-tt-key">Deadline</span>
        <span className="gp-tt-val">{item.fallbackDeadline ? `~${fmtShort(item.deadline)}` : fmtShort(item.deadline)}</span>
        {gv !== null && <>
          <span className="gp-tt-key">Giornate</span>
          <span className={`gp-tt-val${overrun ? ' gp-tt-val--red' : ''}`}>
            {gc ?? '—'} / {gv} {pct !== null && `(${pct}%)`}
          </span>
        </>}
      </div>
    </div>
  )
}

// ─── Milestone Modal ─────────────────────────────────────────────────────────

const MS_COLORS = ['#F59E0B','#EF4444','#10B981','#3B82F6','#8B5CF6','#EC4899','#6B7280']

function MilestoneModal({ mode, activityName, defaultTitle, defaultDate, defaultColor, onSave, onDelete, onClose }: {
  mode: 'create' | 'edit'
  activityName: string
  defaultTitle: string
  defaultDate: string
  defaultColor: string
  onSave: (data: { title: string; date: string; color: string }) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(defaultTitle)
  const [date,  setDate]  = useState(defaultDate)
  const [color, setColor] = useState(defaultColor)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !date) return
    onSave({ title: title.trim(), date, color })
  }

  return (
    <div className="gp-modal-overlay" onClick={onClose}>
      <div className="gp-modal" onClick={e => e.stopPropagation()}>
        <div className="gp-modal-header">
          <h3 className="gp-modal-title">
            {mode === 'create' ? 'Nuova milestone' : 'Modifica milestone'}
          </h3>
          <button className="gp-modal-close" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <p className="gp-modal-activity">{activityName}</p>
        <form onSubmit={handleSubmit} className="gp-modal-form">
          <label className="gp-modal-label">
            Titolo
            <input
              className="gp-modal-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Es. Review finale"
              autoFocus
              required
            />
          </label>
          <label className="gp-modal-label">
            Data
            <input
              className="gp-modal-input"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
            />
          </label>
          <div className="gp-modal-label">
            Colore
            <div className="gp-ms-color-row">
              {MS_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`gp-ms-color-dot${color === c ? ' gp-ms-color-dot--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="gp-modal-actions">
            {mode === 'edit' && onDelete && (
              <button type="button" className="gp-btn gp-btn--danger" onClick={onDelete}>
                Elimina
              </button>
            )}
            <button type="button" className="gp-btn gp-btn--ghost" onClick={onClose}>Annulla</button>
            <button type="submit" className="gp-btn gp-btn--primary">
              {mode === 'create' ? 'Crea' : 'Salva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Gantt Bar ────────────────────────────────────────────────────────────────

interface BarProps {
  item: AttivitaGantt
  timelineStart: Date
  dayW: number
  statiMap: Map<string, StatoConfig>
  milestones: GanttMilestone[]
  isCritical: boolean
  rowIndex: number
  onDragStart: (e: React.PointerEvent, id: string, mode: 'move'|'resize-right'|'resize-left') => void
  onHover: (e: React.MouseEvent, item: AttivitaGantt | null) => void
  overrides: Map<string, { inizio: Date; deadline: Date }>
  onMilestoneClick: (ms: GanttMilestone) => void
}

const GanttBar = memo(function GanttBar({
  item, timelineStart, dayW, statiMap, milestones,
  isCritical, rowIndex, onDragStart, onHover, overrides, onMilestoneClick,
}: BarProps) {
  const ov = overrides.get(item.id)
  const inizio   = ov?.inizio   ?? item.inizio
  const deadline = ov?.deadline ?? item.deadline

  const x     = dateToX(inizio, timelineStart, dayW)
  const width = Math.max(dateToX(deadline, timelineStart, dayW) - x, 4)
  const y     = (ROW_H_ATTIVITA - BAR_H) / 2
  const sc    = statiMap.get(item.stato)
  const color = sc?.colore ?? '#6B7280'

  const gv = item.giornateVendute ?? 0
  const gc = item.giornateConsuntivate ?? 0
  const pct = gv > 0 ? Math.min(gc / gv, 1) : 0

  const isDashed = item.fallbackInizio || item.fallbackDeadline

  const itemMilestones = milestones.filter(m => m.activityId === item.id)

  return (
    <div
      className={`gp-bar-wrap${isCritical ? ' gp-bar-wrap--critical' : ''}`}
      style={{
        left: x, top: y, width,
        animationDelay: `${rowIndex * 60}ms`,
      }}
      onMouseEnter={e => onHover(e, item)}
      onMouseLeave={e => onHover(e, null)}
    >
      {/* Main bar */}
      <div
        className={`gp-bar${isDashed ? ' gp-bar--dashed' : ''}`}
        style={{ background: color }}
        onPointerDown={e => onDragStart(e, item.id, 'move')}
      >
        {/* Progress overlay */}
        {pct > 0 && (
          <div className="gp-bar-progress" style={{ width: `${pct * 100}%` }} />
        )}
        {/* Label inside bar */}
        {width > 80 && (
          <span className="gp-bar-label">{item.attivita}</span>
        )}
        {/* Glow overlay for critical path */}
        {isCritical && <div className="gp-bar-glow" />}
      </div>

      {/* Left resize handle */}
      <div
        className="gp-bar-handle gp-bar-handle--left"
        onPointerDown={e => { e.stopPropagation(); onDragStart(e, item.id, 'resize-left') }}
      />
      {/* Right resize handle */}
      <div
        className="gp-bar-handle gp-bar-handle--right"
        onPointerDown={e => { e.stopPropagation(); onDragStart(e, item.id, 'resize-right') }}
      />

      {/* Milestones */}
      {itemMilestones.map(ms => {
        const msX = dateToX(new Date(ms.date), inizio, dayW)
        if (msX < 0 || msX > width) return null
        return (
          <div
            key={ms.id}
            className="gp-milestone"
            style={{ left: msX, color: ms.color }}
            title={ms.title}
            onClick={e => { e.stopPropagation(); onMilestoneClick(ms) }}
          >
            ◆
            <span className="gp-milestone-label">{ms.title}</span>
          </div>
        )
      })}
    </div>
  )
})

// ─── Timeline header cells ────────────────────────────────────────────────────

function TimelineHeader({
  timelineStart, timelineEnd, dayW, zoom, today,
}: {
  timelineStart: Date; timelineEnd: Date; dayW: number; zoom: ZoomLevel; today: Date
}) {
  const cells: { label: string; x: number; width: number; isToday?: boolean }[] = []

  if (zoom === 'week') {
    let cur = startOfDay(timelineStart)
    while (cur < timelineEnd) {
      const weekStart = new Date(cur)
      const x = dateToX(weekStart, timelineStart, dayW)
      const end = addDays(weekStart, 7)
      const width = dateToX(end, timelineStart, dayW) - x
      const isoDay = weekStart.getDay()
      const diffToMon = isoDay === 0 ? -6 : 1 - isoDay
      const mon = addDays(weekStart, diffToMon)
      cells.push({
        label: `${mon.getDate()} ${MONTHS_IT[mon.getMonth()]}`,
        x, width,
        isToday: today >= weekStart && today < end,
      })
      cur = end
    }
  } else {
    let cur = startOfMonth(timelineStart)
    while (cur < timelineEnd) {
      const x = dateToX(cur, timelineStart, dayW)
      const dim = daysInMonth(cur.getFullYear(), cur.getMonth())
      const width = dim * dayW
      const label = zoom === 'year'
        ? `${MONTHS_IT[cur.getMonth()]} ${cur.getFullYear()}`
        : `${MONTHS_IT2[cur.getMonth()]} ${cur.getFullYear()}`
      cells.push({ label, x, width })
      cur = addMonths(cur, 1)
    }
  }

  return (
    <div className="gp-tl-header" style={{ height: HEADER_H }}>
      {cells.map((c, i) => (
        <div
          key={i}
          className={`gp-tl-hcell${c.isToday ? ' gp-tl-hcell--today' : ''}`}
          style={{ left: c.x, width: c.width, height: HEADER_H }}
        >
          <span className="gp-tl-hlabel">{c.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Grid lines ───────────────────────────────────────────────────────────────

function GridLines({
  timelineStart, timelineEnd, dayW,
}: { timelineStart: Date; timelineEnd: Date; dayW: number }) {
  const lines: { x: number; isQuarter: boolean }[] = []
  let cur = startOfMonth(timelineStart)
  while (cur < timelineEnd) {
    const x = dateToX(cur, timelineStart, dayW)
    lines.push({ x, isQuarter: cur.getMonth() % 3 === 0 })
    cur = addMonths(cur, 1)
  }
  return (
    <div className="gp-grid-lines">
      {lines.map((l, i) => (
        <div
          key={i}
          className={`gp-grid-line${l.isQuarter ? ' gp-grid-line--quarter' : ''}`}
          style={{ left: l.x }}
        />
      ))}
    </div>
  )
}

// ─── Sidebar row ──────────────────────────────────────────────────────────────

function SidebarClienteRow({
  cliente, count, collapsed, onToggle,
}: { cliente: string; count: number; collapsed: boolean; onToggle: () => void }) {
  const color = hashColor(cliente)
  return (
    <div className="gp-sb-row gp-sb-row--cliente" style={{ height: ROW_H_CLIENTE }}>
      <button className="gp-sb-toggle" onClick={onToggle} aria-label={collapsed ? 'Espandi' : 'Comprimi'}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          className={`gp-sb-chevron${collapsed ? ' gp-sb-chevron--collapsed' : ''}`}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="gp-sb-avatar" style={{ background: color }}>{initials(cliente)}</div>
      <span className="gp-sb-name gp-sb-name--cliente">{cliente}</span>
      {collapsed && <span className="gp-sb-badge">{count}</span>}
    </div>
  )
}

function SidebarProgettoRow({
  progetto, pm, count, collapsed, onToggle,
}: { progetto: string; pm: string; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="gp-sb-row gp-sb-row--progetto" style={{ height: ROW_H_PROGETTO }}>
      <button className="gp-sb-toggle gp-sb-toggle--sub" onClick={onToggle} aria-label={collapsed ? 'Espandi' : 'Comprimi'}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
          className={`gp-sb-chevron${collapsed ? ' gp-sb-chevron--collapsed' : ''}`}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="gp-sb-name gp-sb-name--progetto">{progetto}</span>
      {pm && <span className="gp-sb-pm">{initials(pm)}</span>}
      {collapsed && <span className="gp-sb-badge">{count}</span>}
    </div>
  )
}

function SidebarAttivitaRow({
  item, statiMap, isSelected, onClick, onAddMilestone,
}: { item: AttivitaGantt; statiMap: Map<string, StatoConfig>; isSelected: boolean; onClick: () => void; onAddMilestone: () => void }) {
  const sc = statiMap.get(item.stato)
  return (
    <div
      className={`gp-sb-row gp-sb-row--attivita${isSelected ? ' gp-sb-row--selected' : ''}`}
      style={{ height: ROW_H_ATTIVITA }}
      onClick={onClick}
    >
      <div className="gp-sb-dot" style={{ background: sc?.colore ?? '#6B7280' }} />
      <span className="gp-sb-name gp-sb-name--attivita" title={item.attivita}>{item.attivita}</span>
      <button
        className="gp-sb-ms-btn"
        onClick={e => { e.stopPropagation(); onAddMilestone() }}
        title="Aggiungi milestone"
        aria-label="Aggiungi milestone"
      >+</button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface GanttPageProps { token: string }

export default function GanttPage({ token }: GanttPageProps) {
  const [activities,   setActivities]   = useState<AttivitaGantt[]>([])
  const [statiConfig,  setStatiConfig]  = useState<StatoConfig[]>([])
  const [milestones,   setMilestones]   = useState<GanttMilestone[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [zoom,         setZoom]         = useState<ZoomLevel>('quarter')
  const [collCliente,  setCollCliente]  = useState<Set<string>>(new Set())
  const [collProgetto, setCollProgetto] = useState<Set<string>>(new Set())
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [soloAttivi,    setSoloAttivi]    = useState(true)
  const [filtroPM,      setFiltroPM]      = useState('')
  const [filtroAcc,     setFiltroAcc]     = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroStato,   setFiltroStato]   = useState('')
  const [showFilters,   setShowFilters]   = useState(false)
  const [tooltip,      setTooltip]      = useState<{ item: AttivitaGantt; x: number; y: number } | null>(null)
  const [drag,         setDrag]         = useState<DragState | null>(null)
  const [overrides,    setOverrides]    = useState<Map<string, { inizio: Date; deadline: Date }>>(new Map())

  type MilestoneModalState =
    | { mode: 'create'; activityId: string }
    | { mode: 'edit'; ms: GanttMilestone }
  const [milestoneModal, setMilestoneModal] = useState<MilestoneModalState | null>(null)

  const timelineRef = useRef<HTMLDivElement>(null)
  const sidebarRef  = useRef<HTMLDivElement>(null)
  const headerRef   = useRef<HTMLDivElement>(null)
  const scrolledToToday = useRef(false)

  const today = useMemo(() => startOfDay(new Date()), [])
  const dayW  = DAY_W[zoom]

  const statiMap = useMemo(
    () => new Map(statiConfig.map(s => [s.chiave, s])),
    [statiConfig],
  )

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [rA, rS, rM] = await Promise.all([
        fetch(`${API_URL}/api/attivita`,       { headers: authH(token) }),
        fetch(`${API_URL}/api/stati-attivita`, { headers: authH(token) }),
        fetch(`${API_URL}/api/gantt/milestones`, { headers: authH(token) }),
      ])
      if (!rA.ok) throw new Error(`Errore ${rA.status}`)
      const [jsonA, stati, ms] = await Promise.all([
        rA.json() as Promise<{ gruppi: GruppoRaw[] }>,
        rS.ok ? (rS.json() as Promise<StatoConfig[]>) : Promise.resolve([]),
        rM.ok ? (rM.json() as Promise<GanttMilestone[]>) : Promise.resolve([]),
      ])
      setActivities(parseActivities(jsonA.gruppi))
      setStatiConfig(stati)
      setMilestones(ms)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Filter activities ─────────────────────────────────────────────────────

  const filteredActivities = useMemo(() => {
    let list = activities
    if (soloAttivi)     list = list.filter(a => !(statiMap.get(a.stato)?.isArchiviato ?? false))
    if (filtroPM)       list = list.filter(a => a.pm === filtroPM)
    if (filtroAcc)      list = list.filter(a => a.account === filtroAcc)
    if (filtroCliente)  list = list.filter(a => a.cliente === filtroCliente)
    if (filtroStato)    list = list.filter(a => a.stato === filtroStato)
    return list
  }, [activities, soloAttivi, filtroPM, filtroAcc, filtroCliente, filtroStato, statiMap])

  // ── Timeline range ─────────────────────────────────────────────────────────

  const { timelineStart, timelineEnd } = useMemo(() => {
    if (filteredActivities.length === 0) {
      const s = startOfDay(addMonths(today, -1))
      const e = startOfDay(addMonths(today,  6))
      return { timelineStart: s, timelineEnd: e }
    }
    const dates = filteredActivities.flatMap(a => [a.inizio, a.deadline])
    const minMs = Math.min(...dates.map(d => d.getTime()))
    const maxMs = Math.max(...dates.map(d => d.getTime()))
    return {
      timelineStart: addDays(startOfDay(new Date(minMs)), -30),
      timelineEnd:   addDays(startOfDay(new Date(maxMs)),  30),
    }
  }, [filteredActivities, today])

  const totalDays  = Math.ceil((timelineEnd.getTime() - timelineStart.getTime()) / MS_DAY)
  const totalWidth = totalDays * dayW

  // ── Critical path: activities with deadline within 14 days ────────────────

  const criticalIds = useMemo(() => {
    const cutoff = addDays(today, 14)
    return new Set(
      filteredActivities
        .filter(a => !a.fallbackDeadline && a.deadline <= cutoff && a.deadline >= today)
        .map(a => a.id),
    )
  }, [filteredActivities, today])

  // ── Flat rows ──────────────────────────────────────────────────────────────

  const { rows, uniquePMs, uniqueAccounts, uniqueClienti } = useMemo(() => {
    const pms     = new Set<string>()
    const accs    = new Set<string>()
    const clients = new Set<string>()
    filteredActivities.forEach(a => {
      if (a.pm)      pms.add(a.pm)
      if (a.account) accs.add(a.account)
      if (a.cliente) clients.add(a.cliente)
    })

    // Group: cliente → progetto
    const clienteMap = new Map<string, Map<string, AttivitaGantt[]>>()
    for (const a of filteredActivities) {
      if (!clienteMap.has(a.cliente)) clienteMap.set(a.cliente, new Map())
      const pm = clienteMap.get(a.cliente)!
      if (!pm.has(a.progetto)) pm.set(a.progetto, [])
      pm.get(a.progetto)!.push(a)
    }

    const result: GanttRow[] = []
    let rowIndex = 0
    for (const [cliente, progettiMap] of clienteMap) {
      const totalCount = [...progettiMap.values()].reduce((s, a) => s + a.length, 0)
      const cKey = cliente
      result.push({ type: 'cliente', cliente, count: totalCount })
      if (!collCliente.has(cKey)) {
        for (const [progetto, attivita] of progettiMap) {
          const pKey = `${cliente}|||${progetto}`
          const pmName = attivita[0]?.pm ?? ''
          const accName = attivita[0]?.account ?? ''
          result.push({ type: 'progetto', cliente, progetto, pm: pmName, account: accName, count: attivita.length })
          if (!collProgetto.has(pKey)) {
            for (const item of attivita) {
              result.push({ type: 'attivita', item, rowIndex })
              rowIndex++
            }
          }
        }
      }
    }
    return { rows: result, uniquePMs: [...pms], uniqueAccounts: [...accs], uniqueClienti: [...clients] }
  }, [filteredActivities, collCliente, collProgetto])

  // ── Scroll sync (vertical) ─────────────────────────────────────────────────

  const syncFromTimeline = useCallback(() => {
    if (sidebarRef.current && timelineRef.current) {
      sidebarRef.current.scrollTop = timelineRef.current.scrollTop
    }
  }, [])
  const syncFromSidebar = useCallback(() => {
    if (timelineRef.current && sidebarRef.current) {
      timelineRef.current.scrollTop = sidebarRef.current.scrollTop
    }
  }, [])

  // Sync horizontal header with timeline body
  const syncHeader = useCallback(() => {
    if (headerRef.current && timelineRef.current) {
      headerRef.current.scrollLeft = timelineRef.current.scrollLeft
    }
  }, [])

  // ── Auto-scroll to today ───────────────────────────────────────────────────

  useEffect(() => {
    if (loading || scrolledToToday.current || !timelineRef.current) return
    scrolledToToday.current = true
    const todayX = dateToX(today, timelineStart, dayW)
    const containerW = timelineRef.current.clientWidth
    timelineRef.current.scrollLeft = Math.max(0, todayX - containerW / 2)
    if (headerRef.current) headerRef.current.scrollLeft = timelineRef.current.scrollLeft
  }, [loading, today, timelineStart, dayW])

  // ── Ctrl+scroll zoom ───────────────────────────────────────────────────────

  useEffect(() => {
    const ZOOMS: ZoomLevel[] = ['week', 'month', 'quarter', 'year']
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(z => {
        const idx = ZOOMS.indexOf(z)
        if (e.deltaY > 0) return ZOOMS[Math.min(idx + 1, ZOOMS.length - 1)]
        return ZOOMS[Math.max(idx - 1, 0)]
      })
    }
    const el = timelineRef.current
    el?.addEventListener('wheel', handler, { passive: false })
    return () => el?.removeEventListener('wheel', handler)
  }, [])

  // ── Keyboard navigation ────────────────────────────────────────────────────

  useEffect(() => {
    const attIds = rows
      .filter((r): r is Extract<GanttRow, { type: 'attivita' }> => r.type === 'attivita')
      .map(r => r.item.id)

    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return
      e.preventDefault()

      if (e.key === 'Escape') {
        setSelectedId(null)
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setSelectedId(prev => {
          if (attIds.length === 0) return prev
          if (!prev) return attIds[0]
          const idx = attIds.indexOf(prev)
          const next = e.key === 'ArrowDown'
            ? attIds[Math.min(idx + 1, attIds.length - 1)]
            : attIds[Math.max(idx - 1, 0)]
          // Scroll sidebar to keep the focused row visible
          if (sidebarRef.current) {
            let y = 0
            for (const r of rows) {
              if (r.type === 'attivita' && r.item.id === next) break
              y += r.type === 'cliente' ? ROW_H_CLIENTE : r.type === 'progetto' ? ROW_H_PROGETTO : ROW_H_ATTIVITA
            }
            const h = sidebarRef.current.clientHeight
            const top = sidebarRef.current.scrollTop
            if (y < top) sidebarRef.current.scrollTop = y
            else if (y + ROW_H_ATTIVITA > top + h) sidebarRef.current.scrollTop = y + ROW_H_ATTIVITA - h
            if (timelineRef.current) timelineRef.current.scrollTop = sidebarRef.current.scrollTop
          }
          return next
        })
        return
      }

      if (e.key === 'Enter') {
        setSelectedId(prev => {
          if (!prev || !timelineRef.current) return prev
          const act = filteredActivities.find(a => a.id === prev)
          if (!act) return prev
          const barX = dateToX(act.inizio, timelineStart, dayW)
          const barW = Math.max(dateToX(act.deadline, timelineStart, dayW) - barX, 4)
          const centerX = barX + barW / 2
          const containerW = timelineRef.current.clientWidth
          timelineRef.current.scrollLeft = Math.max(0, centerX - containerW / 2)
          if (headerRef.current) headerRef.current.scrollLeft = timelineRef.current.scrollLeft
          return prev
        })
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [rows, filteredActivities, timelineStart, dayW])

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((
    e: React.PointerEvent,
    activityId: string,
    mode: 'move' | 'resize-right' | 'resize-left',
  ) => {
    e.preventDefault()
    const act = activities.find(a => a.id === activityId)
    if (!act) return
    const ov = overrides.get(activityId)
    setDrag({
      activityId, mode,
      startX: e.clientX,
      origInizio:   ov?.inizio   ?? act.inizio,
      origDeadline: ov?.deadline ?? act.deadline,
    })
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [activities, overrides])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const deltaDays = Math.round((e.clientX - drag.startX) / dayW)
      const next = new Map(overrides)
      if (drag.mode === 'move') {
        next.set(drag.activityId, {
          inizio:   addDays(drag.origInizio,   deltaDays),
          deadline: addDays(drag.origDeadline, deltaDays),
        })
      } else if (drag.mode === 'resize-right') {
        const newDeadline = addDays(drag.origDeadline, deltaDays)
        if (newDeadline > drag.origInizio) {
          next.set(drag.activityId, { inizio: drag.origInizio, deadline: newDeadline })
        }
      } else {
        const newInizio = addDays(drag.origInizio, deltaDays)
        if (newInizio < drag.origDeadline) {
          next.set(drag.activityId, { inizio: newInizio, deadline: drag.origDeadline })
        }
      }
      setOverrides(next)
    }

    const onUp = async () => {
      const ov = overrides.get(drag.activityId)
      if (ov) {
        try {
          await fetch(`${API_URL}/api/attivita/${drag.activityId}/dates`, {
            method: 'PATCH',
            headers: authHJ(token),
            body: JSON.stringify({
              inizio:   fmtIso(ov.inizio),
              deadline: fmtIso(ov.deadline),
            }),
          })
          setActivities(prev => prev.map(a =>
            a.id === drag.activityId
              ? { ...a, inizio: ov.inizio, deadline: ov.deadline, fallbackInizio: false, fallbackDeadline: false }
              : a,
          ))
          setOverrides(prev => { const n = new Map(prev); n.delete(drag.activityId); return n })
        } catch { /* ignore */ }
      }
      setDrag(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, dayW, overrides, token])

  // ── Milestone handlers ─────────────────────────────────────────────────────

  const handleMilestoneCreate = useCallback((activityId: string) => {
    setMilestoneModal({ mode: 'create', activityId })
  }, [])

  const handleMilestoneEdit = useCallback((ms: GanttMilestone) => {
    setMilestoneModal({ mode: 'edit', ms })
  }, [])

  async function handleMilestoneSave(data: { title: string; date: string; color: string }) {
    if (!milestoneModal) return
    const isoDate = `${data.date}T12:00:00.000Z`
    if (milestoneModal.mode === 'create') {
      const r = await fetch(`${API_URL}/api/gantt/milestones`, {
        method: 'POST',
        headers: authHJ(token),
        body: JSON.stringify({ activityId: milestoneModal.activityId, title: data.title, date: isoDate, color: data.color }),
      })
      if (r.ok) {
        const ms = await r.json() as GanttMilestone
        setMilestones(prev => [...prev, ms])
      }
    } else {
      const r = await fetch(`${API_URL}/api/gantt/milestones/${milestoneModal.ms.id}`, {
        method: 'PUT',
        headers: authHJ(token),
        body: JSON.stringify({ title: data.title, date: isoDate, color: data.color }),
      })
      if (r.ok) {
        const ms = await r.json() as GanttMilestone
        setMilestones(prev => prev.map(m => m.id === ms.id ? ms : m))
      }
    }
    setMilestoneModal(null)
  }

  async function handleMilestoneDelete() {
    if (milestoneModal?.mode !== 'edit') return
    const id = milestoneModal.ms.id
    await fetch(`${API_URL}/api/gantt/milestones/${id}`, { method: 'DELETE', headers: authH(token) })
    setMilestones(prev => prev.filter(m => m.id !== id))
    setMilestoneModal(null)
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────

  const handleHover = useCallback((e: React.MouseEvent, item: AttivitaGantt | null) => {
    if (!item) { setTooltip(null); return }
    const rect = (e.currentTarget as HTMLElement).closest('.gp-main')?.getBoundingClientRect()
    setTooltip({
      item,
      x: e.clientX - (rect?.left ?? 0) + 12,
      y: e.clientY - (rect?.top ?? 0) - 20,
    })
  }, [])

  // ── Row heights sum for sidebar padding ────────────────────────────────────

  const totalBodyHeight = useMemo(() => rows.reduce((s, r) => {
    if (r.type === 'cliente')  return s + ROW_H_CLIENTE
    if (r.type === 'progetto') return s + ROW_H_PROGETTO
    return s + ROW_H_ATTIVITA
  }, 0), [rows])

  // ── Mobile ─────────────────────────────────────────────────────────────────

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  if (isMobile) return <MobileGantt activities={filteredActivities} statiMap={statiMap} />

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <SkeletonGantt />
  if (error) return (
    <div className="gp-error">
      <p>Errore caricamento dati: {error}</p>
      <button className="gp-btn" onClick={fetchAll}>Riprova</button>
    </div>
  )

  const ZOOMS: { key: ZoomLevel; label: string }[] = [
    { key: 'week', label: 'Sett.' },
    { key: 'month', label: 'Mese' },
    { key: 'quarter', label: 'Trim.' },
    { key: 'year', label: 'Anno' },
  ]

  const todayX = dateToX(today, timelineStart, dayW)

  return (
    <div className="gp-page">

      {/* ── Toolbar ── */}
      <div className="gp-toolbar">
        <div className="gp-toolbar-left">
          <h1 className="gp-title">Gantt</h1>
          <div className="gp-zoom-group">
            {ZOOMS.map(z => (
              <button
                key={z.key}
                className={`gp-zoom-btn${zoom === z.key ? ' gp-zoom-btn--active' : ''}`}
                onClick={() => { scrolledToToday.current = false; setZoom(z.key) }}
              >
                {z.label}
              </button>
            ))}
          </div>
          <button
            className="gp-btn gp-btn--ghost gp-today-btn"
            onClick={() => {
              if (!timelineRef.current) return
              const containerW = timelineRef.current.clientWidth
              timelineRef.current.scrollLeft = Math.max(0, todayX - containerW / 2)
              if (headerRef.current) headerRef.current.scrollLeft = timelineRef.current.scrollLeft
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"
              stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <circle cx="10" cy="10" r="8" />
              <path d="M10 6v4l2.5 2" strokeLinecap="round" />
            </svg>
            Oggi
          </button>
        </div>

        <div className="gp-toolbar-right">
          {/* Filter chips */}
          <div className="gp-filter-chips">
            <button
              className={`gp-chip${soloAttivi ? ' gp-chip--active' : ''}`}
              onClick={() => setSoloAttivi(v => !v)}
            >
              Solo attivi
            </button>
            {filtroCliente && (
              <button className="gp-chip gp-chip--active gp-chip--removable" onClick={() => setFiltroCliente('')}>
                {filtroCliente} ×
              </button>
            )}
            {filtroStato && (
              <button className="gp-chip gp-chip--active gp-chip--removable" onClick={() => setFiltroStato('')}>
                {statiMap.get(filtroStato)?.label ?? filtroStato} ×
              </button>
            )}
            {filtroPM && (
              <button className="gp-chip gp-chip--active gp-chip--removable" onClick={() => setFiltroPM('')}>
                PM: {filtroPM} ×
              </button>
            )}
            {filtroAcc && (
              <button className="gp-chip gp-chip--active gp-chip--removable" onClick={() => setFiltroAcc('')}>
                Account: {filtroAcc} ×
              </button>
            )}
          </div>
          <button
            className={`gp-btn gp-btn--ghost${showFilters ? ' gp-btn--active' : ''}`}
            onClick={() => setShowFilters(v => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"
              stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <path d="M3 5h14M6 10h8M9 15h2" strokeLinecap="round" />
            </svg>
            Filtri
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className="gp-filter-panel">
          <div className="gp-filter-group">
            <label className="gp-filter-label">Cliente</label>
            <select
              className="gp-filter-select"
              value={filtroCliente}
              onChange={e => setFiltroCliente(e.target.value)}
            >
              <option value="">Tutti</option>
              {uniqueClienti.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="gp-filter-group">
            <label className="gp-filter-label">Stato</label>
            <select
              className="gp-filter-select"
              value={filtroStato}
              onChange={e => setFiltroStato(e.target.value)}
            >
              <option value="">Tutti</option>
              {statiConfig.filter(s => !soloAttivi || !s.isArchiviato).map(s => (
                <option key={s.chiave} value={s.chiave}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="gp-filter-group">
            <label className="gp-filter-label">Project Manager</label>
            <select
              className="gp-filter-select"
              value={filtroPM}
              onChange={e => setFiltroPM(e.target.value)}
            >
              <option value="">Tutti</option>
              {uniquePMs.map(pm => <option key={pm} value={pm}>{pm}</option>)}
            </select>
          </div>
          <div className="gp-filter-group">
            <label className="gp-filter-label">Account</label>
            <select
              className="gp-filter-select"
              value={filtroAcc}
              onChange={e => setFiltroAcc(e.target.value)}
            >
              <option value="">Tutti</option>
              {uniqueAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button className="gp-btn gp-btn--ghost" onClick={() => {
            setFiltroPM(''); setFiltroAcc(''); setFiltroCliente(''); setFiltroStato(''); setSoloAttivi(true)
          }}>
            Azzera filtri
          </button>
        </div>
      )}

      {/* ── Empty ── */}
      {filteredActivities.length === 0 && (
        <div className="gp-empty">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="4" y="10" width="26" height="6" rx="3" fill="#0D9488" opacity="0.4" />
            <rect x="10" y="22" width="28" height="6" rx="3" fill="#F59E0B" opacity="0.3" />
            <rect x="6" y="34" width="22" height="6" rx="3" fill="#0D9488" opacity="0.2" />
          </svg>
          <p>Nessuna attività da visualizzare.</p>
        </div>
      )}

      {/* ── Gantt main ── */}
      {filteredActivities.length > 0 && (
        <div className="gp-main" style={{ position: 'relative' }}>

          {/* Header row */}
          <div className="gp-header-row">
            <div className="gp-sb-head" style={{ width: SIDEBAR_W }}>
              <span className="gp-sb-head-label">Cliente / Progetto / Attività</span>
              <span className="gp-sb-kbd-hint" title="Usa ↑↓ per navigare, Enter per centrare, Esc per deselezionare">↑↓</span>
            </div>
            <div
              className="gp-tl-head-scroll"
              ref={headerRef}
              style={{ flex: 1, overflow: 'hidden' }}
            >
              <div style={{ width: totalWidth, position: 'relative', height: HEADER_H }}>
                <TimelineHeader
                  timelineStart={timelineStart}
                  timelineEnd={timelineEnd}
                  dayW={dayW}
                  zoom={zoom}
                  today={today}
                />
              </div>
            </div>
          </div>

          {/* Body row */}
          <div className="gp-body-row">

            {/* Sidebar */}
            <div
              className="gp-sidebar"
              ref={sidebarRef}
              style={{ width: SIDEBAR_W }}
              onScroll={syncFromSidebar}
            >
              <div style={{ height: totalBodyHeight }}>
                {rows.map((row, i) => {
                  if (row.type === 'cliente') {
                    return (
                      <SidebarClienteRow
                        key={`c-${row.cliente}`}
                        cliente={row.cliente}
                        count={row.count}
                        collapsed={collCliente.has(row.cliente)}
                        onToggle={() => setCollCliente(prev => {
                          const n = new Set(prev)
                          n.has(row.cliente) ? n.delete(row.cliente) : n.add(row.cliente)
                          return n
                        })}
                      />
                    )
                  }
                  if (row.type === 'progetto') {
                    const pKey = `${row.cliente}|||${row.progetto}`
                    return (
                      <SidebarProgettoRow
                        key={`p-${pKey}-${i}`}
                        progetto={row.progetto}
                        pm={row.pm}
                        count={row.count}
                        collapsed={collProgetto.has(pKey)}
                        onToggle={() => setCollProgetto(prev => {
                          const n = new Set(prev)
                          n.has(pKey) ? n.delete(pKey) : n.add(pKey)
                          return n
                        })}
                      />
                    )
                  }
                  return (
                    <SidebarAttivitaRow
                      key={`a-${row.item.id}`}
                      item={row.item}
                      statiMap={statiMap}
                      isSelected={selectedId === row.item.id}
                      onClick={() => setSelectedId(id => id === row.item.id ? null : row.item.id)}
                      onAddMilestone={() => handleMilestoneCreate(row.item.id)}
                    />
                  )
                })}
              </div>
            </div>

            {/* Timeline */}
            <div
              className="gp-timeline"
              ref={timelineRef}
              onScroll={() => { syncFromTimeline(); syncHeader() }}
              style={{ flex: 1 }}
            >
              <div style={{ width: totalWidth, minHeight: totalBodyHeight, position: 'relative' }}>

                {/* Grid lines */}
                <GridLines timelineStart={timelineStart} timelineEnd={timelineEnd} dayW={dayW} />

                {/* Today line */}
                {todayX >= 0 && todayX <= totalWidth && (
                  <div className="gp-today-line" style={{ left: todayX }}>
                    <div className="gp-today-label">Oggi</div>
                  </div>
                )}

                {/* Rows with bars */}
                {rows.map((row, i) => {
                  const height = row.type === 'cliente' ? ROW_H_CLIENTE
                    : row.type === 'progetto' ? ROW_H_PROGETTO
                    : ROW_H_ATTIVITA

                  if (row.type !== 'attivita') {
                    return (
                      <div
                        key={`tl-${i}`}
                        className={`gp-tl-row gp-tl-row--${row.type}`}
                        style={{ height }}
                      />
                    )
                  }

                  return (
                    <div
                      key={`tl-${row.item.id}`}
                      className="gp-tl-row gp-tl-row--attivita"
                      style={{ height }}
                    >
                      <GanttBar
                        item={row.item}
                        timelineStart={timelineStart}
                        dayW={dayW}
                        statiMap={statiMap}
                        milestones={milestones}
                        isCritical={criticalIds.has(row.item.id)}
                        rowIndex={row.rowIndex}
                        onDragStart={handleDragStart}
                        onHover={handleHover}
                        overrides={overrides}
                        onMilestoneClick={handleMilestoneEdit}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <GanttTooltip
              item={tooltip.item}
              statiMap={statiMap}
              x={tooltip.x}
              y={tooltip.y}
            />
          )}

        </div>
      )}

      {/* Milestone modal */}
      {milestoneModal && (() => {
        const actId = milestoneModal.mode === 'create' ? milestoneModal.activityId : milestoneModal.ms.activityId
        const act = filteredActivities.find(a => a.id === actId)
        const defaultDate = milestoneModal.mode === 'edit'
          ? milestoneModal.ms.date.slice(0, 10)
          : fmtIso(today)
        return (
          <MilestoneModal
            mode={milestoneModal.mode}
            activityName={act?.attivita ?? ''}
            defaultTitle={milestoneModal.mode === 'edit' ? milestoneModal.ms.title : ''}
            defaultDate={defaultDate}
            defaultColor={milestoneModal.mode === 'edit' ? milestoneModal.ms.color : '#F59E0B'}
            onSave={handleMilestoneSave}
            onDelete={milestoneModal.mode === 'edit' ? handleMilestoneDelete : undefined}
            onClose={() => setMilestoneModal(null)}
          />
        )
      })()}
    </div>
  )
}

// ─── Mobile fallback ──────────────────────────────────────────────────────────

function MobileGantt({
  activities, statiMap,
}: { activities: AttivitaGantt[]; statiMap: Map<string, StatoConfig> }) {
  return (
    <div className="gp-mobile">
      <div className="gp-mobile-header">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect x="2" y="8"  width="18" height="5" rx="2.5" fill="#F59E0B" />
          <rect x="7" y="15" width="20" height="5" rx="2.5" fill="#0D9488" />
          <rect x="4" y="22" width="16" height="5" rx="2.5" fill="#F59E0B" opacity="0.6" />
        </svg>
        <h2 className="gp-mobile-title">Vista Gantt</h2>
        <p className="gp-mobile-desc">Apri su desktop per la vista interattiva completa.</p>
      </div>
      <div className="gp-mobile-list">
        {activities.map(a => {
          const sc = statiMap.get(a.stato)
          const gv = a.giornateVendute ?? 0
          const gc = a.giornateConsuntivate ?? 0
          const pct = gv > 0 ? Math.min(gc / gv, 1) : 0
          return (
            <div key={a.id} className="gp-mobile-item">
              <div className="gp-mobile-item-head">
                <span className="gp-mobile-badge" style={{ background: sc?.colore ?? '#6B7280' }}>
                  {sc?.label ?? a.stato}
                </span>
                <span className="gp-mobile-name">{a.attivita}</span>
              </div>
              <div className="gp-mobile-meta">{a.cliente} · {a.progetto}</div>
              {gv > 0 && (
                <div className="gp-mobile-progress">
                  <div className="gp-mobile-progress-bar" style={{ width: `${pct * 100}%`, background: sc?.colore ?? '#6B7280' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
