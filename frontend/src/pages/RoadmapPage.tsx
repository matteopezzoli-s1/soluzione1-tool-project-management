import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { SectionModal } from '../components/SectionModal'
import { DriveLinkField } from '../components/DriveLinkField'
import { useDriveConfig } from '../lib/useDriveConfig'
import { isValidHttpUrl } from '../lib/googleDrive'
import './RoadmapPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProdottoRef { id: string; nome: string; colore: string | null; poId: string | null }
interface Prodotto { id: string; nome: string; colore: string | null; poId: string | null }
interface PoRef { id: string; firstName: string | null; lastName: string }

interface StatoRoadmapConfig {
  id: string; chiave: string; label: string; colore: string; isArchiviato: boolean; isCompletato: boolean; ordine: number
}

// Stato roadmap "in corso": auto-gestito — ci entrano gli item presi in carico
// (attività collegata aperta, con badge dello stato reale dell'attività) e i
// legacy rimasti a mano (convertibili). Non è un target di drag né di creazione.
const RETIRED_STATO = 'IN_CORSO'

// Stati attività (per il badge dello stato dell'attività collegata sulle card)
interface StatoAttivitaRef { chiave: string; label: string; colore: string; isArchiviato: boolean }

interface TagRef { id: string; label: string; colore: string }

interface RoadmapItem {
  id: string; progettoId: string; progetto: ProdottoRef
  anno: number; quarter: string | null; dataDeadline: string | null
  titolo: string; descrizione: string | null; stato: string
  analisiUrl: string | null; stimaGg: number | null; ordine: number
  tags: TagRef[]
  devHubId: string | null; devHub: PoRef | null
  // Economia (pianificazione → trasferita all'attività alla presa in carico)
  copertura: string
  clientePagante: { id: string; nome: string } | null
  giornateVendute: number | null
  riferimentoOrdineVendita: string | null
  // Attività collegata (item preso in carico): qui arrivano solo item con
  // attività CHIUSA (quelli con attività aperta sono nascosti dal backend)
  attivitaId: string | null
  attivitaStato: string | null
}

interface ClienteRef { id: string; nome: string }

type FormData = {
  progettoId: string; titolo: string; descrizione: string
  anno: string; quarter: string; dataDeadline: string
  stato: string; stimaGg: string; analisiUrl: string; tagIds: string[]
  copertura: string; clientePaganteId: string; giornateVendute: string; riferimentoOrdineVendita: string
}

const QUARTERS: { key: string; label: string }[] = [
  { key: '',   label: 'Non pianificato' },
  { key: 'Q1', label: 'Q1' },
  { key: 'Q2', label: 'Q2' },
  { key: 'Q3', label: 'Q3' },
  { key: 'Q4', label: 'Q4' },
]

function emptyForm(anno: number): FormData {
  return { progettoId: '', titolo: '', descrizione: '', anno: String(anno), quarter: '', dataDeadline: '', stato: 'DA_FARE', stimaGg: '', analisiUrl: '', tagIds: [], copertura: 'ASSORBITA', clientePaganteId: '', giornateVendute: '', riferimentoOrdineVendita: '' }
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

function fmtDateLong(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function toInputDate(iso: string | null) {
  if (!iso) return ''
  return iso.split('T')[0]
}

// Ordinamento card Kanban: deadline in ordine crescente (le più vicine prima);
// le attività senza deadline vanno in cima a tutte; a parità di data si
// mantiene l'ordine manuale.
function byDeadlineAsc(a: RoadmapItem, b: RoadmapItem): number {
  const da = a.dataDeadline ? new Date(a.dataDeadline).getTime() : null
  const db = b.dataDeadline ? new Date(b.dataDeadline).getTime() : null
  if (da === null && db === null) return a.ordine - b.ordine
  if (da === null) return -1
  if (db === null) return 1
  if (da !== db) return da - db
  return a.ordine - b.ordine
}

// ─── Icone meta (card Kanban) ─────────────────────────────────────────────────

function IconClock() {
  return <svg className="rm-meta-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6.2V10l2.6 1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function IconCalendar() {
  return <svg className="rm-meta-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="12" rx="2" /><path d="M3.5 8h13M7 3v3M13 3v3" strokeLinecap="round" /></svg>
}
function IconFlag() {
  return <svg className="rm-meta-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13" aria-hidden="true"><path d="M5.5 17V3.5M5.5 4h8l-1.8 2.8L13.5 10h-8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function IconTag() {
  return <svg className="rm-card-tags-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13" aria-hidden="true"><path d="M9.5 3H3.5v6l7.5 7.5 6-6L9.5 3z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6.4" cy="6.4" r="1" fill="currentColor" stroke="none" /></svg>
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

function TagBadge({ tag }: { tag: TagRef }) {
  return (
    <span className="rm-tag-badge" style={{ backgroundColor: tag.colore + '22', color: tag.colore, border: `1px solid ${tag.colore}55` }}>
      {tag.label}
    </span>
  )
}

function TagList({ tags, onRemove }: { tags: TagRef[]; onRemove?: (tagId: string) => void }) {
  if (tags.length === 0) return null
  return (
    <div className="rm-tag-list">
      {tags.map(t => onRemove ? (
        <span key={t.id} className="rm-tag-badge rm-tag-badge--removable"
          style={{ backgroundColor: t.colore + '22', color: t.colore, border: `1px solid ${t.colore}55` }}>
          {t.label}
          <button type="button" className="rm-tag-remove" aria-label={`Rimuovi tag ${t.label}`}
            onClick={() => onRemove(t.id)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      ) : <TagBadge key={t.id} tag={t} />)}
    </div>
  )
}

function TagPicker({ tags, selectedIds, onToggle }: { tags: TagRef[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  if (tags.length === 0) {
    return <p className="rm-field-hint">Nessun tag configurato — aggiungine uno da Impostazioni → Tag Roadmap.</p>
  }
  return (
    <div className="rm-tag-picker">
      {tags.map(t => {
        const selected = selectedIds.includes(t.id)
        return (
          <button key={t.id} type="button"
            className={`rm-tag-chip${selected ? ' rm-tag-chip--selected' : ''}`}
            style={selected ? { backgroundColor: t.colore + '22', color: t.colore, border: `1px solid ${t.colore}55` } : undefined}
            onClick={() => onToggle(t.id)}
            aria-pressed={selected}>
            {t.label}
            {selected && (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" aria-hidden="true" className="rm-tag-chip-x">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Multi-select (filtro DevHub) ─────────────────────────────────────────────

function MultiSelect({ label, options, value, onChange }: {
  label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])

  const displayLabel = value.length === 0
    ? label
    : value.length === 1
      ? options.find(o => o.id === value[0])?.label ?? label
      : `${value.length} selezionati`

  return (
    <div className="rm-multiselect" ref={ref}>
      <button type="button" className={`rm-input rm-select rm-filter rm-ms-btn${open ? ' rm-ms-btn--open' : ''}`}
        onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={value.length > 0 ? 'rm-ms-btn-val--active' : ''}>{displayLabel}</span>
      </button>
      {open && (
        <div className="rm-ms-dropdown" role="listbox" aria-multiselectable="true">
          {value.length > 0 && (
            <button type="button" className="rm-ms-clear" onClick={() => { onChange([]); setOpen(false) }}>
              Rimuovi filtro
            </button>
          )}
          {options.length === 0 && <span className="rm-field-hint">Nessun DevHub disponibile</span>}
          {options.map(opt => (
            <label key={opt.id} className="rm-ms-item">
              <input type="checkbox" checked={value.includes(opt.id)} onChange={() => toggle(opt.id)} />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Modal add/edit ───────────────────────────────────────────────────────────

interface ModalProps {
  title: string; form: FormData; loading: boolean; apiError: string | null
  prodotti: Prodotto[]; statiList: StatoRoadmapConfig[]; tags: TagRef[]; clienti: ClienteRef[]
  // Stato guidato dall'attività collegata (item preso in carico): select disabilitata
  statoLocked?: boolean
  // Radice del picker Drive (Drive Sviluppo configurato in Impostazioni)
  devDriveId?: string
  onChange: (f: FormData) => void; onSave: () => void; onClose: () => void
}

function ItemModal({ title, form, loading, apiError, prodotti, statiList, tags, clienti, statoLocked, devDriveId, onChange, onSave, onClose }: ModalProps) {
  // In pianificazione si scelgono solo gli stati manuali: né il completato
  // (auto, dalla chiusura dell'attività) né il legacy "in corso" (pensionato).
  // Se l'item è già in uno di quegli stati, la voce corrente resta visibile.
  const statiSelezionabili = statiList.filter(s =>
    (!s.isCompletato && s.chiave !== RETIRED_STATO) || s.chiave === form.stato)
  const coinvest = form.copertura === 'COINVESTIMENTO'
  const set = (key: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [key]: e.target.value })
  const toggleTag = (tagId: string) =>
    onChange({ ...form, tagIds: form.tagIds.includes(tagId) ? form.tagIds.filter(id => id !== tagId) : [...form.tagIds, tagId] })

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
              <select id="rm-stato" className="rm-input rm-select" value={form.stato} onChange={set('stato')} disabled={statoLocked}>
                {statiSelezionabili.map(s => <option key={s.chiave} value={s.chiave}>{s.label}</option>)}
              </select>
              {statoLocked && <span className="rm-field-hint">Stato guidato dall'attività collegata</span>}
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
            <DriveLinkField
              id="rm-analisi"
              inputClassName="rm-input"
              value={form.analisiUrl}
              onChange={url => onChange({ ...form, analisiUrl: url })}
              rootId={devDriveId}
              pickerTitle="Scegli il documento di analisi"
            />
          </div>

          <div className="rm-field">
            <span className="rm-label">Tag</span>
            <TagPicker tags={tags} selectedIds={form.tagIds} onToggle={toggleTag} />
          </div>

          {/* ── Economia: compilata in pianificazione, trasferita all'attività
                 alla presa in carico (pattern presale: obblighi validati solo
                 al momento della conferma) ── */}
          <div className="rm-economia">
            <span className="rm-economia-title">Economia (alla presa in carico)</span>
            <div className="rm-field">
              <span className="rm-label">Copertura</span>
              <div className="rm-copertura-toggle" role="radiogroup" aria-label="Copertura economica">
                <label className={`rm-copertura-opt${!coinvest ? ' rm-copertura-opt--active' : ''}`}>
                  <input type="radio" name="rm-copertura" checked={!coinvest}
                    onChange={() => onChange({ ...form, copertura: 'ASSORBITA' })} />
                  Assorbita da noi
                </label>
                <label className={`rm-copertura-opt${coinvest ? ' rm-copertura-opt--active' : ''}`}>
                  <input type="radio" name="rm-copertura" checked={coinvest}
                    onChange={() => onChange({ ...form, copertura: 'COINVESTIMENTO' })} />
                  Co-investimento
                </label>
              </div>
            </div>
            {coinvest && (
              <>
                <div className="rm-field-row">
                  <div className="rm-field">
                    <label htmlFor="rm-cliente-pagante" className="rm-label">Cliente (chi paga)</label>
                    <select id="rm-cliente-pagante" className="rm-input rm-select" value={form.clientePaganteId} onChange={set('clientePaganteId')}>
                      <option value="">— Seleziona —</option>
                      {clienti.map(cl => <option key={cl.id} value={cl.id}>{cl.nome}</option>)}
                    </select>
                  </div>
                  <div className="rm-field">
                    <label htmlFor="rm-gg-vendute" className="rm-label">GG vendute (cliente)</label>
                    <input id="rm-gg-vendute" className="rm-input" type="number" min="0" step="0.5"
                      value={form.giornateVendute} onChange={set('giornateVendute')} />
                  </div>
                </div>
                <div className="rm-field">
                  <label htmlFor="rm-ordine-vendita" className="rm-label">Riferimento ordine vendita</label>
                  <input id="rm-ordine-vendita" className="rm-input" type="text" placeholder="es. GO-ORDV-2026-78"
                    value={form.riferimentoOrdineVendita} onChange={set('riferimentoOrdineVendita')} />
                  <span className="rm-field-hint">Senza ordine i consuntivi Zoho non si agganciano automaticamente</span>
                </div>
              </>
            )}
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
  po: PoRef | undefined; readOnly?: boolean
  onDragStart: () => void; onDrop: (e: React.DragEvent) => void; onOpen: () => void; onDelete: () => void
  // Presa in carico (o conversione dei legacy "in corso"): mostrato solo dove ha senso
  presaLabel?: string; onPresaInCarico?: () => void
  // Stato reale dell'attività collegata (item preso in carico)
  attivitaBadge?: { label: string; colore: string } | null
}

function RoadmapCard({ item, secondary, statiMap, po, readOnly, onDragStart, onDrop, onOpen, onDelete, presaLabel, onPresaInCarico, attivitaBadge }: RoadmapCardProps) {
  // Item preso in carico (attività collegata): non trascinabile né eliminabile,
  // lo stato è guidato dall'attività.
  const locked = item.attivitaId !== null
  const canDrag = !readOnly && !locked
  return (
    <div className="rm-card" draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={readOnly ? undefined : e => { e.preventDefault(); e.stopPropagation() }}
      onDrop={readOnly ? undefined : e => { e.stopPropagation(); onDrop(e) }}>
      <div className="rm-card-head">
        <span className="rm-card-prod">
          <span className="rm-card-prod-dot" style={{ background: item.progetto.colore ?? '#0D9488' }} aria-hidden="true" />
          <span className="rm-card-prod-name" style={{ color: item.progetto.colore ?? '#0D9488' }}>{item.progetto.nome}</span>
        </span>
        {(item.analisiUrl || !readOnly) && (
          <span className="rm-card-actions">
            {item.analisiUrl && (isValidHttpUrl(item.analisiUrl)
              ? <a href={item.analisiUrl} target="_blank" rel="noreferrer" className="rm-analisi-link" aria-label="Apri analisi">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="14" height="14"><path d="M8 12l5-5M9 4h6v6M15 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </a>
              : <span className="rm-analisi-invalid" title={`Link analisi non valido: "${item.analisiUrl}" — correggilo dalla modifica`} aria-label="Link analisi non valido">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="14" height="14" aria-hidden="true"><path d="M10 3l8 14H2L10 3z" strokeLinejoin="round" /><path d="M10 8.5v3.5M10 14.5v.5" strokeLinecap="round" /></svg>
                </span>
            )}
            {!readOnly && !locked && (
              <button className="rm-card-del" type="button" aria-label={`Elimina ${item.titolo}`}
                onClick={e => { e.stopPropagation(); onDelete() }}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="14" height="14" aria-hidden="true"><path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </span>
        )}
      </div>
      <button className="rm-card-title" type="button" onClick={onOpen}>{item.titolo}</button>
      <div className="rm-card-attrs">
        {secondary === 'stato'
          ? (() => { const cfg = statiMap.get(item.stato); return (
              <span className="rm-meta-item">
                <span className="rm-meta-dot" style={{ background: cfg?.colore ?? '#94a3b8' }} aria-hidden="true" />
                {cfg?.label ?? item.stato}
              </span>
            ) })()
          : (item.quarter && <span className="rm-meta-item"><IconCalendar />{QUARTERS.find(q => q.key === item.quarter)?.label ?? item.quarter}</span>)}
        {attivitaBadge && (
          <span className="rm-meta-item rm-attivita-badge" title="Stato dell'attività collegata">
            <span className="rm-meta-dot" style={{ background: attivitaBadge.colore }} aria-hidden="true" />
            {attivitaBadge.label}
          </span>
        )}
        {item.stimaGg !== null && <span className="rm-meta-item"><IconClock />{item.stimaGg}gg</span>}
        {item.dataDeadline && <span className="rm-meta-item"><IconFlag />{fmtDate(item.dataDeadline)}</span>}
        {(item.devHub || po) && (
          <span className="rm-card-people">
            {item.devHub && <span className="rm-devhub-avatar rm-devhub-avatar--sm" title={`DevHub: ${poFullName(item.devHub)}`}>{poInitials(item.devHub)}</span>}
            {po && <span className="rm-po-avatar rm-po-avatar--sm" title={poFullName(po)}>{poInitials(po)}</span>}
          </span>
        )}
      </div>
      {item.tags.length > 0 && (
        <div className="rm-card-tags">
          <IconTag />
          <TagList tags={item.tags} />
        </div>
      )}
      {!readOnly && onPresaInCarico && (
        <button className="rm-card-presa" type="button"
          onClick={e => { e.stopPropagation(); onPresaInCarico() }}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="14" height="14" aria-hidden="true">
            <path d="M4 10h10M11 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {presaLabel ?? 'Prendi in carico'}
        </button>
      )}
    </div>
  )
}

// ─── Detail modal (sola lettura) ──────────────────────────────────────────────

function ItemDetailModal({ item, statiMap, po, onClose }: {
  item: RoadmapItem; statiMap: Map<string, StatoRoadmapConfig>; po: PoRef | undefined; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="rm-detail-title">
      <div className="rm-modal rm-modal--detail">
        <div className="rm-modal-header">
          <div className="rm-detail-header-top">
            <ProdottoBadge prodotto={item.progetto} />
            <button className="rm-modal-close" onClick={onClose} aria-label="Chiudi dettaglio" type="button">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h2 id="rm-detail-title" className="rm-modal-title">{item.titolo}</h2>
        </div>
        <div className="rm-modal-body">
          {item.descrizione && <p className="rm-detail-desc">{item.descrizione}</p>}

          <dl className="rm-detail-dl">
            <div className="rm-detail-row">
              <dt>Stato</dt><dd><StatoBadge stato={item.stato} statiMap={statiMap} /></dd>
            </div>
            <div className="rm-detail-row">
              <dt>Trimestre</dt><dd>{QUARTERS.find(q => q.key === (item.quarter ?? ''))?.label ?? item.quarter}</dd>
            </div>
            <div className="rm-detail-row">
              <dt>Anno</dt><dd>{item.anno}</dd>
            </div>
            <div className="rm-detail-row">
              <dt>Deadline</dt><dd>{fmtDateLong(item.dataDeadline) ?? '—'}</dd>
            </div>
            <div className="rm-detail-row">
              <dt>Stima</dt><dd>{item.stimaGg !== null ? `${item.stimaGg}gg` : '—'}</dd>
            </div>
            <div className="rm-detail-row">
              <dt>PO</dt><dd>{po ? poFullName(po) : '—'}</dd>
            </div>
            <div className="rm-detail-row">
              <dt>DevHub</dt><dd>{item.devHub ? poFullName(item.devHub) : '—'}</dd>
            </div>
            <div className="rm-detail-row">
              <dt>Copertura</dt><dd>{item.copertura === 'COINVESTIMENTO' ? 'Co-investimento' : 'Assorbita da noi'}</dd>
            </div>
            {item.copertura === 'COINVESTIMENTO' && (
              <>
                <div className="rm-detail-row">
                  <dt>Cliente</dt><dd>{item.clientePagante?.nome ?? '—'}</dd>
                </div>
                <div className="rm-detail-row">
                  <dt>GG vendute</dt><dd>{item.giornateVendute !== null ? `${item.giornateVendute}gg` : '—'}</dd>
                </div>
                <div className="rm-detail-row">
                  <dt>Ordine vendita</dt><dd>{item.riferimentoOrdineVendita ?? '—'}</dd>
                </div>
              </>
            )}
            {item.analisiUrl && (
              <div className="rm-detail-row">
                <dt>Analisi</dt>
                <dd>
                  {isValidHttpUrl(item.analisiUrl)
                    ? <a href={item.analisiUrl} target="_blank" rel="noreferrer" className="rm-analisi-link">Apri link ↗</a>
                    : <span className="rm-analisi-invalid" title={`Valore attuale: "${item.analisiUrl}"`}>link non valido — correggilo dalla modifica</span>}
                </dd>
              </div>
            )}
          </dl>

          {item.tags.length > 0 && (
            <div className="rm-detail-tags">
              <span className="rm-label">Tag</span>
              <TagList tags={item.tags} />
            </div>
          )}
        </div>
        <div className="rm-modal-footer">
          <button className="rm-btn rm-btn--ghost" type="button" onClick={onClose}>Chiudi</button>
        </div>
      </div>
    </SectionModal>
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

// ─── Conferma presa in carico ─────────────────────────────────────────────────
// Conferma "secca": i campi sono già nella scheda dell'item; qui solo il
// riepilogo di cosa verrà creato. La validazione co-investimento blocca la
// conferma e rimanda alla scheda (pattern presale: obblighi per fase).

function PresaInCaricoConfirm({ item, po, loading, error, onConfirm, onEdit, onClose }: {
  item: RoadmapItem; po: PoRef | undefined; loading: boolean; error: string | null
  onConfirm: () => void; onEdit: () => void; onClose: () => void
}) {
  const coinvest = item.copertura === 'COINVESTIMENTO'
  const mancanti: string[] = []
  if (coinvest && !item.clientePagante) mancanti.push('cliente pagante')
  if (coinvest && item.giornateVendute === null) mancanti.push('giornate vendute')
  const investimento = item.stimaGg !== null
    ? Math.max(0, Math.round((item.stimaGg - (coinvest ? (item.giornateVendute ?? 0) : 0)) * 100) / 100)
    : null
  return (
    <SectionModal onClose={onClose} labelledBy="rm-presa-title">
      <div className="rm-modal rm-modal--sm">
        <div className="rm-modal-header">
          <h2 id="rm-presa-title" className="rm-modal-title">Prendi in carico</h2>
          <button className="rm-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="rm-modal-body">
          {error && <p className="rm-field-error rm-field-error--banner" role="alert">{error}</p>}
          <p className="rm-confirm-text">
            Verrà creata l'attività <strong>{item.titolo}</strong> in stato <strong>In corso</strong>,
            visibile nell'elenco sotto <strong>Prodotti interni</strong>. L'item passa nella colonna
            In corso con lo stato dell'attività e si completerà alla sua chiusura.
          </p>
          <dl className="rm-detail-dl">
            <div className="rm-detail-row"><dt>Prodotto</dt><dd>{item.progetto.nome}</dd></div>
            <div className="rm-detail-row"><dt>Copertura</dt><dd>{coinvest ? 'Co-investimento' : 'Assorbita da noi'}</dd></div>
            {coinvest && (
              <>
                <div className="rm-detail-row"><dt>Cliente</dt><dd>{item.clientePagante?.nome ?? '—'}</dd></div>
                <div className="rm-detail-row"><dt>GG vendute</dt><dd>{item.giornateVendute !== null ? `${item.giornateVendute}gg` : '—'}</dd></div>
                <div className="rm-detail-row"><dt>Ordine vendita</dt><dd>{item.riferimentoOrdineVendita ?? '—'}</dd></div>
              </>
            )}
            <div className="rm-detail-row"><dt>GG investimento</dt><dd>{investimento !== null ? `${investimento}gg` : '—'}</dd></div>
            <div className="rm-detail-row"><dt>PM</dt><dd>{po ? poFullName(po) : '—'}</dd></div>
          </dl>
          {mancanti.length > 0 && (
            <p className="rm-field-error" role="alert">
              Per il co-investimento manca: {mancanti.join(', ')}. Compilali nella scheda prima di confermare.
            </p>
          )}
          {coinvest && mancanti.length === 0 && !item.riferimentoOrdineVendita && (
            <p className="rm-field-hint">Senza ordine di vendita i consuntivi Zoho non si aggancieranno automaticamente.</p>
          )}
        </div>
        <div className="rm-modal-footer">
          <button className="rm-btn rm-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          {mancanti.length > 0
            ? <button className="rm-btn rm-btn--primary" type="button" onClick={onEdit}>Apri scheda</button>
            : <button className="rm-btn rm-btn--primary" type="button" onClick={onConfirm} disabled={loading}>
                {loading ? 'Creazione…' : 'Conferma e crea attività'}
              </button>}
        </div>
      </div>
    </SectionModal>
  )
}

// ─── RoadmapPage ──────────────────────────────────────────────────────────────

interface RoadmapPageProps { token: string; readOnly?: boolean }

export default function RoadmapPage({ token, readOnly }: RoadmapPageProps) {
  const currentYear = new Date().getFullYear()

  const [items,       setItems]       = useState<RoadmapItem[]>([])
  const [prodotti,    setProdotti]    = useState<Prodotto[]>([])
  const [pms,         setPms]         = useState<PoRef[]>([])
  const [devHubs,     setDevHubs]     = useState<PoRef[]>([])
  const [statiConfig, setStatiConfig] = useState<StatoRoadmapConfig[]>([])
  const [tags,        setTags]        = useState<TagRef[]>([])
  const [clienti,     setClienti]     = useState<ClienteRef[]>([])
  const [statiAttivita, setStatiAttivita] = useState<StatoAttivitaRef[]>([])
  const [loading,     setLoading]     = useState(true)
  const [apiError,    setApiError]    = useState<string | null>(null)
  // Completati nascosti di default (colonna/righe espandibili col toggle)
  const [showCompletati, setShowCompletati] = useState(false)
  // Messaggio temporaneo sui drop rifiutati dal workflow (adiacenza, ecc.)
  const [dragHint, setDragHint] = useState<string | null>(null)
  const dragHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showDragHint = (msg: string) => {
    setDragHint(msg)
    if (dragHintTimer.current) clearTimeout(dragHintTimer.current)
    dragHintTimer.current = setTimeout(() => setDragHint(null), 4000)
  }
  // Presa in carico
  const [presaTarget,  setPresaTarget]  = useState<RoadmapItem | null>(null)
  const [presaLoading, setPresaLoading] = useState(false)
  const [presaErr,     setPresaErr]     = useState<string | null>(null)
  const driveCfg = useDriveConfig(token)

  const [view, setView] = useState<'lista' | 'kanban-trimestre' | 'kanban-stati'>('kanban-stati')
  const [anno, setAnno] = useState(currentYear)
  const [filterProdotto, setFilterProdotto] = useState<string[]>([])
  const [filterQuarter, setFilterQuarter] = useState<string[]>([])
  const [filterStato, setFilterStato] = useState<string[]>([])
  const [filterTag, setFilterTag] = useState<string[]>([])
  const [filterDevHub, setFilterDevHub] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const [modal,     setModal]     = useState<'add' | 'edit' | null>(null)
  const [editing,   setEditing]   = useState<RoadmapItem | null>(null)
  const [selected,  setSelected]  = useState<RoadmapItem | null>(null)
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
      const [rI, rP, rPm, rDh, rS, rT, rC, rSA] = await Promise.all([
        fetch(`${API_URL}/api/roadmap-items`,   { headers: authHeaders(token) }),
        fetch(`${API_URL}/progetti?tipo=PRODOTTO`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=PM`,   { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=DEVHUB`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/stati-roadmap`,   { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/roadmap-tags`,    { headers: authHeaders(token) }),
        fetch(`${API_URL}/clienti`,             { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/stati-attivita`,  { headers: authHeaders(token) }),
      ])
      if (!rI.ok || !rP.ok) throw new Error()
      const [i, p, pm, dh, s, t, cl, sa] = await Promise.all([
        rI.json(), rP.json(), rPm.ok ? rPm.json() : Promise.resolve([]), rDh.ok ? rDh.json() : Promise.resolve([]),
        rS.ok ? rS.json() : Promise.resolve([]), rT.ok ? rT.json() : Promise.resolve([]),
        rC.ok ? rC.json() : Promise.resolve([]),
        rSA.ok ? rSA.json() : Promise.resolve([]),
      ])
      setItems(i); setProdotti(p); setPms(pm); setDevHubs(dh); setStatiConfig(s); setTags(t); setClienti(cl); setStatiAttivita(sa)
    } catch { setApiError('Impossibile caricare i dati della roadmap.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { queueMicrotask(() => { fetchAll() }) }, [fetchAll])

  const anni = useMemo(() => {
    const set = new Set(items.map(i => i.anno))
    set.add(currentYear)
    return [...set].sort((a, b) => a - b)
  }, [items, currentYear])

  const completatoChiavi = useMemo(
    () => new Set(statiConfig.filter(s => s.isCompletato).map(s => s.chiave)),
    [statiConfig])

  // Sequenza degli stati di pianificazione (per l'adiacenza del drag): esclusi
  // il completato (auto) e il legacy "in corso" (pensionato).
  const seqStati = useMemo(
    () => statiList.filter(s => !s.isCompletato && s.chiave !== RETIRED_STATO).map(s => s.chiave),
    [statiList])

  const displayItems = useMemo(() => {
    return items
      .filter(i => i.anno === anno)
      // Completati nascosti di default; visibili col toggle o filtrando
      // esplicitamente per quello stato
      .filter(i => showCompletati || filterStato.some(f => completatoChiavi.has(f)) || !completatoChiavi.has(i.stato))
      .filter(i => filterProdotto.length === 0 || filterProdotto.includes(i.progettoId))
      .filter(i => filterQuarter.length === 0 || filterQuarter.includes(i.quarter ?? ''))
      .filter(i => filterStato.length === 0 || filterStato.includes(i.stato))
      .filter(i => filterTag.length === 0 || i.tags.some(t => filterTag.includes(t.id)))
      .filter(i => filterDevHub.length === 0 || (i.devHubId !== null && filterDevHub.includes(i.devHubId)))
      .filter(i => !search.trim() || i.titolo.toLowerCase().includes(search.trim().toLowerCase()))
  }, [items, anno, filterProdotto, filterQuarter, filterStato, filterTag, filterDevHub, search, showCompletati, completatoChiavi])

  const completatiNascosti = useMemo(
    () => items.filter(i => i.anno === anno && completatoChiavi.has(i.stato)).length,
    [items, anno, completatoChiavi])

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
    // Workflow sul kanban stati: un passo per volta, niente completato a mano,
    // niente "in corso" (l'esecuzione parte da "Prendi in carico"). Il server
    // applica le stesse regole; qui il messaggio-guida.
    if (overrides.stato !== undefined) {
      const dragged = items.find(i => i.id === draggedId)
      if (dragged && overrides.stato !== dragged.stato) {
        if (dragged.attivitaId) { showDragHint('Item collegato a un\'attività: lo stato segue l\'attività.'); return }
        if (completatoChiavi.has(overrides.stato)) { showDragHint('Il completamento è automatico: si chiude dall\'attività collegata.'); return }
        if (overrides.stato === RETIRED_STATO) { showDragHint('Per avviare l\'esecuzione usa "Prendi in carico" sulla card.'); return }
        const from = seqStati.indexOf(dragged.stato)
        const to = seqStati.indexOf(overrides.stato)
        if (from !== -1 && to !== -1 && Math.abs(from - to) > 1) {
          showDragHint('Puoi spostare solo di uno stato per volta.'); return
        }
      }
    }
    reorderAndPersist(columnItems.map(i => i.id), draggedId, targetId, overrides)
  }

  // ── Presa in carico (item → attività, sezione Prodotti interni) ────────────

  const openPresaInCarico = (item: RoadmapItem) => { setPresaErr(null); setPresaTarget(item) }

  const handlePresaInCarico = async () => {
    if (!presaTarget) return
    setPresaLoading(true); setPresaErr(null)
    try {
      const res = await fetch(`${API_URL}/api/roadmap-items/${presaTarget.id}/prendi-in-carico`, {
        method: 'POST', headers: authHeaders(token),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPresaErr((data as { error?: string }).error ?? `Errore ${res.status}`); return
      }
      setPresaTarget(null); await fetchAll()
    } catch { setPresaErr('Errore di rete. Riprova.') }
    finally { setPresaLoading(false) }
  }

  // La presa in carico è offerta sull'ultimo stato di pianificazione e, come
  // conversione, sugli item legacy rimasti a mano nello stato "in corso".
  const presaProps = (item: RoadmapItem) => {
    if (readOnly || item.attivitaId) return {}
    if (item.stato === seqStati[seqStati.length - 1]) {
      return { presaLabel: 'Prendi in carico', onPresaInCarico: () => openPresaInCarico(item) }
    }
    if (item.stato === RETIRED_STATO) {
      return { presaLabel: 'Converti in attività', onPresaInCarico: () => openPresaInCarico(item) }
    }
    return {}
  }

  const statiAttivitaMap = useMemo(() => new Map(statiAttivita.map(s => [s.chiave, s])), [statiAttivita])

  // Badge dello stato reale dell'attività collegata: mostrato sulle card degli
  // item presi in carico finché l'attività è aperta (da chiusa lo dice già la
  // colonna Completato).
  const attivitaBadgeFor = (item: RoadmapItem) => {
    if (!item.attivitaId || !item.attivitaStato) return null
    const cfg = statiAttivitaMap.get(item.attivitaStato)
    if (cfg?.isArchiviato) return null
    return { label: cfg?.label ?? item.attivitaStato, colore: cfg?.colore ?? '#94a3b8' }
  }

  // ── CRUD ──────────────────────────────────────────────────

  const openAdd = () => {
    // Il default di stato deve essere uno stato realmente configurato, altrimenti
    // il backend risponde "Stato non valido": preferisci DA_FARE, poi il primo
    // stato non archiviato, infine il primo disponibile.
    const stato = statiList.find(s => s.chiave === 'DA_FARE')?.chiave
      ?? statiList.find(s => !s.isArchiviato)?.chiave
      ?? statiList[0]?.chiave
      ?? 'DA_FARE'
    setForm({ ...emptyForm(anno), stato })
    setFormErr(null); setModal('add')
  }
  // In sola lettura non c'è form di modifica: il click apre il dettaglio.
  const openItem = (item: RoadmapItem) => { if (readOnly) setSelected(item); else openEdit(item) }
  const openEdit = (item: RoadmapItem) => {
    setEditing(item)
    setForm({
      progettoId: item.progettoId, titolo: item.titolo, descrizione: item.descrizione ?? '',
      anno: String(item.anno), quarter: item.quarter ?? '', dataDeadline: toInputDate(item.dataDeadline),
      stato: item.stato, stimaGg: item.stimaGg !== null ? String(item.stimaGg) : '', analisiUrl: item.analisiUrl ?? '',
      tagIds: item.tags.map(t => t.id),
      copertura: item.copertura ?? 'ASSORBITA',
      clientePaganteId: item.clientePagante?.id ?? '',
      giornateVendute: item.giornateVendute !== null ? String(item.giornateVendute) : '',
      riferimentoOrdineVendita: item.riferimentoOrdineVendita ?? '',
    })
    setFormErr(null); setModal('edit')
  }

  const handleSave = async () => {
    if (!form.progettoId) { setFormErr('Seleziona un prodotto.'); return }
    if (!form.titolo.trim()) { setFormErr('Il titolo è obbligatorio.'); return }
    // Solo un link nuovo/modificato viene validato (i valori storici non
    // conformi non bloccano salvataggi che non li toccano)
    const analisiInvariato = modal === 'edit' && form.analisiUrl.trim() === (editing?.analisiUrl ?? '').trim()
    if (!analisiInvariato && form.analisiUrl.trim() && !isValidHttpUrl(form.analisiUrl)) {
      setFormErr('Il link analisi non è un URL valido (deve iniziare con http:// o https://).'); return
    }
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
        tagIds: form.tagIds,
        copertura: form.copertura,
        clientePaganteId: form.clientePaganteId || null,
        giornateVendute: form.giornateVendute ? parseFloat(form.giornateVendute) : null,
        riferimentoOrdineVendita: form.riferimentoOrdineVendita || null,
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

  const removeTagFromItem = async (itemId: string, tagId: string) => {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, tags: it.tags.filter(t => t.id !== tagId) } : it))
    try {
      const res = await fetch(`${API_URL}/api/roadmap-items/${itemId}/tags/${tagId}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!res.ok && res.status !== 404) throw new Error()
    } catch {
      setApiError('Impossibile rimuovere il tag. Riprova.')
      await fetchAll()
    }
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
        {!readOnly && (
          <div className="rm-topbar-actions">
            <button className="rm-btn rm-btn--primary" type="button" onClick={openAdd}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <path d="M10 4v12M4 10h12" strokeLinecap="round" />
              </svg>
              Nuova attività
            </button>
          </div>
        )}
      </div>

      <div className="rm-toolbar">
        <div className="rm-view-toggle" role="tablist" aria-label="Vista roadmap">
          <button role="tab" aria-selected={view === 'kanban-stati'} type="button"
            className={`rm-view-btn${view === 'kanban-stati' ? ' rm-view-btn--active' : ''}`} onClick={() => setView('kanban-stati')}>
            Kanban per stati
          </button>
          <button role="tab" aria-selected={view === 'kanban-trimestre'} type="button"
            className={`rm-view-btn${view === 'kanban-trimestre' ? ' rm-view-btn--active' : ''}`} onClick={() => setView('kanban-trimestre')}>
            Kanban per trimestre
          </button>
          <button role="tab" aria-selected={view === 'lista'} type="button"
            className={`rm-view-btn${view === 'lista' ? ' rm-view-btn--active' : ''}`} onClick={() => setView('lista')}>
            Lista
          </button>
        </div>

        <select className="rm-input rm-select rm-filter" value={anno} onChange={e => setAnno(parseInt(e.target.value, 10))}>
          {anni.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <MultiSelect
          label="Tutti i prodotti"
          options={prodotti.map(p => ({ id: p.id, label: p.nome }))}
          value={filterProdotto}
          onChange={setFilterProdotto}
        />
        <MultiSelect
          label="Tutti i trimestri"
          options={QUARTERS.map(q => ({ id: q.key, label: q.label }))}
          value={filterQuarter}
          onChange={setFilterQuarter}
        />
        <MultiSelect
          label="Tutti gli stati"
          options={statiList.map(s => ({ id: s.chiave, label: s.label }))}
          value={filterStato}
          onChange={setFilterStato}
        />
        <MultiSelect
          label="Tutti i tag"
          options={tags.map(t => ({ id: t.id, label: t.label }))}
          value={filterTag}
          onChange={setFilterTag}
        />
        <MultiSelect
          label="Tutti i DevHub"
          options={devHubs.map(d => ({ id: d.id, label: poFullName(d) }))}
          value={filterDevHub}
          onChange={setFilterDevHub}
        />
        <input className="rm-input rm-filter rm-filter--search" type="text" placeholder="Cerca titolo…"
          value={search} onChange={e => setSearch(e.target.value)} />
        {completatiNascosti > 0 && (
          <button type="button" className={`rm-btn rm-btn--ghost rm-btn--completati${showCompletati ? ' rm-btn--completati-on' : ''}`}
            onClick={() => setShowCompletati(v => !v)} aria-pressed={showCompletati}>
            {showCompletati ? 'Nascondi completati' : `Mostra completati (${completatiNascosti})`}
          </button>
        )}
      </div>

      {dragHint && <p className="rm-drag-hint" role="status">{dragHint}</p>}
      {apiError && !loading && <p className="rm-page-error" role="alert">{apiError}</p>}

      {loading ? (
        <div className="rm-loading">{Array.from({ length: 4 }, (_, i) => <div key={i} className="rm-skeleton" />)}</div>
      ) : displayItems.length === 0 ? (
        <div className="rm-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <path d="M6 30h8l6-16 8 28 6-16h8" stroke="#CBD5E1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="rm-empty-text">Nessuna attività pianificata per {anno} con questi filtri.</p>
          {!readOnly && (
            <button className="rm-btn rm-btn--primary" type="button" onClick={openAdd}>Aggiungi la prima attività</button>
          )}
        </div>
      ) : view === 'lista' ? (
        <div className="rm-table-wrap">
          <table className="rm-table" aria-label="Elenco attività roadmap">
            <thead>
              <tr>
                {!readOnly && <th scope="col" className="rm-th--drag"></th>}
                <th scope="col">Prodotto</th>
                <th scope="col">Titolo</th>
                <th scope="col">Tag</th>
                <th scope="col">Trimestre</th>
                <th scope="col">Deadline</th>
                <th scope="col">Stato</th>
                <th scope="col">Stima</th>
                <th scope="col">PO</th>
                <th scope="col">DevHub</th>
                <th scope="col">Analisi</th>
                {!readOnly && <th scope="col" className="rm-th--actions">Azioni</th>}
              </tr>
            </thead>
            <tbody>
              {listaRows.map(item => (
                <tr key={item.id} className={`rm-row${readOnly ? ' rm-row--clickable' : ''}`} draggable={!readOnly && !item.attivitaId}
                  onDragStart={readOnly || item.attivitaId ? undefined : () => onRowDragStart(item.id)}
                  onDragOver={readOnly ? undefined : e => e.preventDefault()}
                  onDrop={readOnly ? undefined : () => onRowDrop(item.id)}
                  onClick={readOnly ? () => setSelected(item) : undefined}
                  tabIndex={readOnly ? 0 : undefined}
                  role={readOnly ? 'button' : undefined}
                  aria-label={readOnly ? `Dettaglio attività: ${item.titolo}` : undefined}
                  onKeyDown={readOnly ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(item) } } : undefined}>
                  {!readOnly && (
                    <td className="rm-cell-drag" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><circle cx="6" cy="5" r="1.4" /><circle cx="6" cy="10" r="1.4" /><circle cx="6" cy="15" r="1.4" /><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="10" r="1.4" /><circle cx="12" cy="15" r="1.4" /></svg>
                    </td>
                  )}
                  <td><ProdottoBadge prodotto={item.progetto} /></td>
                  <td className="rm-cell-titolo">{item.titolo}</td>
                  <td className="rm-cell-tags">
                    {item.tags.length > 0
                      ? <TagList tags={item.tags} onRemove={readOnly ? undefined : tagId => removeTagFromItem(item.id, tagId)} />
                      : <span className="rm-empty-cell">—</span>}
                  </td>
                  <td className="rm-cell-text">{QUARTERS.find(q => q.key === (item.quarter ?? ''))?.label ?? item.quarter}</td>
                  <td className="rm-cell-text">{fmtDateLong(item.dataDeadline) ?? <span className="rm-empty-cell">—</span>}</td>
                  <td>
                    <StatoBadge stato={item.stato} statiMap={statiMap} />
                    {(() => { const b = attivitaBadgeFor(item); return b && (
                      <span className="rm-meta-item rm-attivita-badge" title="Stato dell'attività collegata">
                        <span className="rm-meta-dot" style={{ background: b.colore }} aria-hidden="true" />
                        {b.label}
                      </span>
                    ) })()}
                  </td>
                  <td className="rm-cell-text">{item.stimaGg !== null ? `${item.stimaGg}gg` : '—'}</td>
                  <td className="rm-cell-text">
                    {(() => { const po = pmById.get(prodottoById.get(item.progettoId)?.poId ?? ''); return po
                      ? <span className="rm-po-avatar" title={poFullName(po)}>{poInitials(po)}</span>
                      : <span className="rm-empty-cell">—</span> })()}
                  </td>
                  <td className="rm-cell-text">
                    {item.devHub
                      ? <span className="rm-devhub-avatar" title={poFullName(item.devHub)}>{poInitials(item.devHub)}</span>
                      : <span className="rm-empty-cell">—</span>}
                  </td>
                  <td className="rm-cell-text" onClick={e => e.stopPropagation()}>
                    {item.analisiUrl
                      ? (isValidHttpUrl(item.analisiUrl)
                          ? <a href={item.analisiUrl} target="_blank" rel="noreferrer" className="rm-analisi-link" aria-label="Apri analisi">
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15"><path d="M8 12l5-5M9 4h6v6M15 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </a>
                          : <span className="rm-analisi-invalid" title={`Link analisi non valido: "${item.analisiUrl}" — correggilo dalla modifica`} aria-label="Link analisi non valido">
                              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15" aria-hidden="true"><path d="M10 3l8 14H2L10 3z" strokeLinejoin="round" /><path d="M10 8.5v3.5M10 14.5v.5" strokeLinecap="round" /></svg>
                            </span>)
                      : <span className="rm-empty-cell">—</span>}
                  </td>
                  {!readOnly && (
                    <td className="rm-cell-actions">
                      {(() => { const pp = presaProps(item); return pp.onPresaInCarico && (
                        <button className="rm-icon-btn" type="button" title={pp.presaLabel}
                          aria-label={`${pp.presaLabel}: ${item.titolo}`} onClick={pp.onPresaInCarico}>
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                            <path d="M4 10h10M11 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) })()}
                      <button className="rm-icon-btn" type="button" aria-label={`Modifica ${item.titolo}`} onClick={() => openEdit(item)}>
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                          <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {!item.attivitaId && (
                        <button className="rm-icon-btn rm-icon-btn--danger" type="button" aria-label={`Elimina ${item.titolo}`} onClick={() => setDelTarget(item)}>
                          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                            <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </td>
                  )}
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
              .sort(byDeadlineAsc)
            return (
              <div key={col.key || 'backlog'} className="rm-col"
                onDragOver={readOnly ? undefined : e => e.preventDefault()}
                onDrop={readOnly ? undefined : () => onCardDrop(colItems, null, { quarter: col.key })}>
                <div className="rm-col-head">
                  <span className="rm-col-label">{col.label}</span>
                  <span className="rm-col-count">{colItems.length}</span>
                </div>
                <div className="rm-col-body">
                  {colItems.map(item => (
                    <RoadmapCard key={item.id} item={item} secondary="stato" statiMap={statiMap}
                      po={pmById.get(prodottoById.get(item.progettoId)?.poId ?? '')}
                      readOnly={readOnly}
                      onDragStart={() => onRowDragStart(item.id)}
                      onDrop={() => onCardDrop(colItems, item.id, { quarter: col.key })}
                      onOpen={() => openItem(item)} onDelete={() => setDelTarget(item)}
                      attivitaBadge={attivitaBadgeFor(item)}
                      {...presaProps(item)} />
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
          {statiList
            // Completato: colonna visibile solo col toggle. Legacy "in corso":
            // solo finché contiene item da convertire (poi sparisce).
            .filter(col => !col.isCompletato || showCompletati)
            .filter(col => col.chiave !== RETIRED_STATO || displayItems.some(i => i.stato === col.chiave))
            .map(col => {
            const colItems = [...displayItems]
              .filter(i => i.stato === col.chiave)
              .sort(byDeadlineAsc)
            return (
              <div key={col.chiave} className="rm-col"
                onDragOver={readOnly ? undefined : e => e.preventDefault()}
                onDrop={readOnly ? undefined : () => onCardDrop(colItems, null, { stato: col.chiave })}>
                <div className="rm-col-head">
                  <span className="rm-col-label">{col.label}</span>
                  <span className="rm-col-count">{colItems.length}</span>
                </div>
                <div className="rm-col-body">
                  {colItems.map(item => (
                    <RoadmapCard key={item.id} item={item} secondary="quarter" statiMap={statiMap}
                      po={pmById.get(prodottoById.get(item.progettoId)?.poId ?? '')}
                      readOnly={readOnly}
                      onDragStart={() => onRowDragStart(item.id)}
                      onDrop={() => onCardDrop(colItems, item.id, { stato: col.chiave })}
                      onOpen={() => openItem(item)} onDelete={() => setDelTarget(item)}
                      attivitaBadge={attivitaBadgeFor(item)}
                      {...presaProps(item)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!readOnly && (modal === 'add' || modal === 'edit') && (
        <ItemModal
          title={modal === 'add' ? 'Nuova attività roadmap' : 'Modifica attività roadmap'}
          form={form} loading={saving} apiError={formErr} prodotti={prodotti} statiList={statiList} tags={tags}
          clienti={clienti}
          statoLocked={modal === 'edit' && editing?.attivitaId !== null && editing?.attivitaId !== undefined}
          devDriveId={driveCfg?.devId || undefined}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {!readOnly && presaTarget && (
        <PresaInCaricoConfirm
          item={presaTarget}
          po={pmById.get(prodottoById.get(presaTarget.progettoId)?.poId ?? '')}
          loading={presaLoading} error={presaErr}
          onConfirm={handlePresaInCarico}
          onEdit={() => { const it = presaTarget; setPresaTarget(null); if (it) openEdit(it) }}
          onClose={() => setPresaTarget(null)} />
      )}
      {selected && (
        <ItemDetailModal
          item={selected}
          statiMap={statiMap}
          po={pmById.get(prodottoById.get(selected.progettoId)?.poId ?? '')}
          onClose={() => setSelected(null)}
        />
      )}
      {!readOnly && delTarget && (
        <ConfirmDelete item={delTarget} loading={deleting} onConfirm={handleDelete} onClose={() => setDelTarget(null)} />
      )}
    </div>
  )
}
