import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './ElencoAttivitaPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

type StatoAttivita =
  | 'In corso'
  | 'Completato'
  | 'Da iniziare'
  | 'In approvazione'
  | 'Analisi'
  | 'Fermi'
  | 'Rifiutato'

const TUTTI_GLI_STATI: StatoAttivita[] = [
  'In corso', 'Completato', 'Da iniziare', 'In approvazione', 'Analisi', 'Fermi', 'Rifiutato',
]

const STATI_ATTIVI: StatoAttivita[] = [
  'In corso', 'Da iniziare', 'In approvazione', 'Analisi', 'Fermi',
]

interface AttivitaItem {
  id: string
  cliente: string
  progetto: string
  attivita: string
  risorseCoinvolte: string
  account: string
  projectManager: string
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

const STATO_TO_ENUM: Record<StatoAttivita, string> = {
  'In corso':        'IN_CORSO',
  'Completato':      'COMPLETATO',
  'Da iniziare':     'DA_INIZIARE',
  'In approvazione': 'IN_APPROVAZIONE',
  'Analisi':         'ANALISI',
  'Fermi':           'FERMI',
  'Rifiutato':       'RIFIUTATO',
}

interface PMOption      { id: string; firstName: string; lastName: string }
interface AccountOption { id: string; firstName: string; lastName: string }
interface ClienteOption { id: string; nome: string }

type AttivitaFormData = {
  cliente: string; progetto: string; attivita: string
  risorseCoinvolte: string; account: string; projectManager: string
  stato: StatoAttivita
  giornateVendute: string; giornateConsuntivate: string
  riferimentoOrdineVendita: string
  inizio: string; deadline: string; note: string
}

const EMPTY_FORM: AttivitaFormData = {
  cliente: '', progetto: '', attivita: '', risorseCoinvolte: '',
  account: '', projectManager: '', stato: 'In corso',
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

function getProgressColor(vendute: number, consuntivate: number): string {
  if (vendute === 0) return consuntivate > 0 ? '#DC2626' : '#22C55E'
  const ratio = consuntivate / vendute
  if (ratio > 1) return '#DC2626'
  if (ratio >= 0.8) return '#F59E0B'
  return '#22C55E'
}

function getProgressPct(vendute: number, consuntivate: number): number {
  if (vendute === 0) return consuntivate > 0 ? 100 : 0
  return Math.min(Math.round((consuntivate / vendute) * 100), 100)
}

function getStatoPrevValente(attivita: AttivitaItem[]): StatoAttivita {
  const priority: StatoAttivita[] = [
    'In corso', 'In approvazione', 'Analisi', 'Fermi', 'Da iniziare', 'Completato', 'Rifiutato',
  ]
  for (const s of priority) {
    if (attivita.some(a => a.stato === s)) return s
  }
  return attivita[0]?.stato ?? 'Da iniziare'
}

// ISO week number (Mon=1)
function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { week, year: d.getUTCFullYear() }
}

function getWorkWeekLabel(): string {
  const today = new Date()
  const { week } = getISOWeek(today)
  const day = today.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(today)
  mon.setDate(today.getDate() + diffToMon)
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)

  const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
  const fmtD = (d: Date) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`

  return `Settimana ${week} — ${fmtD(mon)} / ${fmtD(fri)} ${fri.getFullYear()}`
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATO_CLASS: Record<StatoAttivita, string> = {
  'In corso':        'ea-badge--teal',
  'Completato':      'ea-badge--green',
  'Da iniziare':     'ea-badge--gray',
  'In approvazione': 'ea-badge--amber',
  'Analisi':         'ea-badge--violet',
  'Fermi':           'ea-badge--orange',
  'Rifiutato':       'ea-badge--red',
}

function StatoBadge({ stato }: { stato: StatoAttivita }) {
  return <span className={`ea-badge ${STATO_CLASS[stato] ?? ''}`}>{stato}</span>
}

// ─── Multi-select dropdown ────────────────────────────────────────────────────

interface MultiSelectProps {
  label: string
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
}

function MultiSelect({ label, options, value, onChange, disabled }: MultiSelectProps) {
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

  const displayLabel = value.length === 0
    ? label
    : value.length === 1
      ? value[0]
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
              <StatoBadge stato={opt as StatoAttivita} />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Simple select ────────────────────────────────────────────────────────────

interface SelectProps {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}

function SimpleSelect({ label, value, options, onChange }: SelectProps) {
  return (
    <div className="ea-simple-select-wrap">
      <select
        className="ea-select-btn--native"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <svg className="ea-select-chevron" viewBox="0 0 20 20" fill="none"
        stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
        <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ vendute, consuntivate }: { vendute: number; consuntivate: number }) {
  const color = getProgressColor(vendute, consuntivate)
  const pct   = getProgressPct(vendute, consuntivate)
  return (
    <div className="ea-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      aria-label={`${pct}% del budget utilizzato`}>
      <div className="ea-progress-track">
        <div className="ea-progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="ea-progress-pct" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ─── Activity detail drawer ───────────────────────────────────────────────────

function Drawer({ item, onClose }: { item: AttivitaItem; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const sfora = isSforamento(item)
  const delta = item.giornateVendute !== null && item.giornateConsuntivate !== null
    ? item.giornateVendute - item.giornateConsuntivate
    : null

  return (
    <>
      <div className="ea-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div className="ea-drawer" role="dialog" aria-modal="true" aria-label={`Dettaglio: ${item.attivita}`}>
        <div className="ea-drawer-header">
          <div className="ea-drawer-header-top">
            <StatoBadge stato={item.stato} />
            <button className="ea-drawer-close" onClick={onClose} aria-label="Chiudi dettaglio" type="button">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
                width="18" height="18" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h2 className="ea-drawer-title">{item.attivita}</h2>
          <p className="ea-drawer-sub">{item.cliente} — {item.progetto}</p>
          {sfora && (
            <div className="ea-drawer-alert" role="alert">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd" />
              </svg>
              Budget superato
            </div>
          )}
        </div>

        <div className="ea-drawer-body">
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
              <div className="ea-drawer-row">
                <dt>Risorse</dt><dd>{item.risorseCoinvolte || '—'}</dd>
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
                <ProgressBar vendute={item.giornateVendute} consuntivate={item.giornateConsuntivate} />
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
      </div>
    </>
  )
}

// ─── Group card ───────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: GruppoAttivita
  expanded: boolean
  onToggle: () => void
  onSelectItem: (item: AttivitaItem) => void
  onEditItem: (item: AttivitaItem) => void
  onDeleteItem: (item: AttivitaItem) => void
}

function GroupCard({ group, expanded, onToggle, onSelectItem, onEditItem, onDeleteItem }: GroupCardProps) {
  const statoPrev = getStatoPrevValente(group.attivita)
  const delta = group.totaleVendute - group.totaleConsuntivate

  return (
    <div className={`ea-group ${group.inSforamento ? 'ea-group--sfora' : ''}`}>
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
            {group.inSforamento && (
              <span className="ea-group-sfora-dot" aria-label="In sforamento" title="Gruppo in sforamento">
                <svg viewBox="0 0 8 8" fill="currentColor" width="8" height="8" aria-hidden="true">
                  <circle cx="4" cy="4" r="4" />
                </svg>
              </span>
            )}
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
            <span className={`ea-group-stat-val ea-group-stat-val--mono ${group.inSforamento ? 'ea-group-stat-val--red' : ''}`}>
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
            <ProgressBar vendute={group.totaleVendute} consuntivate={group.totaleConsuntivate} />
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

      {/* Activity table */}
      {expanded && (
        <div className="ea-group-body">
          <div className="ea-table-wrap">
            <table className="ea-table" aria-label={`Attività ${group.progetto}`}>
              <thead>
                <tr>
                  <th scope="col" className="ea-th ea-th--attivita">Attività</th>
                  <th scope="col" className="ea-th">Risorse</th>
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
                {group.attivita.map(item => {
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
                      <td className="ea-cell ea-cell--risorse">{item.risorseCoinvolte || '—'}</td>
                      <td className="ea-cell"><StatoBadge stato={item.stato} /></td>
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
      )}
    </div>
  )
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(gruppi: GruppoAttivita[]) {
  const rows: string[][] = [
    ['Cliente', 'Progetto', 'Attività', 'Risorse', 'Account', 'PM', 'Stato',
      'GG Vendute', 'GG Consuntivate', 'Delta', 'Inizio', 'Deadline', 'Ordine Vendita', 'Note'],
  ]
  for (const g of gruppi) {
    for (const a of g.attivita) {
      const delta = a.giornateVendute !== null && a.giornateConsuntivate !== null
        ? (a.giornateVendute - a.giornateConsuntivate).toFixed(1)
        : ''
      rows.push([
        a.cliente, a.progetto, a.attivita, a.risorseCoinvolte,
        a.account, a.projectManager, a.stato,
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

// ─── Attività Modal ───────────────────────────────────────────────────────────

interface AttivitaModalProps {
  title: string
  form: AttivitaFormData
  loading: boolean
  apiError: string | null
  clienti: ClienteOption[]
  accounts: AccountOption[]
  pms: PMOption[]
  onChange: (f: AttivitaFormData) => void
  onSave: () => void
  onClose: () => void
}

function AttivitaModal({ title, form, loading, apiError, clienti, accounts, pms, onChange, onSave, onClose }: AttivitaModalProps) {
  const set = (key: keyof AttivitaFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [key]: e.target.value })

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="ea-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ea-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
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

          {/* Row 1: cliente + progetto */}
          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-cliente" className="ea-form-label">Cliente <span aria-hidden="true">*</span></label>
              <select id="ea-f-cliente" className="ea-form-input ea-form-select"
                value={form.cliente} onChange={set('cliente')}>
                <option value="">— Seleziona cliente —</option>
                {clienti.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </div>
            <div className="ea-form-field">
              <label htmlFor="ea-f-progetto" className="ea-form-label">Progetto <span aria-hidden="true">*</span></label>
              <input id="ea-f-progetto" className="ea-form-input" type="text"
                value={form.progetto} onChange={set('progetto')} placeholder="es. Rebranding 2024" />
            </div>
          </div>

          {/* Row 2: attività (full width) */}
          <div className="ea-form-field">
            <label htmlFor="ea-f-attivita" className="ea-form-label">Attività <span aria-hidden="true">*</span></label>
            <input id="ea-f-attivita" className="ea-form-input" type="text" autoFocus
              value={form.attivita} onChange={set('attivita')} placeholder="es. Design UI screens" />
          </div>

          {/* Row 3: account + PM */}
          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-account" className="ea-form-label">Account</label>
              <select id="ea-f-account" className="ea-form-input ea-form-select"
                value={form.account} onChange={set('account')}>
                <option value="">— Nessun account —</option>
                {accounts.map(a => {
                  const name = `${a.firstName} ${a.lastName}`
                  return <option key={a.id} value={name}>{name}</option>
                })}
              </select>
            </div>
            <div className="ea-form-field">
              <label htmlFor="ea-f-pm" className="ea-form-label">Project Manager</label>
              <select id="ea-f-pm" className="ea-form-input ea-form-select"
                value={form.projectManager} onChange={set('projectManager')}>
                <option value="">— Nessun PM —</option>
                {pms.map(p => {
                  const name = `${p.firstName} ${p.lastName}`
                  return <option key={p.id} value={name}>{name}</option>
                })}
              </select>
            </div>
          </div>

          {/* Row 4: risorse + stato */}
          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-risorse" className="ea-form-label">Risorse coinvolte</label>
              <input id="ea-f-risorse" className="ea-form-input" type="text"
                value={form.risorseCoinvolte} onChange={set('risorseCoinvolte')}
                placeholder="es. Mario, Laura" />
            </div>
            <div className="ea-form-field">
              <label htmlFor="ea-f-stato" className="ea-form-label">Stato</label>
              <select id="ea-f-stato" className="ea-form-input ea-form-select"
                value={form.stato} onChange={set('stato')}>
                {TUTTI_GLI_STATI.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Row 5: GG vendute + GG consuntivate */}
          <div className="ea-form-row">
            <div className="ea-form-field">
              <label htmlFor="ea-f-vendute" className="ea-form-label">GG Vendute</label>
              <input id="ea-f-vendute" className="ea-form-input" type="number" min="0" step="0.5"
                value={form.giornateVendute} onChange={set('giornateVendute')} placeholder="0" />
            </div>
            <div className="ea-form-field">
              <label htmlFor="ea-f-consuntivate" className="ea-form-label">GG Consuntivate</label>
              <input id="ea-f-consuntivate" className="ea-form-input" type="number" min="0" step="0.5"
                value={form.giornateConsuntivate} onChange={set('giornateConsuntivate')} placeholder="0" />
            </div>
          </div>

          {/* Row 6: inizio + deadline */}
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

          {/* Ordine vendita */}
          <div className="ea-form-field">
            <label htmlFor="ea-f-ordine" className="ea-form-label">Riferimento ordine vendita</label>
            <input id="ea-f-ordine" className="ea-form-input" type="text"
              value={form.riferimentoOrdineVendita} onChange={set('riferimentoOrdineVendita')}
              placeholder="es. OV-2024-001" />
          </div>

          {/* Note */}
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
    </div>
  )
}

// ─── Confirm delete attività ──────────────────────────────────────────────────

function ConfirmDeleteAttivita({ item, loading, onConfirm, onClose }: {
  item: AttivitaItem; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="ea-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ea-del-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
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
    </div>
  )
}

// ─── ElencoAttivitaPage ───────────────────────────────────────────────────────

interface ElencoAttivitaPageProps { token: string }

export default function ElencoAttivitaPage({ token }: ElencoAttivitaPageProps) {
  const [data,        setData]        = useState<AttivitaResponse | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [filtroAcc,   setFiltroAcc]   = useState('')
  const [filtroPM,    setFiltroPM]    = useState('')
  const [filtroStato, setFiltroStato] = useState<string[]>([])
  const [soloAttivi,  setSoloAttivi]  = useState(false)
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())
  const [selected,    setSelected]    = useState<AttivitaItem | null>(null)

  // Options for dropdowns
  const [clientiOpts,  setClientiOpts]  = useState<ClienteOption[]>([])
  const [accountsOpts, setAccountsOpts] = useState<AccountOption[]>([])
  const [pmsOpts,      setPmsOpts]      = useState<PMOption[]>([])

  // CRUD state
  const [modal,     setModal]     = useState<'add' | 'edit' | null>(null)
  const [editing,   setEditing]   = useState<AttivitaItem | null>(null)
  const [form,      setForm]      = useState<AttivitaFormData>(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)
  const [formErr,   setFormErr]   = useState<string | null>(null)
  const [delTarget, setDelTarget] = useState<AttivitaItem | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, rC, rA, rP] = await Promise.all([
        fetch(`${API_URL}/api/attivita`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/clienti`,      { headers: authHeaders(token) }),
        fetch(`${API_URL}/accounts`,     { headers: authHeaders(token) }),
        fetch(`${API_URL}/pm`,           { headers: authHeaders(token) }),
      ])
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      const [json, clienti, accounts, pms] = await Promise.all([
        res.json() as Promise<AttivitaResponse>,
        rC.ok ? rC.json() : Promise.resolve([]),
        rA.ok ? rA.json() : Promise.resolve([]),
        rP.ok ? rP.json() : Promise.resolve([]),
      ])
      setData(json)
      setClientiOpts(clienti)
      setAccountsOpts(accounts)
      setPmsOpts(pms)
      // Auto-expand sforamento groups on first load
      const sfora = new Set(
        json.gruppi.filter((g: GruppoAttivita) => g.inSforamento).map((g: GruppoAttivita) => `${g.cliente}|||${g.progetto}`)
      )
      setExpanded(sfora)
    } catch {
      setError('Impossibile caricare le attività. Verifica la connessione.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  // ── CRUD handlers ──

  const openAdd = () => { setForm(EMPTY_FORM); setFormErr(null); setModal('add') }

  const openEdit = (item: AttivitaItem) => {
    setEditing(item)
    setForm({
      cliente:                  item.cliente,
      progetto:                 item.progetto,
      attivita:                 item.attivita,
      risorseCoinvolte:         item.risorseCoinvolte,
      account:                  item.account,
      projectManager:           item.projectManager,
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
    if (!form.cliente.trim() || !form.progetto.trim() || !form.attivita.trim()) {
      setFormErr('Cliente, progetto e attività sono obbligatori.')
      return
    }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/api/attivita/${editing!.id}` : `${API_URL}/api/attivita`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const body = {
        cliente:                  form.cliente.trim(),
        progetto:                 form.progetto.trim(),
        attivita:                 form.attivita.trim(),
        risorseCoinvolte:         form.risorseCoinvolte.trim(),
        account:                  form.account.trim(),
        projectManager:           form.projectManager.trim(),
        stato:                    STATO_TO_ENUM[form.stato],
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
      setModal(null)
      await fetchData()
    } catch {
      setFormErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!delTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/attivita/${delTarget.id}`, {
        method: 'DELETE', headers: authHeaders(token),
      })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null)
      await fetchData()
    } catch {
      setDelTarget(null)
      setError('Errore durante l\'eliminazione.')
    } finally {
      setDeleting(false)
    }
  }

  // Unique values for filter dropdowns
  const uniqueAccounts = useMemo(() => {
    if (!data) return []
    return [...new Set(data.gruppi.map(g => g.account).filter(Boolean))].sort()
  }, [data])

  const uniquePMs = useMemo(() => {
    if (!data) return []
    return [...new Set(data.gruppi.map(g => g.projectManager).filter(Boolean))].sort()
  }, [data])

  // Effective stato options (soloAttivi restricts what's shown)
  const statoOptions = useMemo(
    () => soloAttivi ? STATI_ATTIVI : TUTTI_GLI_STATI,
    [soloAttivi]
  )

  // Client-side filtering
  const filteredGruppi = useMemo(() => {
    if (!data) return []
    return data.gruppi
      .map(g => {
        let att = g.attivita
        if (filtroAcc)          att = att.filter(a => a.account === filtroAcc)
        if (filtroPM)           att = att.filter(a => a.projectManager === filtroPM)
        if (filtroStato.length) att = att.filter(a => filtroStato.includes(a.stato))
        if (soloAttivi)         att = att.filter(a => (STATI_ATTIVI as string[]).includes(a.stato))
        return { ...g, attivita: att }
      })
      .filter(g => g.attivita.length > 0)
  }, [data, filtroAcc, filtroPM, filtroStato, soloAttivi])

  // Recompute riepilogo from filtered data
  const filteredRiepilogo = useMemo((): Riepilogo => {
    const all = filteredGruppi.flatMap(g => g.attivita)
    return {
      totaleProgetti:             filteredGruppi.length,
      totaleAttivita:             all.length,
      attivitaInSforamento:       all.filter(isSforamento).length,
      attivitaInApprovazione:     all.filter(a => a.stato === 'In approvazione').length,
      totaleGiornateVendute:      all.reduce((s, a) => s + (a.giornateVendute ?? 0), 0),
      totaleGiornateConsuntivate: all.reduce((s, a) => s + (a.giornateConsuntivate ?? 0), 0),
    }
  }, [filteredGruppi])

  const groupKey = (g: GruppoAttivita) => `${g.cliente}|||${g.progetto}`

  const toggleGroup = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const expandAll  = () => setExpanded(new Set(filteredGruppi.map(groupKey)))
  const collapseAll = () => setExpanded(new Set())

  const hasFilters = filtroAcc || filtroPM || filtroStato.length > 0 || soloAttivi

  return (
    <div className="ea-page">

      {/* ── Top bar ── */}
      <div className="ea-topbar">
        <div className="ea-topbar-left">
          <h1 className="ea-title">Elenco Attività</h1>
          <p className="ea-week-label">{getWorkWeekLabel()}</p>
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
              disabled={loading || filteredGruppi.length === 0}>
              Espandi tutto
            </button>
            <button type="button" className="ea-btn ea-btn--ghost" onClick={collapseAll}
              disabled={loading || filteredGruppi.length === 0}>
              Collassa tutto
            </button>
          </div>
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
        <SimpleSelect
          label="Account"
          value={filtroAcc}
          options={uniqueAccounts}
          onChange={setFiltroAcc}
        />
        <SimpleSelect
          label="Project Manager"
          value={filtroPM}
          options={uniquePMs}
          onChange={setFiltroPM}
        />
        <MultiSelect
          label="Stato"
          options={statoOptions}
          value={filtroStato}
          onChange={v => {
            const valid = v.filter(s => (statoOptions as string[]).includes(s))
            setFiltroStato(valid)
          }}
        />
        <Toggle
          label="Solo attivi"
          checked={soloAttivi}
          onChange={v => {
            setSoloAttivi(v)
            if (v) setFiltroStato(prev => prev.filter(s => (STATI_ATTIVI as string[]).includes(s)))
          }}
        />
        {hasFilters && (
          <button type="button" className="ea-filters-reset" onClick={() => {
            setFiltroAcc(''); setFiltroPM(''); setFiltroStato([]); setSoloAttivi(false)
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
          <button type="button" className="ea-error-retry" onClick={fetchData}>Riprova</button>
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
      {!loading && !error && filteredGruppi.length === 0 && (
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
              onClick={() => { setFiltroAcc(''); setFiltroPM(''); setFiltroStato([]); setSoloAttivi(false) }}>
              Rimuovi filtri
            </button>
          )}
        </div>
      )}

      {/* ── Group list ── */}
      {!loading && !error && filteredGruppi.length > 0 && (
        <div className="ea-groups" role="list">
          {filteredGruppi.map(g => {
            const key = groupKey(g)
            return (
              <div key={key} role="listitem">
                <GroupCard
                  group={g}
                  expanded={expanded.has(key)}
                  onToggle={() => toggleGroup(key)}
                  onSelectItem={setSelected}
                  onEditItem={openEdit}
                  onDeleteItem={setDelTarget}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* ── Detail drawer ── */}
      {selected && <Drawer item={selected} onClose={() => setSelected(null)} />}

      {/* ── Add / edit modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <AttivitaModal
          title={modal === 'add' ? 'Aggiungi attività' : 'Modifica attività'}
          form={form}
          loading={saving}
          apiError={formErr}
          clienti={clientiOpts}
          accounts={accountsOpts}
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
  )
}
