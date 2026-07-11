import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SectionModal } from '../components/SectionModal'
import './ElencoAttivitaPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

type StatoAttivita = string  // chiave DB, es. "IN_CORSO"
type GroupBy = 'cliente' | 'progetto'

interface StatoConfigItem {
  id: string; chiave: string; label: string
  colore: string; isArchiviato: boolean; escludiDaConteggio: boolean; ordine: number
}

// Context per la mappa chiave→config (evita prop-drilling nei subcomponenti)
const StatiCtx = createContext<Map<string, StatoConfigItem>>(new Map())

interface AttivitaItem {
  id: string
  cliente: string;        clienteId: string | null
  progetto: string;       progettoId: string | null
  account: string;        accountId: string | null
  projectManager: string; pmIds: string[]
  attivita: string
  giornateVendute: number | null
  giornateConsuntivate: number | null
  riferimentoOrdineVendita: string | null
  stato: StatoAttivita
  inizio: string | null
  deadline: string | null
  note: string | null
}

interface GruppoAttivita {
  cliente: string
  progetto: string
  account: string
  projectManager: string
  totaleVendute: number
  totaleConsuntivate: number
  inSforamento: boolean
  attivita: AttivitaItem[]
}

interface GruppoCliente {
  cliente: string
  totaleVendute: number
  totaleConsuntivate: number
  inSforamento: boolean
  attivita: AttivitaItem[]
}

interface Riepilogo {
  totaleProgetti: number
  totaleAttivita: number
  attivitaInSforamento: number
  attivitaInApprovazione: number
  totaleGiornateVendute: number
  totaleGiornateConsuntivate: number
}

interface AttivitaResponse {
  gruppi: GruppoAttivita[]
  riepilogo: Riepilogo
}

// ─── CRUD types ───────────────────────────────────────────────────────────────

interface PMOption      { id: string; firstName: string | null; lastName: string }
interface AccountOption { id: string; firstName: string | null; lastName: string }
interface ClienteOption {
  id: string; nome: string; accountId: string | null
  account: { id: string; firstName: string | null; lastName: string } | null
}
interface ProgettoOption { id: string; nome: string; clienteId: string | null; clienteNome: string | null }

type AttivitaFormData = {
  clienteId: string; progettoId: string; pmIds: string[]
  attivita: string
  stato: StatoAttivita
  giornateVendute: string; giornateConsuntivate: string
  riferimentoOrdineVendita: string
  inizio: string; deadline: string; note: string
}

const EMPTY_FORM: AttivitaFormData = {
  clienteId: '', progettoId: '', pmIds: [],
  attivita: '', stato: 'IN_CORSO',
  giornateVendute: '', giornateConsuntivate: '',
  riferimentoOrdineVendita: '', inizio: '', deadline: '', note: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

function authHeadersJson(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function fmt(n: number | null): string {
  if (n === null) return '—'
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function isSforamento(item: AttivitaItem): boolean {
  const cons = item.giornateConsuntivate ?? 0
  if (cons === 0) return false
  if (item.giornateVendute === null) return true
  return cons > item.giornateVendute
}

function getMargineColor(vendute: number, consuntivate: number): string {
  if (vendute === 0) return consuntivate > 0 ? '#DC2626' : '#94A3B8'
  const pct = (vendute - consuntivate) / vendute * 100
  if (pct < 0)  return '#DC2626'
  if (pct < 20) return '#F59E0B'
  return '#16A34A'
}

function getMargineLabel(vendute: number, consuntivate: number): string {
  if (vendute === 0) return '—'
  const pct = Math.round((vendute - consuntivate) / vendute * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

function getStatoPrevValente(attivita: AttivitaItem[], statiMap: Map<string, StatoConfigItem>): StatoAttivita {
  const chiavi = [...new Set(attivita.map(a => a.stato))]
  if (chiavi.length === 0) return 'IN_CORSO'
  return chiavi.sort((a, b) => {
    const ca = statiMap.get(a)
    const cb = statiMap.get(b)
    const archA = ca?.isArchiviato ?? false
    const archB = cb?.isArchiviato ?? false
    if (archA !== archB) return archA ? 1 : -1
    return (ca?.ordine ?? 99) - (cb?.ordine ?? 99)
  })[0]
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatoBadge({ stato }: { stato: StatoAttivita }) {
  const statiMap = useContext(StatiCtx)
  const cfg = statiMap.get(stato)
  const label  = cfg?.label  ?? stato
  const colore = cfg?.colore ?? '#94a3b8'
  return (
    <span
      className="ea-badge"
      style={{
        backgroundColor: colore + '22',
        color:           colore,
        borderColor:     colore + '55',
        border:          '1px solid',
      }}
    >
      {label}
    </span>
  )
}

// ─── Inline stato editor ──────────────────────────────────────────────────────

function InlineStatoEdit({ item, onChangeStato }: {
  item: AttivitaItem
  onChangeStato: (item: AttivitaItem, newStato: string) => Promise<void>
}) {
  const statiMap = useContext(StatiCtx)
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })
  const [saving, setSaving] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function outside(e: MouseEvent) {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  useEffect(() => {
    if (!open) return
    function updatePos() {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect()
        setDropPos({ top: r.bottom + 4, left: r.left })
      }
    }
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  const statiList = [...statiMap.values()].sort((a, b) => a.ordine - b.ordine)

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (saving) return
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  const handleSelect = async (e: React.MouseEvent, chiave: string) => {
    e.stopPropagation()
    if (chiave === item.stato) { setOpen(false); return }
    setSaving(true)
    await onChangeStato(item, chiave)
    setSaving(false)
    setOpen(false)
  }

  return (
    <div className="ea-stato-edit" onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className={`ea-stato-edit-btn${saving ? ' ea-stato-edit-btn--saving' : ''}`}
        onClick={handleOpen}
        aria-label="Cambia stato"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Clicca per cambiare stato"
      >
        <StatoBadge stato={item.stato} />
        <svg className="ea-stato-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="2" width="10" height="10" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={dropRef}
          className="ea-stato-dropdown"
          role="listbox"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left }}
        >
          {statiList.map(s => (
            <button
              key={s.chiave}
              type="button"
              role="option"
              aria-selected={s.chiave === item.stato}
              className={`ea-stato-dropdown-item${s.chiave === item.stato ? ' ea-stato-dropdown-item--active' : ''}`}
              onClick={e => handleSelect(e, s.chiave)}
            >
              <StatoBadge stato={s.chiave} />
              {s.chiave === item.stato && (
                <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11" aria-hidden="true">
                  <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.35 2.35 4.492-6.738a.75.75 0 0 1 1.044-.206z" clipRule="evenodd"/>
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Multi-select dropdown ────────────────────────────────────────────────────

interface MultiSelectProps {
  label: string
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
  getOptionLabel?: (opt: string) => string
}

function MultiSelect({ label, options, value, onChange, disabled, getOptionLabel }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }

  const getLabel = getOptionLabel ?? ((s: string) => s)
  const displayLabel = value.length === 0
    ? label
    : value.length === 1
      ? getLabel(value[0])
      : `${value.length} selezionati`

  return (
    <div className="ea-multiselect" ref={ref}>
      <button
        type="button"
        className={`ea-select-btn${open ? ' ea-select-btn--open' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={value.length > 0 ? 'ea-select-btn-val--active' : ''}>{displayLabel}</span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
          width="14" height="14" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="ea-dropdown" role="listbox" aria-multiselectable="true">
          {value.length > 0 && (
            <button type="button" className="ea-dropdown-clear"
              onClick={() => { onChange([]); setOpen(false) }}>
              Rimuovi filtro
            </button>
          )}
          {options.map(opt => (
            <label key={opt} className="ea-dropdown-item">
              <input type="checkbox" checked={value.includes(opt)}
                onChange={() => toggle(opt)} />
              {getOptionLabel ? <span>{getLabel(opt)}</span> : <StatoBadge stato={opt} />}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ea-toggle-wrap">
      <span className="ea-toggle-track" data-checked={checked}>
        <input type="checkbox" className="ea-toggle-input" checked={checked}
          onChange={e => onChange(e.target.checked)} role="switch" aria-checked={checked} />
        <span className="ea-toggle-thumb" />
      </span>
      <span className="ea-toggle-label">{label}</span>
    </label>
  )
}

// ─── Riepilogo globale ────────────────────────────────────────────────────────

function RiepilogoBar({ r }: { r: Riepilogo }) {
  return (
    <div className="ea-summary" role="region" aria-label="Riepilogo globale">
      <div className="ea-summary-stat">
        <span className="ea-summary-val">{r.totaleProgetti}</span>
        <span className="ea-summary-lbl">Progetti</span>
      </div>
      <div className="ea-summary-divider" aria-hidden="true" />
      <div className="ea-summary-stat">
        <span className="ea-summary-val">{r.totaleAttivita}</span>
        <span className="ea-summary-lbl">Attività</span>
      </div>
      <div className="ea-summary-divider" aria-hidden="true" />
      <div className="ea-summary-stat">
        <span className={`ea-summary-val ${r.attivitaInSforamento > 0 ? 'ea-summary-val--red' : ''}`}>
          {r.attivitaInSforamento}
        </span>
        <span className="ea-summary-lbl">In sforamento</span>
      </div>
      <div className="ea-summary-divider" aria-hidden="true" />
      <div className="ea-summary-stat">
        <span className={`ea-summary-val ${r.attivitaInApprovazione > 0 ? 'ea-summary-val--amber' : ''}`}>
          {r.attivitaInApprovazione}
        </span>
        <span className="ea-summary-lbl">In approvazione</span>
      </div>
      <div className="ea-summary-divider" aria-hidden="true" />
      <div className="ea-summary-stat">
        <span className="ea-summary-val ea-summary-val--mono">{fmt(r.totaleGiornateVendute)}</span>
        <span className="ea-summary-lbl">GG vendute</span>
      </div>
      <div className="ea-summary-divider" aria-hidden="true" />
      <div className="ea-summary-stat">
        <span className="ea-summary-val ea-summary-val--mono">{fmt(r.totaleGiornateConsuntivate)}</span>
        <span className="ea-summary-lbl">GG consuntivate</span>
      </div>
    </div>
  )
}

// ─── Margine display ──────────────────────────────────────────────────────────

function MargineDisplay({ vendute, consuntivate }: { vendute: number; consuntivate: number }) {
  const color = getMargineColor(vendute, consuntivate)
  const label = getMargineLabel(vendute, consuntivate)
  return (
    <div className="ea-margine">
      <span className="ea-margine-val" style={{ color }}>{label}</span>
      <span className="ea-margine-lbl">Margine</span>
    </div>
  )
}

// ─── Activity detail modal (read-only) ───────────────────────────────────────

function AttivitaDetailModal({ item, onClose, onEdit }: {
  item: AttivitaItem
  onClose: () => void
  onEdit: (item: AttivitaItem) => void
}) {
  const sfora = isSforamento(item)
  const delta = item.giornateVendute !== null && item.giornateConsuntivate !== null
    ? item.giornateVendute - item.giornateConsuntivate
    : null

  return (
    <SectionModal onClose={onClose} labelledBy="ea-detail-title">
      <div className="ea-modal ea-modal--detail">
        <div className="ea-modal-header">
          <div className="ea-detail-header-top">
            <StatoBadge stato={item.stato} />
            <button className="ea-modal-close" onClick={onClose} aria-label="Chiudi dettaglio" type="button">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
                width="18" height="18" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h2 id="ea-detail-title" className="ea-modal-title">{item.attivita}</h2>
          <p className="ea-detail-sub">{item.cliente} — {item.progetto}</p>
          {sfora && (
            <div className="ea-drawer-alert" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd" />
              </svg>
              Budget superato
            </div>
          )}
        </div>

        <div className="ea-modal-body">
          <section className="ea-drawer-section">
            <h3 className="ea-drawer-section-title">Anagrafica</h3>
            <dl className="ea-drawer-dl">
              <div className="ea-drawer-row">
                <dt>Cliente</dt><dd>{item.cliente}</dd>
              </div>
              <div className="ea-drawer-row">
                <dt>Progetto</dt><dd>{item.progetto}</dd>
              </div>
              <div className="ea-drawer-row">
                <dt>Account</dt><dd>{item.account || '—'}</dd>
              </div>
              <div className="ea-drawer-row">
                <dt>Project Manager</dt><dd>{item.projectManager || '—'}</dd>
              </div>
              {item.riferimentoOrdineVendita && (
                <div className="ea-drawer-row">
                  <dt>Ordine vendita</dt><dd>{item.riferimentoOrdineVendita}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="ea-drawer-section">
            <h3 className="ea-drawer-section-title">Budget giornate</h3>
            <div className="ea-drawer-budget">
              <div className="ea-drawer-budget-item">
                <span className="ea-drawer-budget-val">{fmt(item.giornateVendute)}</span>
                <span className="ea-drawer-budget-lbl">Vendute</span>
              </div>
              <div className="ea-drawer-budget-item">
                <span className={`ea-drawer-budget-val ${sfora ? 'ea-drawer-budget-val--red' : ''}`}>
                  {fmt(item.giornateConsuntivate)}
                </span>
                <span className="ea-drawer-budget-lbl">Consuntivate</span>
              </div>
              <div className="ea-drawer-budget-item">
                <span className={`ea-drawer-budget-val ${delta !== null && delta < 0 ? 'ea-drawer-budget-val--red' : delta !== null && delta > 0 ? 'ea-drawer-budget-val--green' : ''}`}>
                  {delta !== null ? (delta >= 0 ? `+${fmt(delta)}` : fmt(delta)) : '—'}
                </span>
                <span className="ea-drawer-budget-lbl">Delta</span>
              </div>
            </div>
            {item.giornateVendute !== null && item.giornateConsuntivate !== null && (
              <div className="ea-drawer-progress-wrap">
                <MargineDisplay vendute={item.giornateVendute} consuntivate={item.giornateConsuntivate} />
              </div>
            )}
          </section>

          <section className="ea-drawer-section">
            <h3 className="ea-drawer-section-title">Pianificazione</h3>
            <dl className="ea-drawer-dl">
              <div className="ea-drawer-row">
                <dt>Inizio</dt><dd>{fmtDate(item.inizio)}</dd>
              </div>
              <div className="ea-drawer-row">
                <dt>Deadline</dt><dd>{fmtDate(item.deadline)}</dd>
              </div>
            </dl>
          </section>

          {item.note && (
            <section className="ea-drawer-section">
              <h3 className="ea-drawer-section-title">Note</h3>
              <p className="ea-drawer-note">{item.note}</p>
            </section>
          )}
        </div>

        <div className="ea-modal-footer">
          <button className="ea-btn ea-btn--ghost" type="button" onClick={onClose}>Chiudi</button>
          <button className="ea-btn ea-btn--primary" type="button"
            onClick={() => { onClose(); onEdit(item) }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
              width="14" height="14" aria-hidden="true">
              <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Modifica
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Sforamento dot ───────────────────────────────────────────────────────────

function SforamentoDot() {
  return (
    <span
      className="ea-group-sfora-dot"
      aria-label="In sforamento"
      title="Una o più attività sono in sforamento"
    >
      <svg viewBox="0 0 8 8" fill="currentColor" width="8" height="8" aria-hidden="true">
        <circle cx="4" cy="4" r="4" />
      </svg>
    </span>
  )
}

// ─── Activity rows (shared by both group types) ───────────────────────────────

interface ActivityRowsProps {
  attivita: AttivitaItem[]
  showProgetto?: boolean
  onSelectItem: (item: AttivitaItem) => void
  onEditItem: (item: AttivitaItem) => void
  onDeleteItem: (item: AttivitaItem) => void
  onChangeStato: (item: AttivitaItem, newStato: string) => Promise<void>
  tableLabel: string
}

function ActivityRows({ attivita, showProgetto, onSelectItem, onEditItem, onDeleteItem, onChangeStato, tableLabel }: ActivityRowsProps) {
  return (
    <div className="ea-group-body">
      <div className="ea-table-wrap">
        <table className="ea-table" aria-label={tableLabel}>
          <thead>
            <tr>
              <th scope="col" className="ea-th ea-th--attivita">Attività</th>
              {showProgetto && <th scope="col" className="ea-th ea-th--progetto">Progetto</th>}
              <th scope="col" className="ea-th">Stato</th>
              <th scope="col" className="ea-th ea-th--num">GG Vendute</th>
              <th scope="col" className="ea-th ea-th--num">GG Consuntivate</th>
              <th scope="col" className="ea-th ea-th--num">Delta</th>
              <th scope="col" className="ea-th">Deadline</th>
              <th scope="col" className="ea-th ea-th--ordine">Ord. Vendita</th>
              <th scope="col" className="ea-th ea-th--actions"></th>
            </tr>
          </thead>
          <tbody>
            {attivita.map(item => {
              const sfora = isSforamento(item)
              const d = item.giornateVendute !== null && item.giornateConsuntivate !== null
                ? item.giornateVendute - item.giornateConsuntivate
                : null
              return (
                <tr
                  key={item.id}
                  className={`ea-row ${sfora ? 'ea-row--sfora' : ''}`}
                  onClick={() => onSelectItem(item)}
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectItem(item) } }}
                  role="button"
                  aria-label={`Dettaglio attività: ${item.attivita}`}
                >
                  <td className="ea-cell ea-cell--attivita">
                    {sfora && (
                      <svg className="ea-row-warn" viewBox="0 0 16 16" fill="currentColor"
                        width="13" height="13" aria-label="Sforamento budget">
                        <path fillRule="evenodd" d="M6.789 2.074c.534-.927 1.888-.927 2.422 0l5.02 8.7c.534.927-.134 2.086-1.211 2.086H2.98c-1.077 0-1.745-1.159-1.211-2.087l5.02-8.699zM8 5a.6.6 0 0 1 .6.6v2.8a.6.6 0 0 1-1.2 0V5.6A.6.6 0 0 1 8 5zm0 7.2a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6z" clipRule="evenodd" />
                      </svg>
                    )}
                    {item.attivita}
                  </td>
                  {showProgetto && <td className="ea-cell ea-cell--progetto">{item.progetto}</td>}
                  <td className="ea-cell ea-cell--stato" onClick={e => e.stopPropagation()}>
                    <InlineStatoEdit item={item} onChangeStato={onChangeStato} />
                  </td>
                  <td className="ea-cell ea-cell--num ea-cell--mono">{fmt(item.giornateVendute)}</td>
                  <td className={`ea-cell ea-cell--num ea-cell--mono ${sfora ? 'ea-cell--red' : ''}`}>
                    {fmt(item.giornateConsuntivate)}
                  </td>
                  <td className={`ea-cell ea-cell--num ea-cell--mono ${d !== null && d < 0 ? 'ea-cell--red' : d !== null && d > 0 ? 'ea-cell--green' : ''}`}>
                    {d !== null ? (d >= 0 ? `+${fmt(d)}` : fmt(d)) : '—'}
                  </td>
                  <td className="ea-cell">{fmtDate(item.deadline)}</td>
                  <td className="ea-cell ea-cell--ordine">{item.riferimentoOrdineVendita || '—'}</td>
                  <td className="ea-cell ea-cell-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="ea-icon-btn"
                      type="button"
                      aria-label={`Modifica ${item.attivita}`}
                      onClick={() => onEditItem(item)}
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15" aria-hidden="true">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      className="ea-icon-btn ea-icon-btn--danger"
                      type="button"
                      aria-label={`Elimina ${item.attivita}`}
                      onClick={() => onDeleteItem(item)}
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15" aria-hidden="true">
                        <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Group card (per progetto) ────────────────────────────────────────────────

interface GroupCardProps {
  group: GruppoAttivita
  expanded: boolean
  onToggle: () => void
  onSelectItem: (item: AttivitaItem) => void
  onEditItem: (item: AttivitaItem) => void
  onDeleteItem: (item: AttivitaItem) => void
  onChangeStato: (item: AttivitaItem, newStato: string) => Promise<void>
}

function GroupCard({ group, expanded, onToggle, onSelectItem, onEditItem, onDeleteItem, onChangeStato }: GroupCardProps) {
  const statiMap  = useContext(StatiCtx)
  const statoPrev = getStatoPrevValente(group.attivita, statiMap)
  const delta = group.totaleVendute - group.totaleConsuntivate

  return (
    <div className="ea-group">
      {/* Header */}
      <button
        type="button"
        className="ea-group-header"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${group.cliente} — ${group.progetto}: ${expanded ? 'Collassa' : 'Espandi'}`}
      >
        <div className="ea-group-header-main">
          <div className="ea-group-identity">
            {group.inSforamento && <SforamentoDot />}
            <div>
              <span className="ea-group-cliente">{group.cliente}</span>
              <span className="ea-group-progetto">{group.progetto}</span>
            </div>
          </div>

          <div className="ea-group-meta">
            {group.account && (
              <span className="ea-group-meta-item">
                <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11" aria-hidden="true">
                  <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3z" />
                </svg>
                {group.account}
              </span>
            )}
            {group.projectManager && (
              <span className="ea-group-meta-item">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
                  width="11" height="11" aria-hidden="true">
                  <circle cx="8" cy="5" r="2.5" />
                  <path d="M3 13.5c0-2.76 2.24-5 5-5s5 2.24 5 5" strokeLinecap="round" />
                </svg>
                {group.projectManager}
              </span>
            )}
          </div>
        </div>

        <div className="ea-group-header-stats">
          <div className="ea-group-stat">
            <span className="ea-group-stat-val ea-group-stat-val--mono">{fmt(group.totaleVendute)}</span>
            <span className="ea-group-stat-lbl">Vendute</span>
          </div>
          <div className="ea-group-stat">
            <span className="ea-group-stat-val ea-group-stat-val--mono">
              {fmt(group.totaleConsuntivate)}
            </span>
            <span className="ea-group-stat-lbl">Consuntivate</span>
          </div>
          <div className="ea-group-stat">
            <span className={`ea-group-stat-val ea-group-stat-val--mono ${delta < 0 ? 'ea-group-stat-val--red' : delta > 0 ? 'ea-group-stat-val--green' : ''}`}>
              {delta >= 0 ? `+${fmt(delta)}` : fmt(delta)}
            </span>
            <span className="ea-group-stat-lbl">Delta</span>
          </div>

          <div className="ea-group-progress-wrap">
            <MargineDisplay vendute={group.totaleVendute} consuntivate={group.totaleConsuntivate} />
          </div>

          <StatoBadge stato={statoPrev} />

          <span className="ea-group-count">{group.attivita.length} att.</span>

          <span className={`ea-group-chevron ${expanded ? 'ea-group-chevron--open' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="16" height="16">
              <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </button>

      {expanded && (
        <ActivityRows
          attivita={group.attivita}
          tableLabel={`Attività ${group.progetto}`}
          onSelectItem={onSelectItem}
          onEditItem={onEditItem}
          onDeleteItem={onDeleteItem}
          onChangeStato={onChangeStato}
        />
      )}
    </div>
  )
}

// ─── Cliente group card ────────────────────────────────────────────────────────

interface ClienteGroupCardProps {
  group: GruppoCliente
  expanded: boolean
  onToggle: () => void
  onSelectItem: (item: AttivitaItem) => void
  onEditItem: (item: AttivitaItem) => void
  onDeleteItem: (item: AttivitaItem) => void
  onChangeStato: (item: AttivitaItem, newStato: string) => Promise<void>
}

function ClienteGroupCard({ group, expanded, onToggle, onSelectItem, onEditItem, onDeleteItem, onChangeStato }: ClienteGroupCardProps) {
  const delta = group.totaleVendute - group.totaleConsuntivate

  return (
    <div className="ea-group ea-group--cliente">
      <button
        type="button"
        className="ea-group-header ea-group-header--sticky"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${group.cliente}: ${expanded ? 'Collassa' : 'Espandi'}`}
      >
        <div className="ea-group-header-main">
          <div className="ea-group-identity">
            {group.inSforamento ? <SforamentoDot /> : <span className="ea-group-sfora-dot ea-group-sfora-dot--placeholder" aria-hidden="true" />}
            <span className="ea-group-cliente ea-group-cliente--large">{group.cliente}</span>
          </div>
        </div>

        <div className="ea-group-header-stats">
          <div className="ea-group-stat">
            <span className="ea-group-stat-val ea-group-stat-val--mono">{fmt(group.totaleVendute)}</span>
            <span className="ea-group-stat-lbl">Vendute</span>
          </div>
          <div className="ea-group-stat">
            <span className="ea-group-stat-val ea-group-stat-val--mono">
              {fmt(group.totaleConsuntivate)}
            </span>
            <span className="ea-group-stat-lbl">Consuntivate</span>
          </div>
          <div className="ea-group-stat">
            <span className={`ea-group-stat-val ea-group-stat-val--mono ${delta < 0 ? 'ea-group-stat-val--red' : delta > 0 ? 'ea-group-stat-val--green' : ''}`}>
              {delta >= 0 ? `+${fmt(delta)}` : fmt(delta)}
            </span>
            <span className="ea-group-stat-lbl">Delta</span>
          </div>

          <div className="ea-group-progress-wrap">
            <MargineDisplay vendute={group.totaleVendute} consuntivate={group.totaleConsuntivate} />
          </div>

          <span className="ea-group-count">{group.attivita.length} att.</span>

          <span className={`ea-group-chevron ${expanded ? 'ea-group-chevron--open' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="16" height="16">
              <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </button>

      {expanded && (
        <ActivityRows
          attivita={group.attivita}
          showProgetto
          tableLabel={`Attività ${group.cliente}`}
          onSelectItem={onSelectItem}
          onEditItem={onEditItem}
          onDeleteItem={onDeleteItem}
          onChangeStato={onChangeStato}
        />
      )}
    </div>
  )
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(gruppi: GruppoAttivita[]) {
  const rows: string[][] = [
    ['Cliente', 'Progetto', 'Attività', 'Account', 'PM', 'Stato',
      'GG Vendute', 'GG Consuntivate', 'Delta', 'Inizio', 'Deadline', 'Ordine Vendita', 'Note'],
  ]
  for (const g of gruppi) {
    for (const a of g.attivita) {
      const delta = a.giornateVendute !== null && a.giornateConsuntivate !== null
        ? (a.giornateVendute - a.giornateConsuntivate).toFixed(1)
        : ''
      rows.push([
        a.cliente, a.progetto, a.attivita, a.account, a.projectManager, a.stato,
        a.giornateVendute !== null ? String(a.giornateVendute) : '',
        a.giornateConsuntivate !== null ? String(a.giornateConsuntivate) : '',
        delta, a.inizio ?? '', a.deadline ?? '',
        a.riferimentoOrdineVendita ?? '', a.note ?? '',
      ])
    }
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `elenco-attivita-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── PM multi-select ─────────────────────────────────────────────────────────

function PMMultiSelect({ pms, value, onChange }: {
  pms: PMOption[]; value: string[]; onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])

  const selectedNames = pms.filter(p => value.includes(p.id))
    .map(p => [p.firstName, p.lastName].filter(Boolean).join(' '))
  const label = value.length === 0
    ? '— Nessun PM —'
    : value.length === 1
      ? selectedNames[0]
      : `${value.length} PM selezionati`

  return (
    <div className="ea-pm-wrap" ref={ref}>
      <button
        type="button"
        className={`ea-form-input ea-pm-btn${open ? ' ea-pm-btn--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={value.length > 0 ? 'ea-pm-btn-active' : 'ea-pm-btn-placeholder'}>{label}</span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
          width="14" height="14" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="ea-pm-dropdown" role="listbox" aria-multiselectable="true">
          {pms.length === 0 && (
            <span className="ea-pm-empty">Nessun PM disponibile</span>
          )}
          {pms.map(p => {
            const name = [p.firstName, p.lastName].filter(Boolean).join(' ')
            const checked = value.includes(p.id)
            return (
              <label key={p.id} className={`ea-pm-item${checked ? ' ea-pm-item--checked' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} />
                <span>{name}</span>
              </label>
            )
          })}
          {value.length > 0 && (
            <button type="button" className="ea-pm-clear" onClick={() => { onChange([]); setOpen(false) }}>
              Rimuovi selezione
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Attività Modal ───────────────────────────────────────────────────────────

interface AttivitaModalProps {
  title: string
  form: AttivitaFormData
  loading: boolean
  apiError: string | null
  clienti: ClienteOption[]
  progetti: ProgettoOption[]
  pms: PMOption[]
  onChange: (f: AttivitaFormData) => void
  onSave: () => void
  onClose: () => void
}

function AttivitaModal({ title, form, loading, apiError, clienti, progetti, pms, onChange, onSave, onClose }: AttivitaModalProps) {
  const statiMap   = useContext(StatiCtx)
  const statiList  = [...statiMap.values()].sort((a, b) => a.ordine - b.ordine)
  const [oreMode, setOreMode] = useState(false)

  const set = (key: keyof AttivitaFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [key]: e.target.value })

  const progettiCliente = useMemo(
    () => progetti.filter(p => p.clienteId === form.clienteId),
    [progetti, form.clienteId]
  )

  const handleClienteChange = (clienteId: string) => {
    onChange({ ...form, clienteId, progettoId: '' })
  }

  const selectedAccount = useMemo(() => {
    const c = clienti.find(cl => cl.id === form.clienteId)
    if (!c?.account) return null
    return [c.account.firstName, c.account.lastName].filter(Boolean).join(' ')
  }, [clienti, form.clienteId])

  return (
    <SectionModal onClose={onClose} labelledBy="ea-modal-title">
      <div className="ea-modal">
        <div className="ea-modal-header">
          <h2 id="ea-modal-title" className="ea-modal-title">{title}</h2>
          <button className="ea-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ea-modal-body">
          {apiError && <p className="ea-field-error ea-field-error--banner" role="alert">{apiError}</p>}

          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-cliente" className="ea-form-label">Cliente <span aria-hidden="true">*</span></label>
              <select id="ea-f-cliente" className="ea-form-input ea-form-select"
                value={form.clienteId} onChange={e => handleClienteChange(e.target.value)}>
                <option value="">— Seleziona cliente —</option>
                {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="ea-form-field">
              <label htmlFor="ea-f-progetto" className="ea-form-label">Progetto <span aria-hidden="true">*</span></label>
              <select id="ea-f-progetto" className="ea-form-input ea-form-select"
                value={form.progettoId} onChange={e => onChange({ ...form, progettoId: e.target.value })}
                disabled={!form.clienteId}>
                <option value="">
                  {form.clienteId
                    ? progettiCliente.length === 0 ? '— Nessun progetto —' : '— Seleziona progetto —'
                    : '— Seleziona prima il cliente —'}
                </option>
                {progettiCliente.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="ea-form-field">
            <label htmlFor="ea-f-attivita" className="ea-form-label">Attività <span aria-hidden="true">*</span></label>
            <input id="ea-f-attivita" className="ea-form-input" type="text" autoFocus
              value={form.attivita} onChange={set('attivita')} placeholder="es. Design UI screens" />
          </div>

          <div className="ea-form-row">
            <div className="ea-form-field">
              <label className="ea-form-label">Account</label>
              {selectedAccount
                ? <span className="ea-account-chip">{selectedAccount}</span>
                : <span className="ea-account-empty">
                    {form.clienteId ? 'Nessun account associato al cliente' : 'Seleziona prima il cliente'}
                  </span>}
            </div>
            <div className="ea-form-field">
              <label className="ea-form-label">Project Manager</label>
              <PMMultiSelect pms={pms} value={form.pmIds}
                onChange={v => onChange({ ...form, pmIds: v })} />
            </div>
          </div>

          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-stato" className="ea-form-label">Stato</label>
              <select id="ea-f-stato" className="ea-form-input ea-form-select"
                value={form.stato} onChange={set('stato')}>
                {statiList.map(s => (
                  <option key={s.chiave} value={s.chiave}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-vendute" className="ea-form-label">GG Vendute</label>
              <input id="ea-f-vendute" className="ea-form-input" type="number" min="0" step="0.5"
                value={form.giornateVendute} onChange={set('giornateVendute')} placeholder="0" />
            </div>
            <div className="ea-form-field">
              <div className="ea-form-label-row">
                <label htmlFor="ea-f-consuntivate" className="ea-form-label">
                  {oreMode ? 'Ore Consuntivate' : 'GG Consuntivate'}
                </label>
                <button
                  type="button"
                  className={`ea-ore-toggle${oreMode ? ' ea-ore-toggle--active' : ''}`}
                  onClick={() => setOreMode(v => !v)}
                  title={oreMode ? 'Passa a giornate' : 'Inserisci in ore (÷8)'}
                >
                  {oreMode ? 'GG' : 'h'}
                </button>
              </div>
              <input
                id="ea-f-consuntivate"
                className="ea-form-input"
                type="number" min="0" step={oreMode ? '1' : '0.5'}
                value={
                  oreMode
                    ? (form.giornateConsuntivate !== '' ? String(Math.round(parseFloat(form.giornateConsuntivate) * 8 * 10) / 10) : '')
                    : form.giornateConsuntivate
                }
                onChange={e => {
                  const raw = e.target.value
                  onChange({ ...form, giornateConsuntivate: oreMode && raw !== '' ? String(parseFloat(raw) / 8) : raw })
                }}
                placeholder="0"
              />
            </div>
          </div>

          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-inizio" className="ea-form-label">Inizio</label>
              <input id="ea-f-inizio" className="ea-form-input" type="date"
                value={form.inizio} onChange={set('inizio')} />
            </div>
            <div className="ea-form-field">
              <label htmlFor="ea-f-deadline" className="ea-form-label">Deadline</label>
              <input id="ea-f-deadline" className="ea-form-input" type="date"
                value={form.deadline} onChange={set('deadline')} />
            </div>
          </div>

          <div className="ea-form-field">
            <label htmlFor="ea-f-ordine" className="ea-form-label">Riferimento ordine vendita</label>
            <input id="ea-f-ordine" className="ea-form-input" type="text"
              value={form.riferimentoOrdineVendita} onChange={set('riferimentoOrdineVendita')}
              placeholder="es. OV-2024-001" />
          </div>

          <div className="ea-form-field">
            <label htmlFor="ea-f-note" className="ea-form-label">Note</label>
            <textarea id="ea-f-note" className="ea-form-input ea-form-textarea"
              value={form.note} onChange={set('note')}
              placeholder="Informazioni aggiuntive…" rows={3} />
          </div>
        </div>
        <div className="ea-modal-footer">
          <button className="ea-btn ea-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="ea-btn ea-btn--primary" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Confirm delete attività ──────────────────────────────────────────────────

function ConfirmDeleteAttivita({ item, loading, onConfirm, onClose }: {
  item: AttivitaItem; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="ea-del-title">
      <div className="ea-modal ea-modal--sm">
        <div className="ea-modal-header">
          <h2 id="ea-del-title" className="ea-modal-title">Elimina attività</h2>
          <button className="ea-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ea-modal-body">
          <p className="ea-confirm-text">
            Sei sicuro di voler eliminare <strong>{item.attivita}</strong>?
            <br /><span className="ea-confirm-sub">{item.cliente} — {item.progetto}</span>
            <br /><span className="ea-confirm-sub">Questa azione non è reversibile.</span>
          </p>
        </div>
        <div className="ea-modal-footer">
          <button className="ea-btn ea-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="ea-btn ea-btn--danger" type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── CSV parsing helpers ──────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i += 2 }
      else if (ch === '"') { inQuotes = false; i++ }
      else { field += ch; i++ }
    } else {
      if (ch === '"') { inQuotes = true; i++ }
      else if (ch === ',') { fields.push(field); field = ''; i++ }
      else { field += ch; i++ }
    }
  }
  fields.push(field)
  return fields
}

interface TimesheetRow {
  key: string        // es. "2026-54"
  fullCode: string   // es. "GO-ORDV-2026-54"
  totalOre: number      // ore grezze dal CSV
  totalGiornate: number // ore / 8, da scrivere su giornateConsuntivate
  attivita: AttivitaItem
}

function parseTimesheet(csv: string, allAttivita: AttivitaItem[]): {
  matched: TimesheetRow[]
  notFound: string[]
} {
  const lines = csv.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 2) return { matched: [], notFound: [] }

  const header = parseCSVLine(lines[0])
  const milestoneIdx = header.findIndex(h => h.trim() === 'milestone')
  const hoursIdx     = header.findIndex(h => h.trim() === 'Hours(For Calculation)')
  if (milestoneIdx === -1 || hoursIdx === -1) return { matched: [], notFound: [] }

  const orePerKey     = new Map<string, number>()
  const fullCodePerKey = new Map<string, string>()

  for (let i = 1; i < lines.length; i++) {
    const fields    = parseCSVLine(lines[i])
    const milestone = fields[milestoneIdx]?.trim() ?? ''
    const hoursStr  = fields[hoursIdx]?.trim() ?? ''
    const match     = milestone.match(/GO-ORDV-\d{4}-\d+/)
    if (!match) continue
    const fullCode = match[0]
    const key      = fullCode.replace('GO-ORDV-', '')
    const hours    = parseFloat(hoursStr.replace(',', '.'))
    if (isNaN(hours)) continue
    orePerKey.set(key, (orePerKey.get(key) ?? 0) + hours)
    fullCodePerKey.set(key, fullCode)
  }

  const attivitaByOrdine = new Map<string, AttivitaItem>()
  for (const a of allAttivita) {
    if (a.riferimentoOrdineVendita) {
      attivitaByOrdine.set(a.riferimentoOrdineVendita.trim(), a)
    }
  }

  const matched: TimesheetRow[] = []
  const notFound: string[] = []

  for (const [key, totalOre] of orePerKey) {
    const attivita = attivitaByOrdine.get(key)
    const fullCode = fullCodePerKey.get(key)!
    if (attivita) {
      const ore = Math.round(totalOre * 100) / 100
      matched.push({ key, fullCode, totalOre: ore, totalGiornate: Math.round(ore / 8 * 100) / 100, attivita })
    } else {
      notFound.push(fullCode)
    }
  }

  matched.sort((a, b) => a.fullCode.localeCompare(b.fullCode))
  notFound.sort()
  return { matched, notFound }
}

// ─── ImportTimesheetModal ────────────────────────────────────────────────────

interface ImportTimesheetModalProps {
  token: string
  allAttivita: AttivitaItem[]
  onClose: () => void
  onImported: () => void
}

function ImportTimesheetModal({ token, allAttivita, onClose, onImported }: ImportTimesheetModalProps) {
  const [step,        setStep]       = useState<'upload' | 'preview'>('upload')
  const [dragging,    setDragging]   = useState(false)
  const [matched,       setMatched]      = useState<TimesheetRow[]>([])
  const [notFound,      setNotFound]     = useState<string[]>([])
  const [selectedIds,   setSelectedIds]  = useState<Set<string>>(new Set())
  const [importing,     setImporting]    = useState(false)
  const [importErr,     setImportErr]    = useState<string | null>(null)
  const [parseErr,      setParseErr]     = useState<string | null>(null)
  const [filtroImpAcc,  setFiltroImpAcc] = useState<string[]>([])
  const [filtroImpPM,   setFiltroImpPM]  = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uniqueImpAccounts = useMemo(() =>
    [...new Set(matched.map(r => r.attivita.account).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
    [matched]
  )
  const uniqueImpPMs = useMemo(() =>
    [...new Set(matched.map(r => r.attivita.projectManager).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
    [matched]
  )
  const visibleMatched = useMemo(() => matched.filter(r =>
    (!filtroImpAcc.length || filtroImpAcc.includes(r.attivita.account)) &&
    (!filtroImpPM.length  || filtroImpPM.includes(r.attivita.projectManager))
  ), [matched, filtroImpAcc, filtroImpPM])

  function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseErr('Seleziona un file .csv.')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? ''
      const { matched: m, notFound: nf } = parseTimesheet(text, allAttivita)
      if (m.length === 0 && nf.length === 0) {
        setParseErr('Nessun codice GO-ORDV trovato. Verifica che sia l\'export timesheet di Zoho Projects.')
        return
      }
      setMatched(m)
      setNotFound(nf)
      setSelectedIds(new Set(m.map(r => r.attivita.id)))
      setParseErr(null)
      setStep('preview')
    }
    reader.readAsText(file, 'utf-8')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(visibleMatched.map(r => r.attivita.id)) : new Set())
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleImport() {
    const updates = matched
      .filter(r => selectedIds.has(r.attivita.id))
      .map(r => ({ id: r.attivita.id, giornateConsuntivate: r.totalGiornate }))
    if (updates.length === 0) return
    setImporting(true)
    setImportErr(null)
    try {
      const res = await fetch(`${API_URL}/api/attivita/bulk-consuntivato`, {
        method: 'PATCH',
        headers: authHeadersJson(token),
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setImportErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      onImported()
      onClose()
    } catch {
      setImportErr('Errore di rete. Riprova.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <SectionModal onClose={onClose}>
      <div className="ea-modal ea-modal--import">
        <div className="ea-modal-header">
          <h2 className="ea-modal-title">Importa consuntivi da Zoho</h2>
          <button className="ea-modal-close" type="button" onClick={onClose} aria-label="Chiudi">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {step === 'upload' && (
          <div className="ea-modal-body">
            <div
              className={`ea-import-dropzone${dragging ? ' ea-import-dropzone--over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5"
                width="40" height="40" aria-hidden="true">
                <path d="M24 30V14M16 22l8-8 8 8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 36h32" strokeLinecap="round" />
                <path d="M8 28a8 8 0 0 1 0-16h1M40 28a8 8 0 0 0 0-16h-1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="ea-import-dropzone-label">
                {dragging ? 'Rilascia il file qui' : 'Trascina il CSV qui, oppure clicca per selezionarlo'}
              </p>
              <span className="ea-import-dropzone-hint">Export timesheet da Zoho Projects (.csv)</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="ea-import-file-input"
                onChange={handleFileChange}
              />
            </div>
            {parseErr && <p className="ea-import-parse-err">{parseErr}</p>}
          </div>
        )}

        {step === 'preview' && (
          <div className="ea-modal-body">
            <p className="ea-import-summary-line">
              <strong>{matched.length}</strong> attività con corrispondenza
              {notFound.length > 0 && <> · <strong>{notFound.length}</strong> codici non trovati</>}
            </p>

            {matched.length > 0 && (
              <div className="ea-import-filters">
                <MultiSelect
                  label="Account"
                  options={uniqueImpAccounts}
                  value={filtroImpAcc}
                  onChange={setFiltroImpAcc}
                  getOptionLabel={o => o}
                />
                <MultiSelect
                  label="Project Manager"
                  options={uniqueImpPMs}
                  value={filtroImpPM}
                  onChange={setFiltroImpPM}
                  getOptionLabel={o => o}
                />
              </div>
            )}

            {matched.length > 0 && (
              <div className="ea-import-section">
                <div className="ea-import-section-hd">
                  <span className="ea-import-section-title">
                    Attività da aggiornare
                    {(filtroImpAcc.length > 0 || filtroImpPM.length > 0) &&
                      <> ({visibleMatched.length} di {matched.length})</>}
                  </span>
                  <label className="ea-import-select-all">
                    <input
                      type="checkbox"
                      checked={visibleMatched.length > 0 && visibleMatched.every(r => selectedIds.has(r.attivita.id))}
                      onChange={e => toggleAll(e.target.checked)}
                    />
                    Seleziona tutti
                  </label>
                </div>
                <div className="ea-import-table-wrap">
                  <table className="ea-import-table">
                    <thead>
                      <tr>
                        <th className="ea-import-th ea-import-th--chk"></th>
                        <th className="ea-import-th">Cliente</th>
                        <th className="ea-import-th">Progetto</th>
                        <th className="ea-import-th ea-import-th--wide">Attività</th>
                        <th className="ea-import-th">Codice GO</th>
                        <th className="ea-import-th ea-import-th--num">Attuale (gg)</th>
                        <th className="ea-import-th ea-import-th--num">Nuovo (gg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMatched.map(r => {
                        const checked  = selectedIds.has(r.attivita.id)
                        const curr     = r.attivita.giornateConsuntivate ?? 0
                        const isUp     = r.totalGiornate > curr
                        const isDown   = r.totalGiornate < curr
                        return (
                          <tr
                            key={r.attivita.id}
                            className={`ea-import-row${!checked ? ' ea-import-row--dim' : ''}`}
                            onClick={() => toggleOne(r.attivita.id)}
                          >
                            <td className="ea-import-td ea-import-td--chk">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleOne(r.attivita.id)}
                                onClick={e => e.stopPropagation()}
                              />
                            </td>
                            <td className="ea-import-td ea-import-td--trunc">{r.attivita.cliente}</td>
                            <td className="ea-import-td ea-import-td--trunc">{r.attivita.progetto}</td>
                            <td className="ea-import-td">{r.attivita.attivita}</td>
                            <td className="ea-import-td ea-import-td--code">{r.fullCode}</td>
                            <td className="ea-import-td ea-import-td--num">{fmt(r.attivita.giornateConsuntivate)}</td>
                            <td className={`ea-import-td ea-import-td--num${isUp ? ' ea-import-td--up' : isDown ? ' ea-import-td--down' : ''}`}>
                              {fmt(r.totalGiornate)}{isUp ? ' ↑' : isDown ? ' ↓' : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {notFound.length > 0 && (
              <div className="ea-import-section ea-import-notfound">
                <span className="ea-import-section-title">Codici non trovati nell'applicazione</span>
                <ul className="ea-import-notfound-list">
                  {notFound.map(code => <li key={code}>{code}</li>)}
                </ul>
              </div>
            )}

            {importErr && <p className="ea-import-parse-err">{importErr}</p>}
          </div>
        )}

        <div className="ea-modal-footer">
          {step === 'upload' ? (
            <button className="ea-btn ea-btn--ghost" type="button" onClick={onClose}>Annulla</button>
          ) : (
            <>
              <button className="ea-btn ea-btn--ghost" type="button"
                onClick={() => setStep('upload')} disabled={importing}>
                Indietro
              </button>
              <button
                className="ea-btn ea-btn--primary"
                type="button"
                disabled={selectedIds.size === 0 || importing}
                onClick={handleImport}
              >
                {importing ? 'Importazione…' : `Importa ${selectedIds.size} attività`}
              </button>
            </>
          )}
        </div>
      </div>
    </SectionModal>
  )
}

// ─── ElencoAttivitaPage ───────────────────────────────────────────────────────

interface ElencoAttivitaPageProps { token: string }

export default function ElencoAttivitaPage({ token }: ElencoAttivitaPageProps) {
  const [data,        setData]        = useState<AttivitaResponse | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [filtroAcc,   setFiltroAcc]   = useState<string[]>([])
  const [filtroPM,    setFiltroPM]    = useState<string[]>([])
  const [filtroStato, setFiltroStato] = useState<string[]>([])
  const [soloAttivi,  setSoloAttivi]  = useState(true)
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())
  const [selected,    setSelected]    = useState<AttivitaItem | null>(null)

  // Group-by toggle: persisted in localStorage
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    const saved = localStorage.getItem('activityGroupBy')
    return saved === 'progetto' ? 'progetto' : 'cliente'
  })

  const handleGroupByChange = (byProgetto: boolean) => {
    const val: GroupBy = byProgetto ? 'progetto' : 'cliente'
    setGroupBy(val)
    localStorage.setItem('activityGroupBy', val)
  }

  // Config stati attività
  const [statiConfig, setStatiConfig] = useState<StatoConfigItem[]>([])
  const statiMap = useMemo(
    () => new Map(statiConfig.map(s => [s.chiave, s])),
    [statiConfig]
  )

  // Options for dropdowns
  const [clientiOpts,  setClientiOpts]  = useState<ClienteOption[]>([])
  const [accountsOpts, setAccountsOpts] = useState<AccountOption[]>([])
  const [pmsOpts,      setPmsOpts]      = useState<PMOption[]>([])
  const [progettiOpts, setProgettiOpts] = useState<ProgettoOption[]>([])

  // CRUD state
  const [modal,     setModal]     = useState<'add' | 'edit' | null>(null)
  const [editing,   setEditing]   = useState<AttivitaItem | null>(null)
  const [form,      setForm]      = useState<AttivitaFormData>(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)
  const [formErr,   setFormErr]   = useState<string | null>(null)
  const [delTarget,    setDelTarget]    = useState<AttivitaItem | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [showImport,   setShowImport]   = useState(false)

  const fetchData = useCallback(async (opts: { preserveExpanded?: boolean; silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    setError(null)
    try {
      const [res, rC, rA, rP, rPr, rSt] = await Promise.all([
        fetch(`${API_URL}/api/attivita`,       { headers: authHeaders(token) }),
        fetch(`${API_URL}/clienti`,            { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=ACCOUNT`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=PM`,      { headers: authHeaders(token) }),
        fetch(`${API_URL}/progetti?tipo=CLIENTE`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/stati-attivita`, { headers: authHeaders(token) }),
      ])
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      const [json, clienti, accounts, pms, progettiRaw, stati] = await Promise.all([
        res.json() as Promise<AttivitaResponse>,
        rC.ok  ? rC.json()  : Promise.resolve([]),
        rA.ok  ? rA.json()  : Promise.resolve([]),
        rP.ok  ? rP.json()  : Promise.resolve([]),
        rPr.ok ? rPr.json() : Promise.resolve([]),
        rSt.ok ? rSt.json() : Promise.resolve([]),
      ])
      setData(json)
      setClientiOpts(clienti)
      setAccountsOpts(accounts)
      setPmsOpts(pms)
      setStatiConfig(stati)
      setProgettiOpts(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (progettiRaw as any[]).map((p: any) => ({
          id: p.id, nome: p.nome, clienteId: p.clienteId ?? null, clienteNome: p.cliente?.nome ?? null,
        }))
      )
      // Auto-expand sforamento groups (both key formats for both view modes)
      const sforamentoExpanded = new Set<string>()
      for (const g of json.gruppi as GruppoAttivita[]) {
        if (g.inSforamento) {
          sforamentoExpanded.add(`${g.cliente}|||${g.progetto}`)
          sforamentoExpanded.add(`cliente::${g.cliente}`)
        }
      }
      if (opts.preserveExpanded) {
        setExpanded(prev => { const next = new Set(prev); sforamentoExpanded.forEach(k => next.add(k)); return next })
      } else {
        setExpanded(sforamentoExpanded)
      }
    } catch {
      setError('Impossibile caricare le attività. Verifica la connessione.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    queueMicrotask(() => { fetchData() })
  }, [fetchData])

  // ── CRUD handlers ──

  const openAdd = () => { setForm(EMPTY_FORM); setFormErr(null); setModal('add') }

  const openEdit = (item: AttivitaItem) => {
    setEditing(item)
    setForm({
      clienteId:                item.clienteId  ?? '',
      progettoId:               item.progettoId ?? '',
      pmIds:                    item.pmIds       ?? [],
      attivita:                 item.attivita,
      stato:                    item.stato,
      giornateVendute:          item.giornateVendute  != null ? String(item.giornateVendute)  : '',
      giornateConsuntivate:     item.giornateConsuntivate != null ? String(item.giornateConsuntivate) : '',
      riferimentoOrdineVendita: item.riferimentoOrdineVendita ?? '',
      inizio:                   item.inizio   ? item.inizio.slice(0, 10)   : '',
      deadline:                 item.deadline ? item.deadline.slice(0, 10) : '',
      note:                     item.note ?? '',
    })
    setFormErr(null)
    setModal('edit')
  }

  const handleSave = async () => {
    if (!form.clienteId || !form.progettoId || !form.attivita.trim()) {
      setFormErr('Cliente, progetto e attività sono obbligatori.')
      return
    }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/api/attivita/${editing!.id}` : `${API_URL}/api/attivita`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const body = {
        clienteId:                form.clienteId,
        progettoId:               form.progettoId,
        pmIds:                    form.pmIds,
        attivita:                 form.attivita.trim(),
        stato:                    form.stato,
        giornateVendute:          form.giornateVendute          !== '' ? parseFloat(form.giornateVendute)          : null,
        giornateConsuntivate:     form.giornateConsuntivate     !== '' ? parseFloat(form.giornateConsuntivate)     : null,
        riferimentoOrdineVendita: form.riferimentoOrdineVendita.trim() || null,
        inizio:                   form.inizio   || null,
        deadline:                 form.deadline || null,
        note:                     form.note.trim() || null,
      }
      const res = await fetch(url, { method, headers: authHeadersJson(token), body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      const scrollY = window.scrollY
      setModal(null)
      await fetchData({ preserveExpanded: true })
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }))
    } catch {
      setFormErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  const handleChangeStato = useCallback(async (item: AttivitaItem, newStato: string) => {
    try {
      const body = {
        clienteId:                item.clienteId,
        progettoId:               item.progettoId,
        pmIds:                    item.pmIds ?? [],
        attivita:                 item.attivita,
        stato:                    newStato,
        giornateVendute:          item.giornateVendute,
        giornateConsuntivate:     item.giornateConsuntivate,
        riferimentoOrdineVendita: item.riferimentoOrdineVendita,
        inizio:                   item.inizio,
        deadline:                 item.deadline,
        note:                     item.note,
      }
      const res = await fetch(`${API_URL}/api/attivita/${item.id}`, {
        method: 'PUT',
        headers: authHeadersJson(token),
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const scrollY = window.scrollY
      await fetchData({ preserveExpanded: true, silent: true })
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }))
    } catch {
      setError('Errore durante la modifica dello stato.')
    }
  }, [token, fetchData])

  const handleDelete = async () => {
    if (!delTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/attivita/${delTarget.id}`, {
        method: 'DELETE', headers: authHeaders(token),
      })
      if (!res.ok && res.status !== 404) throw new Error()
      const scrollY = window.scrollY
      setDelTarget(null)
      await fetchData({ preserveExpanded: true })
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }))
    } catch {
      setDelTarget(null)
      setError('Errore durante l\'eliminazione.')
    } finally {
      setDeleting(false)
    }
  }

  // Filter dropdown options from registry
  const uniqueAccounts = useMemo(() =>
    accountsOpts
      .map(a => [a.firstName, a.lastName].filter(Boolean).join(' '))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'it')),
    [accountsOpts]
  )

  const uniquePMs = useMemo(() =>
    pmsOpts
      .map(p => [p.firstName, p.lastName].filter(Boolean).join(' '))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'it')),
    [pmsOpts]
  )

  const statoOptions = useMemo(
    () => statiConfig
      .filter(s => !soloAttivi || !s.isArchiviato)
      .sort((a, b) => a.ordine - b.ordine)
      .map(s => s.chiave),
    [statiConfig, soloAttivi]
  )

  // Client-side filtering
  const filteredGruppi = useMemo(() => {
    if (!data) return []
    return data.gruppi
      .map(g => {
        let att = g.attivita
        if (filtroAcc.length)   att = att.filter(a => filtroAcc.includes(a.account))
        if (filtroPM.length)    att = att.filter(a => filtroPM.includes(a.projectManager))
        if (filtroStato.length) att = att.filter(a => filtroStato.includes(a.stato))
        if (soloAttivi)         att = att.filter(a => !(statiMap.get(a.stato)?.isArchiviato ?? false))
        return { ...g, attivita: att }
      })
      .filter(g => g.attivita.length > 0)
  }, [data, filtroAcc, filtroPM, filtroStato, soloAttivi, statiMap])

  // Derived: group by cliente from filtered data
  const filteredGruppiCliente = useMemo((): GruppoCliente[] => {
    const map = new Map<string, GruppoCliente>()
    for (const g of filteredGruppi) {
      const key = g.cliente
      if (!map.has(key)) {
        map.set(key, { cliente: g.cliente, totaleVendute: 0, totaleConsuntivate: 0, inSforamento: false, attivita: [] })
      }
      const entry = map.get(key)!
      for (const a of g.attivita) {
        const escludi = statiMap.get(a.stato)?.escludiDaConteggio ?? false
        if (!escludi) {
          entry.totaleVendute += a.giornateVendute ?? 0
          entry.totaleConsuntivate += a.giornateConsuntivate ?? 0
          if (isSforamento(a)) entry.inSforamento = true
        }
      }
      entry.attivita.push(...g.attivita)
    }
    return [...map.values()].sort((a, b) => a.cliente.localeCompare(b.cliente, 'it'))
  }, [filteredGruppi, statiMap])

  // Recompute riepilogo from filtered data
  const filteredRiepilogo = useMemo((): Riepilogo => {
    const all = filteredGruppi.flatMap(g => g.attivita)
    const contabili = all.filter(a => !(statiMap.get(a.stato)?.escludiDaConteggio ?? false))
    return {
      totaleProgetti:             filteredGruppi.length,
      totaleAttivita:             all.length,
      attivitaInSforamento:       contabili.filter(isSforamento).length,
      attivitaInApprovazione:     all.filter(a => statiMap.get(a.stato)?.escludiDaConteggio ?? false).length,
      totaleGiornateVendute:      contabili.reduce((s, a) => s + (a.giornateVendute ?? 0), 0),
      totaleGiornateConsuntivate: contabili.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0),
    }
  }, [filteredGruppi, statiMap])

  const progettoKey  = (g: GruppoAttivita) => `${g.cliente}|||${g.progetto}`
  const clienteKey   = (g: GruppoCliente)  => `cliente::${g.cliente}`

  const toggleGroup = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const expandAll = () => {
    if (groupBy === 'progetto') {
      setExpanded(new Set(filteredGruppi.map(progettoKey)))
    } else {
      setExpanded(new Set(filteredGruppiCliente.map(clienteKey)))
    }
  }
  const collapseAll = () => setExpanded(new Set())

  const hasFilters = !!(filtroAcc.length || filtroPM.length || filtroStato.length > 0 || !soloAttivi)
  const isEmpty    = groupBy === 'progetto' ? filteredGruppi.length === 0 : filteredGruppiCliente.length === 0

  return (
    <StatiCtx.Provider value={statiMap}>
    <div className="ea-page">

      {/* ── Top bar ── */}
      <div className="ea-topbar">
        <div className="ea-topbar-left">
          <h1 className="ea-title">Elenco Attività Progetti</h1>
        </div>
        <div className="ea-topbar-right">
          <button type="button" className="ea-btn ea-btn--primary" onClick={openAdd}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="15" height="15" aria-hidden="true">
              <path d="M10 4v12M4 10h12" strokeLinecap="round" />
            </svg>
            Aggiungi attività
          </button>
          <div className="ea-expand-btns">
            <button type="button" className="ea-btn ea-btn--ghost" onClick={expandAll}
              disabled={loading || isEmpty}>
              Espandi tutto
            </button>
            <button type="button" className="ea-btn ea-btn--ghost" onClick={collapseAll}
              disabled={loading || isEmpty}>
              Collassa tutto
            </button>
          </div>
          <button
            type="button"
            className="ea-btn ea-btn--outline"
            disabled={loading}
            onClick={() => setShowImport(true)}
            title="Importa consuntivi da Zoho Projects"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
              width="15" height="15" aria-hidden="true">
              <path d="M10 14V4M6 10l4 4 4-4M4 17h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Importa consuntivi
          </button>
          <button
            type="button"
            className="ea-btn ea-btn--outline"
            disabled={loading || filteredGruppi.length === 0}
            onClick={() => exportCSV(filteredGruppi)}
            title="Esporta come file CSV/Excel"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
              width="15" height="15" aria-hidden="true">
              <path d="M10 3v9M6 8l4 4 4-4M4 16h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Esporta XLS
          </button>
          <button
            type="button"
            className="ea-btn ea-btn--outline"
            disabled={loading || filteredGruppi.length === 0}
            onClick={() => window.print()}
            title="Stampa o salva come PDF"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
              width="15" height="15" aria-hidden="true">
              <path d="M5 7V4h10v3M5 15H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M5 12h10v5H5v-5z"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Stampa PDF
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="ea-filters" role="search" aria-label="Filtri attività">
        <MultiSelect
          label="Account"
          options={uniqueAccounts}
          value={filtroAcc}
          onChange={setFiltroAcc}
          getOptionLabel={o => o}
        />
        <MultiSelect
          label="Project Manager"
          options={uniquePMs}
          value={filtroPM}
          onChange={setFiltroPM}
          getOptionLabel={o => o}
        />
        <MultiSelect
          label="Stato"
          options={statoOptions}
          value={filtroStato}
          onChange={v => {
            const valid = v.filter(s => statoOptions.includes(s))
            setFiltroStato(valid)
          }}
          getOptionLabel={key => statiMap.get(key)?.label ?? key}
        />
        <div className="ea-filters-sep" aria-hidden="true" />
        <Toggle
          label="Raggruppa per Progetto"
          checked={groupBy === 'progetto'}
          onChange={handleGroupByChange}
        />
        <Toggle
          label={soloAttivi ? 'Solo attivi' : 'Tutti i progetti'}
          checked={soloAttivi}
          onChange={v => {
            setSoloAttivi(v)
            if (v) {
              const attiviChiavi = statiConfig.filter(s => !s.isArchiviato).map(s => s.chiave)
              setFiltroStato(prev => prev.filter(s => attiviChiavi.includes(s)))
            }
          }}
        />
        {hasFilters && (
          <button type="button" className="ea-filters-reset" onClick={() => {
            setFiltroAcc([]); setFiltroPM([]); setFiltroStato([]); setSoloAttivi(true)
          }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75"
              width="13" height="13" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
            Rimuovi filtri
          </button>
        )}
        {!loading && data && (
          <span className="ea-filters-count" aria-live="polite">
            {filteredRiepilogo.totaleAttivita} attività
            {filteredRiepilogo.totaleAttivita !== data.riepilogo.totaleAttivita && ` (su ${data.riepilogo.totaleAttivita})`}
          </span>
        )}
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="ea-error" role="alert">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          {error}
          <button type="button" className="ea-error-retry" onClick={() => fetchData()}>Riprova</button>
        </div>
      )}

      {/* ── Loading skeletons ── */}
      {loading && (
        <div className="ea-skeleton-list" aria-label="Caricamento in corso">
          {[...Array(4)].map((_, i) => <div key={i} className="ea-skeleton" />)}
        </div>
      )}

      {/* ── Summary ── */}
      {!loading && !error && data && (
        <RiepilogoBar r={filteredRiepilogo} />
      )}

      {/* ── Empty state ── */}
      {!loading && !error && isEmpty && (
        <div className="ea-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <rect x="8" y="12" width="32" height="4" rx="2" fill="#CBD5E1" />
            <rect x="8" y="22" width="24" height="4" rx="2" fill="#E2E8F0" />
            <rect x="8" y="32" width="28" height="4" rx="2" fill="#E2E8F0" />
          </svg>
          <p className="ea-empty-text">
            {data && data.riepilogo.totaleAttivita === 0
              ? 'Nessuna attività presente. Aggiungile dal backend.'
              : 'Nessuna attività corrisponde ai filtri selezionati.'}
          </p>
          {hasFilters && (
            <button type="button" className="ea-btn ea-btn--ghost"
              onClick={() => { setFiltroAcc([]); setFiltroPM([]); setFiltroStato([]); setSoloAttivi(true) }}>
              Rimuovi filtri
            </button>
          )}
        </div>
      )}

      {/* ── Group list ── */}
      {!loading && !error && !isEmpty && (
        <div className="ea-groups" role="list">
          {groupBy === 'progetto'
            ? filteredGruppi.map(g => {
                const key = progettoKey(g)
                return (
                  <div key={key} role="listitem">
                    <GroupCard
                      group={g}
                      expanded={expanded.has(key)}
                      onToggle={() => toggleGroup(key)}
                      onSelectItem={setSelected}
                      onEditItem={openEdit}
                      onDeleteItem={setDelTarget}
                      onChangeStato={handleChangeStato}
                    />
                  </div>
                )
              })
            : filteredGruppiCliente.map(g => {
                const key = clienteKey(g)
                return (
                  <div key={key} role="listitem">
                    <ClienteGroupCard
                      group={g}
                      expanded={expanded.has(key)}
                      onToggle={() => toggleGroup(key)}
                      onSelectItem={setSelected}
                      onEditItem={openEdit}
                      onDeleteItem={setDelTarget}
                      onChangeStato={handleChangeStato}
                    />
                  </div>
                )
              })
          }
        </div>
      )}

      {/* ── Import timesheet modal ── */}
      {showImport && (
        <ImportTimesheetModal
          token={token}
          allAttivita={data?.gruppi.flatMap(g => g.attivita) ?? []}
          onClose={() => setShowImport(false)}
          onImported={() => fetchData({ preserveExpanded: true, silent: true })}
        />
      )}

      {/* ── Detail modal ── */}
      {selected && (
        <AttivitaDetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onEdit={openEdit}
        />
      )}

      {/* ── Add / edit modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <AttivitaModal
          title={modal === 'add' ? 'Aggiungi attività' : 'Modifica attività'}
          form={form}
          loading={saving}
          apiError={formErr}
          clienti={clientiOpts}
          progetti={progettiOpts}
          pms={pmsOpts}
          onChange={setForm}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* ── Confirm delete ── */}
      {delTarget && (
        <ConfirmDeleteAttivita
          item={delTarget}
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDelTarget(null)}
        />
      )}
    </div>
    </StatiCtx.Provider>
  )
}
