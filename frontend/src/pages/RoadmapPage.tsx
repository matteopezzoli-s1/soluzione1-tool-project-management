import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { SectionModal } from '../components/SectionModal'
import './RoadmapPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProdottoRef { id: string; nome: string; colore: string | null; poId: string | null }
interface Prodotto { id: string; nome: string; colore: string | null; poId: string | null }
interface PoRef { id: string; firstName: string | null; lastName: string }

interface StatoRoadmapConfig {
  id: string; chiave: string; label: string; colore: string; isArchiviato: boolean; ordine: number
}

interface RoadmapItem {
  id: string; progettoId: string; progetto: ProdottoRef
  anno: number; quarter: string | null; dataDeadline: string | null
  titolo: string; descrizione: string | null; stato: string
  analisiUrl: string | null; stimaGg: number | null; ordine: number
}

type FormData = {
  progettoId: string; titolo: string; descrizione: string
  anno: string; quarter: string; dataDeadline: string
  stato: string; stimaGg: string; analisiUrl: string
}

const QUARTERS: { key: string; label: string }[] = [
  { key: '',   label: 'Non pianificato' },
  { key: 'Q1', label: 'Q1' },
  { key: 'Q2', label: 'Q2' },
  { key: 'Q3', label: 'Q3' },
  { key: 'Q4', label: 'Q4' },
]

function emptyForm(anno: number): FormData {
  return { progettoId: '', titolo: '', descrizione: '', anno: String(anno), quarter: '', dataDeadline: '', stato: 'DA_FARE', stimaGg: '', analisiUrl: '' }
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function poInitials(po: PoRef | undefined): string {
  if (!po) return ''
  return `${(po.firstName ?? '')[0] ?? ''}${po.lastName[0] ?? ''}`.toUpperCase()
}

function poFullName(po: PoRef | undefined): string {
  if (!po) return ''
  return [po.firstName, po.lastName].filter(Boolean).join(' ')
}

function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function toInputDate(iso: string | null) {
  if (!iso) return ''
  return iso.split('T')[0]
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function ProdottoBadge({ prodotto }: { prodotto: ProdottoRef }) {
  const colore = prodotto.colore ?? '#0D9488'
  return (
    <span className="rm-prod-badge" style={{ backgroundColor: colore + '22', color: colore, border: `1px solid ${colore}55` }}>
      {prodotto.nome}
    </span>
  )
}

function StatoBadge({ stato, statiMap }: { stato: string; statiMap: Map<string, StatoRoadmapConfig> }) {
  const cfg = statiMap.get(stato)
  const label = cfg?.label ?? stato
  const colore = cfg?.colore ?? '#94a3b8'
  return (
    <span className="rm-stato-badge" style={{ backgroundColor: colore + '22', color: colore, border: `1px solid ${colore}55` }}>
      {label}
    </span>
  )
}

function QuarterBadge({ quarter }: { quarter: string | null }) {
  const label = QUARTERS.find(q => q.key === (quarter ?? ''))?.label ?? quarter
  return <span className="rm-quarter-badge">{label}</span>
}

// ─── Modal add/edit ───────────────────────────────────────────────────────────

interface ModalProps {
  title: string; form: FormData; loading: boolean; apiError: string | null
  prodotti: Prodotto[]; statiList: StatoRoadmapConfig[]
  onChange: (f: FormData) => void; onSave: () => void; onClose: () => void
}

function ItemModal({ title, form, loading, apiError, prodotti, statiList, onChange, onSave, onClose }: ModalProps) {
  const set = (key: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [key]: e.target.value })

  return (
    <SectionModal onClose={onClose} labelledBy="rm-modal-title">
      <div className="rm-modal">
        <div className="rm-modal-header">
          <h2 id="rm-modal-title" className="rm-modal-title">{title}</h2>
          <button className="rm-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="rm-modal-body">
          {apiError && <p className="rm-field-error rm-field-error--banner" role="alert">{apiError}</p>}

          <div className="rm-field-row">
            <div className="rm-field">
              <label htmlFor="rm-prodotto" className="rm-label">Prodotto <span aria-hidden="true">*</span></label>
              <select id="rm-prodotto" className="rm-input rm-select" value={form.progettoId} onChange={set('progettoId')}>
                <option value="">— Seleziona —</option>
                {prodotti.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div className="rm-field">
              <label htmlFor="rm-stato" className="rm-label">Stato</label>
              <select id="rm-stato" className="rm-input rm-select" value={form.stato} onChange={set('stato')}>
                {statiList.map(s => <option key={s.chiave} value={s.chiave}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="rm-field">
            <label htmlFor="rm-titolo" className="rm-label">Titolo <span aria-hidden="true">*</span></label>
            <input id="rm-titolo" className="rm-input" type="text" value={form.titolo} onChange={set('titolo')}
              placeholder="es. Nuova app Controller" autoFocus />
          </div>

          <div className="rm-field">
            <label htmlFor="rm-desc" className="rm-label">Descrizione</label>
            <textarea id="rm-desc" className="rm-input rm-textarea" value={form.descrizione} onChange={set('descrizione')}
              placeholder="Dettagli dell'iniziativa…" rows={2} />
          </div>

          <div className="rm-field-row">
            <div className="rm-field">
              <label htmlFor="rm-anno" className="rm-label">Anno <span aria-hidden="true">*</span></label>
              <input id="rm-anno" className="rm-input" type="number" value={form.anno} onChange={set('anno')} />
            </div>
            <div className="rm-field">
              <label htmlFor="rm-quarter" className="rm-label">Trimestre</label>
              <select id="rm-quarter" className="rm-input rm-select" value={form.quarter} onChange={set('quarter')}>
                {QUARTERS.map(q => <option key={q.key} value={q.key}>{q.label}</option>)}
              </select>
            </div>
          </div>

          <div className="rm-field-row">
            <div className="rm-field">
              <label htmlFor="rm-deadline" className="rm-label">Data deadline</label>
              <input id="rm-deadline" className="rm-input" type="date" value={form.dataDeadline} onChange={set('dataDeadline')} />
            </div>
            <div className="rm-field">
              <label htmlFor="rm-stima" className="rm-label">Stima gg</label>
              <input id="rm-stima" className="rm-input" type="number" min="0" step="0.5" value={form.stimaGg} onChange={set('stimaGg')} />
            </div>
          </div>

          <div className="rm-field">
            <label htmlFor="rm-analisi" className="rm-label">Link analisi (Google Drive)</label>
            <input id="rm-analisi" className="rm-input" type="url" value={form.analisiUrl} onChange={set('analisiUrl')}
              placeholder="https://drive.google.com/…" />
          </div>
        </div>
        <div className="rm-modal-footer">
          <button className="rm-btn rm-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="rm-btn rm-btn--primary" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

interface RoadmapCardProps {
  item: RoadmapItem; secondary: 'stato' | 'quarter'; statiMap: Map<string, StatoRoadmapConfig>
  po: PoRef | undefined
  onDragStart: () => void; onDrop: (e: React.DragEvent) => void; onOpen: () => void
}

function RoadmapCard({ item, secondary, statiMap, po, onDragStart, onDrop, onOpen }: RoadmapCardProps) {
  return (
    <div className="rm-card" draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
      onDrop={e => { e.stopPropagation(); onDrop(e) }}>
      <div className="rm-card-head">
        <ProdottoBadge prodotto={item.progetto} />
        {item.analisiUrl && (
          <a href={item.analisiUrl} target="_blank" rel="noreferrer" className="rm-analisi-link" aria-label="Apri analisi">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="14" height="14"><path d="M8 12l5-5M9 4h6v6M15 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </a>
        )}
      </div>
      <button className="rm-card-title" type="button" onClick={onOpen}>{item.titolo}</button>
      <div className="rm-card-foot">
        {secondary === 'stato'
          ? <StatoBadge stato={item.stato} statiMap={statiMap} />
          : <QuarterBadge quarter={item.quarter} />}
        {item.stimaGg !== null && <span className="rm-card-meta">{item.stimaGg}gg</span>}
        {item.dataDeadline && <span className="rm-card-meta">{fmtDate(item.dataDeadline)}</span>}
        {po && <span className="rm-po-avatar rm-po-avatar--sm" title={poFullName(po)}>{poInitials(po)}</span>}
      </div>
    </div>
  )
}

function ConfirmDelete({ item, loading, onConfirm, onClose }: {
  item: RoadmapItem; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="rm-del-title">
      <div className="rm-modal rm-modal--sm">
        <div className="rm-modal-header">
          <h2 id="rm-del-title" className="rm-modal-title">Elimina attività</h2>
          <button className="rm-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="rm-modal-body">
          <p className="rm-confirm-text">
            Sei sicuro di voler eliminare <strong>{item.titolo}</strong>?
            <br /><span className="rm-confirm-sub">Questa azione non è reversibile.</span>
          </p>
        </div>
        <div className="rm-modal-footer">
          <button className="rm-btn rm-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="rm-btn rm-btn--danger" type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── RoadmapPage ──────────────────────────────────────────────────────────────

interface RoadmapPageProps { token: string }

export default function RoadmapPage({ token }: RoadmapPageProps) {
  const currentYear = new Date().getFullYear()

  const [items,       setItems]       = useState<RoadmapItem[]>([])
  const [prodotti,    setProdotti]    = useState<Prodotto[]>([])
  const [pms,         setPms]         = useState<PoRef[]>([])
  const [statiConfig, setStatiConfig] = useState<StatoRoadmapConfig[]>([])
  const [loading,     setLoading]     = useState(true)
  const [apiError,    setApiError]    = useState<string | null>(null)

  const [view, setView] = useState<'lista' | 'kanban-trimestre' | 'kanban-stati'>('lista')
  const [anno, setAnno] = useState(currentYear)
  const [filterProdotto, setFilterProdotto] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [search, setSearch] = useState('')

  const [modal,     setModal]     = useState<'add' | 'edit' | null>(null)
  const [editing,   setEditing]   = useState<RoadmapItem | null>(null)
  const [form,      setForm]      = useState<FormData>(emptyForm(currentYear))
  const [saving,    setSaving]    = useState(false)
  const [formErr,   setFormErr]   = useState<string | null>(null)
  const [delTarget, setDelTarget] = useState<RoadmapItem | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const dragIdRef = useRef<string | null>(null)

  const pmById = useMemo(() => new Map(pms.map(p => [p.id, p])), [pms])
  const prodottoById = useMemo(() => new Map(prodotti.map(p => [p.id, p])), [prodotti])
  const statiMap = useMemo(() => new Map(statiConfig.map(s => [s.chiave, s])), [statiConfig])
  const statiList = useMemo(() => [...statiConfig].sort((a, b) => a.ordine - b.ordine), [statiConfig])

  const fetchAll = useCallback(async () => {
    setLoading(true); setApiError(null)
    try {
      const [rI, rP, rPm, rS] = await Promise.all([
        fetch(`${API_URL}/api/roadmap-items`,   { headers: authHeaders(token) }),
        fetch(`${API_URL}/progetti?tipo=PRODOTTO`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/pm`,                  { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/stati-roadmap`,   { headers: authHeaders(token) }),
      ])
      if (!rI.ok || !rP.ok) throw new Error()
      const [i, p, pm, s] = await Promise.all([
        rI.json(), rP.json(), rPm.ok ? rPm.json() : Promise.resolve([]), rS.ok ? rS.json() : Promise.resolve([]),
      ])
      setItems(i); setProdotti(p); setPms(pm); setStatiConfig(s)
    } catch { setApiError('Impossibile caricare i dati della roadmap.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { queueMicrotask(() => { fetchAll() }) }, [fetchAll])

  const anni = useMemo(() => {
    const set = new Set(items.map(i => i.anno))
    set.add(currentYear)
    return [...set].sort((a, b) => a - b)
  }, [items, currentYear])

  const displayItems = useMemo(() => {
    return items
      .filter(i => i.anno === anno)
      .filter(i => !filterProdotto || i.progettoId === filterProdotto)
      .filter(i => !filterStato || i.stato === filterStato)
      .filter(i => !search.trim() || i.titolo.toLowerCase().includes(search.trim().toLowerCase()))
  }, [items, anno, filterProdotto, filterStato, search])

  const listaRows = useMemo(() => {
    return [...displayItems].sort((a, b) =>
      (a.quarter ?? '').localeCompare(b.quarter ?? '') ||
      a.progetto.nome.localeCompare(b.progetto.nome, 'it') ||
      a.ordine - b.ordine
    )
  }, [displayItems])

  // ── Drag & drop (reorder scoped a prodotto+anno+quarter; quarter/stato
  //    possono essere sovrascritti spostando la card in un'altra colonna) ────

  const reorderAndPersist = useCallback((
    scopeIds: string[], draggedId: string, targetId: string | null,
    overrides: { quarter?: string | null; stato?: string } = {},
  ) => {
    setItems(prev => {
      const byId = new Map(prev.map(it => [it.id, it]))
      const dragged = byId.get(draggedId)
      if (!dragged) return prev
      const newQuarter = overrides.quarter !== undefined ? overrides.quarter : dragged.quarter
      const newStato = overrides.stato !== undefined ? overrides.stato : dragged.stato
      const seq = scopeIds.filter(id => id !== draggedId)
      let idx = targetId ? seq.indexOf(targetId) : -1
      if (idx === -1) idx = seq.length
      seq.splice(idx, 0, draggedId)

      const groupIds = seq.filter(id => {
        const it = id === draggedId ? { ...dragged, quarter: newQuarter } : byId.get(id)
        return it && it.progettoId === dragged.progettoId && it.anno === dragged.anno && (it.quarter ?? '') === (newQuarter ?? '')
      })
      const patches = groupIds.map((id, i) => ({ id, ordine: i }))
      patches.forEach(p => {
        const body = p.id === draggedId ? { ordine: p.ordine, quarter: newQuarter || null, stato: newStato } : { ordine: p.ordine }
        fetch(`${API_URL}/api/roadmap-items/${p.id}/posizione`, {
          method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(body),
        }).catch(() => {})
      })
      return prev.map(it => {
        const p = patches.find(pp => pp.id === it.id)
        if (!p) return it
        return it.id === draggedId ? { ...it, ordine: p.ordine, quarter: newQuarter, stato: newStato } : { ...it, ordine: p.ordine }
      })
    })
  }, [token])

  const onRowDragStart = (id: string) => { dragIdRef.current = id }
  const onRowDrop = (targetId: string) => {
    const draggedId = dragIdRef.current
    dragIdRef.current = null
    if (!draggedId || draggedId === targetId) return
    reorderAndPersist(listaRows.map(r => r.id), draggedId, targetId)
  }

  const onCardDrop = (columnItems: RoadmapItem[], targetId: string | null, overrides: { quarter?: string; stato?: string }) => {
    const draggedId = dragIdRef.current
    dragIdRef.current = null
    if (!draggedId) return
    reorderAndPersist(columnItems.map(i => i.id), draggedId, targetId, overrides)
  }

  // ── CRUD ──────────────────────────────────────────────────

  const openAdd = () => { setForm(emptyForm(anno)); setFormErr(null); setModal('add') }
  const openEdit = (item: RoadmapItem) => {
    setEditing(item)
    setForm({
      progettoId: item.progettoId, titolo: item.titolo, descrizione: item.descrizione ?? '',
      anno: String(item.anno), quarter: item.quarter ?? '', dataDeadline: toInputDate(item.dataDeadline),
      stato: item.stato, stimaGg: item.stimaGg !== null ? String(item.stimaGg) : '', analisiUrl: item.analisiUrl ?? '',
    })
    setFormErr(null); setModal('edit')
  }

  const handleSave = async () => {
    if (!form.progettoId) { setFormErr('Seleziona un prodotto.'); return }
    if (!form.titolo.trim()) { setFormErr('Il titolo è obbligatorio.'); return }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/api/roadmap-items/${editing!.id}` : `${API_URL}/api/roadmap-items`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const body = {
        progettoId: form.progettoId,
        titolo: form.titolo,
        descrizione: form.descrizione,
        anno: parseInt(form.anno, 10),
        quarter: form.quarter || null,
        dataDeadline: form.dataDeadline || null,
        stato: form.stato,
        stimaGg: form.stimaGg ? parseFloat(form.stimaGg) : null,
        analisiUrl: form.analisiUrl,
      }
      const res = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`); return
      }
      setModal(null); await fetchAll()
    } catch { setFormErr('Errore di rete. Riprova.') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!delTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/roadmap-items/${delTarget.id}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null); await fetchAll()
    } catch { setDelTarget(null); setApiError('Errore durante l\'eliminazione.') }
    finally { setDeleting(false) }
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="rm-page">
      <div className="rm-topbar">
        <div>
          <h1 className="rm-title">Roadmap Prodotti</h1>
          <p className="rm-subtitle">{loading ? '' : `${displayItems.length} attività · ${anno}`}</p>
        </div>
        <button className="rm-btn rm-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Nuova attività
        </button>
      </div>

      <div className="rm-toolbar">
        <div className="rm-view-toggle" role="tablist" aria-label="Vista roadmap">
          <button role="tab" aria-selected={view === 'lista'} type="button"
            className={`rm-view-btn${view === 'lista' ? ' rm-view-btn--active' : ''}`} onClick={() => setView('lista')}>
            Lista
          </button>
          <button role="tab" aria-selected={view === 'kanban-trimestre'} type="button"
            className={`rm-view-btn${view === 'kanban-trimestre' ? ' rm-view-btn--active' : ''}`} onClick={() => setView('kanban-trimestre')}>
            Kanban per trimestre
          </button>
          <button role="tab" aria-selected={view === 'kanban-stati'} type="button"
            className={`rm-view-btn${view === 'kanban-stati' ? ' rm-view-btn--active' : ''}`} onClick={() => setView('kanban-stati')}>
            Kanban per stati
          </button>
        </div>

        <select className="rm-input rm-select rm-filter" value={anno} onChange={e => setAnno(parseInt(e.target.value, 10))}>
          {anni.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="rm-input rm-select rm-filter" value={filterProdotto} onChange={e => setFilterProdotto(e.target.value)}>
          <option value="">Tutti i prodotti</option>
          {prodotti.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <select className="rm-input rm-select rm-filter" value={filterStato} onChange={e => setFilterStato(e.target.value)}>
          <option value="">Tutti gli stati</option>
          {statiList.map(s => <option key={s.chiave} value={s.chiave}>{s.label}</option>)}
        </select>
        <input className="rm-input rm-filter rm-filter--search" type="text" placeholder="Cerca titolo…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {apiError && !loading && <p className="rm-page-error" role="alert">{apiError}</p>}

      {loading ? (
        <div className="rm-loading">{Array.from({ length: 4 }, (_, i) => <div key={i} className="rm-skeleton" />)}</div>
      ) : displayItems.length === 0 ? (
        <div className="rm-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <path d="M6 30h8l6-16 8 28 6-16h8" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="rm-empty-text">Nessuna attività pianificata per {anno} con questi filtri.</p>
          <button className="rm-btn rm-btn--primary" type="button" onClick={openAdd}>Aggiungi la prima attività</button>
        </div>
      ) : view === 'lista' ? (
        <div className="rm-table-wrap">
          <table className="rm-table" aria-label="Elenco attività roadmap">
            <thead>
              <tr>
                <th scope="col" className="rm-th--drag"></th>
                <th scope="col">Prodotto</th>
                <th scope="col">Titolo</th>
                <th scope="col">Trimestre</th>
                <th scope="col">Stato</th>
                <th scope="col">Stima</th>
                <th scope="col">PO</th>
                <th scope="col">Analisi</th>
                <th scope="col" className="rm-th--actions">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {listaRows.map(item => (
                <tr key={item.id} className="rm-row" draggable
                  onDragStart={() => onRowDragStart(item.id)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onRowDrop(item.id)}>
                  <td className="rm-cell-drag" aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><circle cx="6" cy="5" r="1.4" /><circle cx="6" cy="10" r="1.4" /><circle cx="6" cy="15" r="1.4" /><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="10" r="1.4" /><circle cx="12" cy="15" r="1.4" /></svg>
                  </td>
                  <td><ProdottoBadge prodotto={item.progetto} /></td>
                  <td className="rm-cell-titolo">{item.titolo}</td>
                  <td className="rm-cell-text">{QUARTERS.find(q => q.key === (item.quarter ?? ''))?.label ?? item.quarter}</td>
                  <td><StatoBadge stato={item.stato} statiMap={statiMap} /></td>
                  <td className="rm-cell-text">{item.stimaGg !== null ? `${item.stimaGg}gg` : '—'}</td>
                  <td className="rm-cell-text">
                    {(() => { const po = pmById.get(prodottoById.get(item.progettoId)?.poId ?? ''); return po
                      ? <span className="rm-po-avatar" title={poFullName(po)}>{poInitials(po)}</span>
                      : <span className="rm-empty-cell">—</span> })()}
                  </td>
                  <td className="rm-cell-text">
                    {item.analisiUrl
                      ? <a href={item.analisiUrl} target="_blank" rel="noreferrer" className="rm-analisi-link" aria-label="Apri analisi">
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15"><path d="M8 12l5-5M9 4h6v6M15 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </a>
                      : <span className="rm-empty-cell">—</span>}
                  </td>
                  <td className="rm-cell-actions">
                    <button className="rm-icon-btn" type="button" aria-label={`Modifica ${item.titolo}`} onClick={() => openEdit(item)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="rm-icon-btn rm-icon-btn--danger" type="button" aria-label={`Elimina ${item.titolo}`} onClick={() => setDelTarget(item)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                        <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === 'kanban-trimestre' ? (
        <div className="rm-board">
          {QUARTERS.map(col => {
            const colItems = [...displayItems]
              .filter(i => (i.quarter ?? '') === col.key)
              .sort((a, b) => a.ordine - b.ordine)
            return (
              <div key={col.key || 'backlog'} className="rm-col"
                onDragOver={e => e.preventDefault()}
                onDrop={() => onCardDrop(colItems, null, { quarter: col.key })}>
                <div className="rm-col-head">
                  <span className="rm-col-label">{col.label}</span>
                  <span className="rm-col-count">{colItems.length}</span>
                </div>
                <div className="rm-col-body">
                  {colItems.map(item => (
                    <RoadmapCard key={item.id} item={item} secondary="stato" statiMap={statiMap}
                      po={pmById.get(prodottoById.get(item.progettoId)?.poId ?? '')}
                      onDragStart={() => onRowDragStart(item.id)}
                      onDrop={() => onCardDrop(colItems, item.id, { quarter: col.key })}
                      onOpen={() => openEdit(item)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : statiList.length === 0 ? (
        <div className="rm-empty">
          <p className="rm-empty-text">Nessuno stato roadmap configurato — aggiungine uno da Impostazioni → Stati Roadmap.</p>
        </div>
      ) : (
        <div className="rm-board">
          {statiList.map(col => {
            const colItems = [...displayItems]
              .filter(i => i.stato === col.chiave)
              .sort((a, b) => a.ordine - b.ordine)
            return (
              <div key={col.chiave} className="rm-col"
                onDragOver={e => e.preventDefault()}
                onDrop={() => onCardDrop(colItems, null, { stato: col.chiave })}>
                <div className="rm-col-head">
                  <span className="rm-col-label">{col.label}</span>
                  <span className="rm-col-count">{colItems.length}</span>
                </div>
                <div className="rm-col-body">
                  {colItems.map(item => (
                    <RoadmapCard key={item.id} item={item} secondary="quarter" statiMap={statiMap}
                      po={pmById.get(prodottoById.get(item.progettoId)?.poId ?? '')}
                      onDragStart={() => onRowDragStart(item.id)}
                      onDrop={() => onCardDrop(colItems, item.id, { stato: col.chiave })}
                      onOpen={() => openEdit(item)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(modal === 'add' || modal === 'edit') && (
        <ItemModal
          title={modal === 'add' ? 'Nuova attività roadmap' : 'Modifica attività roadmap'}
          form={form} loading={saving} apiError={formErr} prodotti={prodotti} statiList={statiList}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {delTarget && (
        <ConfirmDelete item={delTarget} loading={deleting} onConfirm={handleDelete} onClose={() => setDelTarget(null)} />
      )}
    </div>
  )
}
