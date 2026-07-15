import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { SectionModal } from '../components/SectionModal'
import './PresalePage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface PresaleItem {
  id: string
  attivita: string
  cliente: string; clienteId: string | null
  progetto: string; progettoId: string | null
  account: string; accountId: string | null
  projectManager: string; pmIds: string[]
  devHub: string; devHubId: string | null
  stato: string
  giornateVendute: number | null
  note: string | null
  presaleLinkRequisiti: string | null
  presaleLinkStima: string | null
  presaleGiornateStimate: number | null
  presaleScadenzaStima: string | null
  presaleAssegnatario: string
  presaleAssegnatarioId: string | null
  inizio: string | null
  deadline: string | null
}

interface StatoConfig {
  id: string; chiave: string; label: string; colore: string
  isArchiviato: boolean; escludiDaConteggio: boolean; isPresale?: boolean; ordine: number
}

interface StoricoEntry { id: string; statoDa: string | null; statoA: string; utente: string; data: string }
interface UserRef { id: string; firstName: string | null; lastName: string }
interface ClienteOption {
  id: string; nome: string; accountId: string | null
  account: { id: string; firstName: string | null; lastName: string } | null
}
interface ProgettoOption { id: string; nome: string; clienteId: string | null }

type FormData = {
  clienteId: string
  progettoId: string
  attivita: string
  stato: string
  pmIds: string[]
  presaleAssegnatarioId: string
  presaleGiornateStimate: string
  presaleScadenzaStima: string
  giornateVendute: string
  presaleLinkRequisiti: string
  presaleLinkStima: string
  note: string
  inizio: string
  deadline: string
}

const EMPTY_FORM: FormData = {
  clienteId: '', progettoId: '', attivita: '', stato: '',
  pmIds: [], presaleAssegnatarioId: '',
  presaleGiornateStimate: '', presaleScadenzaStima: '', giornateVendute: '',
  presaleLinkRequisiti: '', presaleLinkStima: '',
  note: '', inizio: '', deadline: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}
function authHeadersJson(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}
function userLabel(u: { firstName: string | null; lastName: string } | UserRef): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ')
}
function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function fmtDateTime(iso: string): string {
  const dt = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}
function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ─── Campi per fase ───────────────────────────────────────────────────────────
// Ogni fase presale mostra solo i campi che il suo owner deve compilare, più
// (al massimo) i campi della fase precedente rimasti vuoti. Mappato per chiave
// dello stato; per stati presale custom (fuori mappa) si mostrano tutti.
type PresaleField =
  | 'pmIds' | 'presaleLinkRequisiti' | 'presaleScadenzaStima' | 'presaleAssegnatarioId'
  | 'presaleGiornateStimate' | 'presaleLinkStima' | 'giornateVendute'

const FASE_CAMPI: Record<string, PresaleField[]> = {
  PRESALE_APERTURA:     ['presaleLinkRequisiti', 'presaleScadenzaStima', 'pmIds'],
  PRESALE_PRESA_CARICO: ['presaleAssegnatarioId'],
  PRESALE_STIMA:        ['presaleGiornateStimate', 'presaleLinkStima'],
  PRESALE_GIORNATE:     ['giornateVendute'],
  PRESALE_CONFERMA:     [],
}
const TUTTI_CAMPI: PresaleField[] = [
  'pmIds', 'presaleLinkRequisiti', 'presaleScadenzaStima', 'presaleAssegnatarioId',
  'presaleGiornateStimate', 'presaleLinkStima', 'giornateVendute',
]

function campoVuoto(form: FormData, f: PresaleField): boolean {
  if (f === 'pmIds') return form.pmIds.length === 0
  return (form[f] ?? '').toString().trim() === ''
}

function campiVisibili(stato: string, statiPresale: StatoConfig[], form: FormData): Set<PresaleField> {
  const propri = FASE_CAMPI[stato]
  if (propri === undefined) return new Set(TUTTI_CAMPI) // fase custom → mostra tutto
  const visibili = new Set(propri)
  const idx = statiPresale.findIndex(s => s.chiave === stato)
  const prec = idx > 0 ? statiPresale[idx - 1] : undefined
  const campiPrec = prec ? (FASE_CAMPI[prec.chiave] ?? []) : []
  for (const f of campiPrec) if (campoVuoto(form, f)) visibili.add(f)
  return visibili
}

// ─── PM chips (multi-select) ────────────────────────────────────────────────

function PmChips({ pms, value, onChange }: {
  pms: UserRef[]; value: string[]; onChange: (ids: string[]) => void
}) {
  if (pms.length === 0) return <span className="ps-field-hint">Nessun PM disponibile</span>
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
  return (
    <div className="ps-chip-row">
      {pms.map(p => {
        const on = value.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            className={`ps-chip${on ? ' ps-chip--on' : ''}`}
            onClick={() => toggle(p.id)}
            aria-pressed={on}
          >
            {userLabel(p)}
          </button>
        )
      })}
    </div>
  )
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

function PresaleModal({
  mode, form, statiPresale, clienti, progetti, pms, devHubs,
  loading, apiError, onChange, onSave, onClose,
}: {
  mode: 'add' | 'edit'
  form: FormData
  statiPresale: StatoConfig[]
  clienti: ClienteOption[]
  progetti: ProgettoOption[]
  pms: UserRef[]
  devHubs: UserRef[]
  loading: boolean
  apiError: string | null
  onChange: (f: FormData) => void
  onSave: () => void
  onClose: () => void
}) {
  const progettiFiltrati = useMemo(
    () => progetti.filter(p => !form.clienteId || p.clienteId === form.clienteId),
    [progetti, form.clienteId],
  )
  const visibili = useMemo(
    () => campiVisibili(form.stato, statiPresale, form),
    [form, statiPresale],
  )
  const currentIdx = statiPresale.findIndex(s => s.chiave === form.stato)
  const currentCfg = statiPresale[currentIdx]
  const accent = currentCfg?.colore ?? '#7C3AED'

  return (
    <SectionModal onClose={onClose} labelledBy="ps-modal-title">
      <div className="ps-modal ps-modal--form" style={{ ['--ps-accent' as string]: accent }}>
        <div className="ps-modal-head">
          <div className="ps-modal-head-txt">
            <span className="ps-eyebrow" style={{ color: accent }}>
              {mode === 'add' ? 'Nuova trattativa' : 'Attività presale'}
            </span>
            <h2 id="ps-modal-title" className="ps-modal-title">
              {mode === 'add' ? "Apri un'attività Presale" : (form.attivita || 'Modifica attività')}
            </h2>
          </div>
          <button className="ps-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Stepper della pipeline — cliccabile: sposta la card nella fase scelta */}
        <div className="ps-stepper" role="group" aria-label="Fase della trattativa">
          {statiPresale.map((s, i) => {
            const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
            return (
              <button
                key={s.chiave}
                type="button"
                className={`ps-step ps-step--${state}`}
                style={{ ['--ps-step-c' as string]: s.colore }}
                onClick={() => onChange({ ...form, stato: s.chiave })}
                aria-current={state === 'current' ? 'step' : undefined}
                title={s.label}
              >
                <span className="ps-step-n">{state === 'done' ? '✓' : i + 1}</span>
                <span className="ps-step-t">{s.label}</span>
              </button>
            )
          })}
        </div>

        <div className="ps-modal-body">
          {apiError && <p className="ps-error-banner" role="alert">{apiError}</p>}

          {/* Identità attività — solo in creazione (in modifica è già definita) */}
          {mode === 'add' && (
            <section className="ps-section">
              <p className="ps-section-title">Identità</p>
              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-cliente">Cliente <span aria-hidden="true">*</span></label>
                <select
                  id="ps-cliente"
                  className="ps-input ps-select"
                  value={form.clienteId}
                  onChange={e => onChange({ ...form, clienteId: e.target.value, progettoId: '' })}
                >
                  <option value="">— Seleziona cliente —</option>
                  {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-progetto">Progetto <span aria-hidden="true">*</span></label>
                <select
                  id="ps-progetto"
                  className="ps-input ps-select"
                  value={form.progettoId}
                  onChange={e => onChange({ ...form, progettoId: e.target.value })}
                  disabled={!form.clienteId}
                >
                  <option value="">{form.clienteId ? '— Seleziona progetto —' : '— Prima scegli il cliente —'}</option>
                  {progettiFiltrati.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>

              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-attivita">Attività <span aria-hidden="true">*</span></label>
                <input
                  id="ps-attivita"
                  className="ps-input"
                  type="text"
                  value={form.attivita}
                  onChange={e => onChange({ ...form, attivita: e.target.value })}
                  placeholder="es. Analisi requisiti nuovo modulo"
                />
              </div>
            </section>
          )}

          <section className="ps-section ps-section--phase">
            <p className="ps-section-title" style={{ color: accent }}>
              <span className="ps-section-tick" style={{ background: accent }} />
              Da compilare{currentCfg ? ` · ${currentCfg.label}` : ''}
            </p>

            {visibili.size === 0 && (
              <p className="ps-section-hint">Nessun campo da compilare in questa fase.</p>
            )}

            {visibili.has('pmIds') && (
              <div className="ps-field">
                <span className="ps-label">PM</span>
                <PmChips pms={pms} value={form.pmIds} onChange={ids => onChange({ ...form, pmIds: ids })} />
              </div>
            )}

            {visibili.has('presaleLinkRequisiti') && (
              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-req">Link Drive — analisi requisiti</label>
                <input
                  id="ps-req"
                  className="ps-input"
                  type="url"
                  value={form.presaleLinkRequisiti}
                  onChange={e => onChange({ ...form, presaleLinkRequisiti: e.target.value })}
                  placeholder="https://drive.google.com/…"
                />
              </div>
            )}

            {visibili.has('presaleScadenzaStima') && (
              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-scad-stima">Stima desiderata entro il</label>
                <input
                  id="ps-scad-stima"
                  className="ps-input"
                  type="date"
                  value={form.presaleScadenzaStima}
                  onChange={e => onChange({ ...form, presaleScadenzaStima: e.target.value })}
                />
              </div>
            )}

            {visibili.has('presaleAssegnatarioId') && (
              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-assegnatario">Assegnatario DevHub</label>
                <select
                  id="ps-assegnatario"
                  className="ps-input ps-select"
                  value={form.presaleAssegnatarioId}
                  onChange={e => onChange({ ...form, presaleAssegnatarioId: e.target.value })}
                >
                  <option value="">— Nessuno —</option>
                  {devHubs.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                </select>
              </div>
            )}

            {visibili.has('presaleGiornateStimate') && (
              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-stimate">Giornate stimate</label>
                <div className="ps-input-suffix">
                  <input
                    id="ps-stimate"
                    className="ps-input"
                    type="number" min="0" step="0.5"
                    value={form.presaleGiornateStimate}
                    onChange={e => onChange({ ...form, presaleGiornateStimate: e.target.value })}
                  />
                  <span className="ps-suffix">gg</span>
                </div>
              </div>
            )}

            {visibili.has('presaleLinkStima') && (
              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-stima">Link Drive — analisi di stima</label>
                <input
                  id="ps-stima"
                  className="ps-input"
                  type="url"
                  value={form.presaleLinkStima}
                  onChange={e => onChange({ ...form, presaleLinkStima: e.target.value })}
                  placeholder="https://drive.google.com/…"
                />
              </div>
            )}

            {visibili.has('giornateVendute') && (
              <div className="ps-field">
                <label className="ps-label" htmlFor="ps-vendute">Giornate vendute</label>
                <div className="ps-input-suffix">
                  <input
                    id="ps-vendute"
                    className="ps-input"
                    type="number" min="0" step="0.5"
                    value={form.giornateVendute}
                    onChange={e => onChange({ ...form, giornateVendute: e.target.value })}
                  />
                  <span className="ps-suffix">gg</span>
                </div>
              </div>
            )}
          </section>

          <section className="ps-section">
            <p className="ps-section-title">Note</p>
            <textarea
              id="ps-note"
              className="ps-input ps-textarea"
              rows={3}
              value={form.note}
              placeholder="Annotazioni libere, sempre disponibili…"
              onChange={e => onChange({ ...form, note: e.target.value })}
            />
          </section>
        </div>

        <div className="ps-modal-footer">
          <button className="ps-btn ps-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="ps-btn ps-btn--accent" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Conferma & rendi effettiva ─────────────────────────────────────────────

function ConfirmEffettiva({ item, statiNormali, loading, onConfirm, onClose }: {
  item: PresaleItem
  statiNormali: StatoConfig[]
  loading: boolean
  onConfirm: (statoChiave: string) => void
  onClose: () => void
}) {
  const [target, setTarget] = useState<string>(
    statiNormali.find(s => s.chiave === 'IN_CORSO')?.chiave ?? statiNormali[0]?.chiave ?? '',
  )
  return (
    <SectionModal onClose={onClose} labelledBy="ps-eff-title">
      <div className="ps-modal ps-modal--sm">
        <div className="ps-modal-header">
          <h2 id="ps-eff-title" className="ps-modal-title">Conferma e rendi effettiva</h2>
          <button className="ps-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ps-modal-body">
          <p className="ps-confirm-text">
            L'attività <strong>{item.attivita}</strong> uscirà dalla board Presale e proseguirà come
            attività normale nello stato scelto qui sotto.
          </p>
          {statiNormali.length === 0 ? (
            <p className="ps-error-banner" role="alert">
              Nessuno stato normale configurato. Creane uno in Impostazioni → Stati Attività.
            </p>
          ) : (
            <div className="ps-field">
              <label className="ps-label" htmlFor="ps-eff-stato">Stato di arrivo</label>
              <select id="ps-eff-stato" className="ps-input" value={target} onChange={e => setTarget(e.target.value)}>
                {statiNormali.map(s => <option key={s.chiave} value={s.chiave}>{s.label}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="ps-modal-footer">
          <button className="ps-btn ps-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button
            className="ps-btn ps-btn--primary"
            type="button"
            onClick={() => onConfirm(target)}
            disabled={loading || !target}
          >
            {loading ? 'Conferma…' : 'Conferma'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Detail drawer ──────────────────────────────────────────────────────────

function Timeline({ token, attivitaId, statoByChiave }: {
  token: string
  attivitaId: string
  statoByChiave: Map<string, StatoConfig>
}) {
  const [storico, setStorico] = useState<StoricoEntry[]>([])
  const [loading, setLoading] = useState(true)

  // loading parte true (useState) e il componente viene rimontato per attività
  // (key sull'uso della Timeline): niente setState sincrono nell'effect.
  useEffect(() => {
    let alive = true
    fetch(`${API_URL}/api/attivita/${attivitaId}/storico`, { headers: authHeaders(token) })
      .then(r => r.ok ? r.json() : { storico: [] })
      .then(d => { if (alive) setStorico(d.storico ?? []) })
      .catch(() => { if (alive) setStorico([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token, attivitaId])

  const label = (chiave: string) => statoByChiave.get(chiave)?.label ?? chiave
  const colore = (chiave: string) => statoByChiave.get(chiave)?.colore ?? '#94a3b8'

  if (loading) return <p className="ps-tl-empty">Caricamento storico…</p>
  if (storico.length === 0) return <p className="ps-tl-empty">Nessun passaggio registrato.</p>

  return (
    <ol className="ps-tl">
      {storico.map(ev => (
        <li key={ev.id} className="ps-tl-item">
          <span className="ps-tl-dot" style={{ backgroundColor: colore(ev.statoA), borderColor: colore(ev.statoA) }} />
          <div className="ps-tl-content">
            <p className="ps-tl-label">
              {ev.statoDa === null
                ? <>Creata in <strong>{label(ev.statoA)}</strong></>
                : <><span className="ps-tl-from">{label(ev.statoDa)}</span> → <strong>{label(ev.statoA)}</strong></>}
            </p>
            <p className="ps-tl-meta">
              {ev.utente && <>{ev.utente} · </>}{fmtDateTime(ev.data)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function DetailDrawer({ item, token, statoCfg, statoByChiave, onClose, onEdit, onConfirm, onDelete }: {
  item: PresaleItem
  token: string
  statoCfg: StatoConfig | undefined
  statoByChiave: Map<string, StatoConfig>
  onClose: () => void
  onEdit: () => void
  onConfirm: () => void
  onDelete: () => void
}) {
  const colore = statoCfg?.colore ?? '#7C3AED'
  return (
    <SectionModal onClose={onClose} labelledBy="ps-det-title">
      <div className="ps-modal ps-modal--detail">
        <div className="ps-modal-header">
          <h2 id="ps-det-title" className="ps-modal-title">{item.attivita}</h2>
          <button className="ps-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ps-modal-body">
          <span className="ps-badge" style={{ backgroundColor: colore + '22', color: colore, borderColor: colore + '55' }}>
            {statoCfg?.label ?? item.stato}
          </span>

          {/* Solo i dati effettivamente compilati finora — le fasi non ancora
              raggiunte non mostrano righe vuote. */}
          <dl className="ps-dl">
            <div className="ps-dl-row"><dt>Cliente</dt><dd>{item.cliente}</dd></div>
            <div className="ps-dl-row"><dt>Progetto</dt><dd>{item.progetto}</dd></div>
            {item.account && <div className="ps-dl-row"><dt>Account</dt><dd>{item.account}</dd></div>}
            {item.projectManager && <div className="ps-dl-row"><dt>PM</dt><dd>{item.projectManager}</dd></div>}
            {item.presaleAssegnatario && <div className="ps-dl-row"><dt>Assegnatario DevHub</dt><dd>{item.presaleAssegnatario}</dd></div>}
            {item.presaleScadenzaStima && <div className="ps-dl-row"><dt>Stima desiderata entro</dt><dd>{fmtDate(item.presaleScadenzaStima)}</dd></div>}
            {item.presaleGiornateStimate !== null && <div className="ps-dl-row"><dt>Giornate stimate</dt><dd>{fmtNum(item.presaleGiornateStimate)}</dd></div>}
            {item.giornateVendute !== null && <div className="ps-dl-row"><dt>Giornate vendute</dt><dd>{fmtNum(item.giornateVendute)}</dd></div>}
            {item.presaleLinkRequisiti && (
              <div className="ps-dl-row">
                <dt>Analisi requisiti</dt>
                <dd><a href={item.presaleLinkRequisiti} target="_blank" rel="noreferrer" className="ps-link">Apri su Drive ↗</a></dd>
              </div>
            )}
            {item.presaleLinkStima && (
              <div className="ps-dl-row">
                <dt>Analisi di stima</dt>
                <dd><a href={item.presaleLinkStima} target="_blank" rel="noreferrer" className="ps-link">Apri su Drive ↗</a></dd>
              </div>
            )}
            {item.note && <div className="ps-dl-row"><dt>Note</dt><dd className="ps-dl-note">{item.note}</dd></div>}
          </dl>

          <div className="ps-tl-section">
            <h3 className="ps-tl-title">Storico passaggi</h3>
            <Timeline key={item.id} token={token} attivitaId={item.id} statoByChiave={statoByChiave} />
          </div>
        </div>
        <div className="ps-modal-footer ps-modal-footer--split">
          <button className="ps-btn ps-btn--danger-ghost" type="button" onClick={onDelete}>Elimina</button>
          <div className="ps-footer-actions">
            <button className="ps-btn ps-btn--ghost" type="button" onClick={onEdit}>Modifica</button>
            <button className="ps-btn ps-btn--primary" type="button" onClick={onConfirm}>Conferma e rendi effettiva</button>
          </div>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function PresaleCard({ item, accent, onDragStart, onOpen }: {
  item: PresaleItem
  accent: string
  onDragStart: (id: string) => void
  onOpen: (item: PresaleItem) => void
}) {
  return (
    <div
      className="ps-card"
      style={{ ['--ps-card-c' as string]: accent }}
      draggable
      onDragStart={() => onDragStart(item.id)}
      onClick={() => onOpen(item)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(item) }}
    >
      <p className="ps-card-title">{item.attivita}</p>
      <p className="ps-card-sub">{item.cliente} · {item.progetto}</p>
      <div className="ps-card-meta">
        {item.presaleAssegnatario && <span className="ps-tag ps-tag--dev">{item.presaleAssegnatario}</span>}
        {item.projectManager && <span className="ps-tag">{item.projectManager}</span>}
      </div>
      {(item.presaleGiornateStimate !== null || item.giornateVendute !== null || item.presaleScadenzaStima) && (
        <div className="ps-card-foot">
          {item.presaleGiornateStimate !== null && <span title="Giornate stimate">≈ {fmtNum(item.presaleGiornateStimate)}gg</span>}
          {item.giornateVendute !== null && <span title="Giornate vendute">✓ {fmtNum(item.giornateVendute)}gg</span>}
          {item.presaleScadenzaStima && <span className="ps-card-deadline" title="Stima desiderata entro">🎯 {fmtDate(item.presaleScadenzaStima)}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PresalePage({ token }: { token: string }) {
  const [items, setItems] = useState<PresaleItem[]>([])
  const [stati, setStati] = useState<StatoConfig[]>([])
  const [clienti, setClienti] = useState<ClienteOption[]>([])
  const [progetti, setProgetti] = useState<ProgettoOption[]>([])
  const [pms, setPms] = useState<UserRef[]>([])
  const [devHubs, setDevHubs] = useState<UserRef[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterCliente, setFilterCliente] = useState('')

  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [selected, setSelected] = useState<PresaleItem | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<PresaleItem | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [delTarget, setDelTarget] = useState<PresaleItem | null>(null)

  const dragIdRef = useRef<string | null>(null)

  const statiPresale = useMemo(
    () => stati.filter(s => s.isPresale).sort((a, b) => a.ordine - b.ordine),
    [stati],
  )
  const statiNormali = useMemo(
    () => stati.filter(s => !s.isPresale && !s.isArchiviato).sort((a, b) => a.ordine - b.ordine),
    [stati],
  )
  const statoByChiave = useMemo(() => new Map(stati.map(s => [s.chiave, s])), [stati])

  const fetchAll = useCallback(async () => {
    setLoading(true); setApiError(null)
    try {
      const [rA, rS, rC, rP, rPm, rDh] = await Promise.all([
        fetch(`${API_URL}/api/attivita/presale`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/stati-attivita`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/clienti`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/progetti`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=PM`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=DEVHUB`, { headers: authHeaders(token) }),
      ])
      if (!rA.ok || !rS.ok) throw new Error()
      const [a, s, c, p, pm, dh] = await Promise.all([
        rA.json(), rS.json(),
        rC.ok ? rC.json() : Promise.resolve([]),
        rP.ok ? rP.json() : Promise.resolve([]),
        rPm.ok ? rPm.json() : Promise.resolve([]),
        rDh.ok ? rDh.json() : Promise.resolve([]),
      ])
      setItems(a.attivita ?? [])
      setStati(s)
      setClienti(c)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setProgetti((p as any[]).map((pr: any) => ({ id: pr.id, nome: pr.nome, clienteId: pr.clienteId ?? null })))
      setPms(pm)
      setDevHubs(dh)
    } catch {
      setApiError('Impossibile caricare i dati Presale.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { queueMicrotask(() => { fetchAll() }) }, [fetchAll])

  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter(i => !filterCliente || i.clienteId === filterCliente)
      .filter(i => !q ||
        i.attivita.toLowerCase().includes(q) ||
        i.cliente.toLowerCase().includes(q) ||
        i.progetto.toLowerCase().includes(q))
  }, [items, search, filterCliente])

  const clientiInUso = useMemo(() => {
    const ids = new Set(items.map(i => i.clienteId).filter(Boolean) as string[])
    return clienti.filter(c => ids.has(c.id))
  }, [items, clienti])

  // ── Drag & drop: drop su colonna = cambio stato (fase) ──
  const onCardDrop = (statoChiave: string) => {
    const draggedId = dragIdRef.current
    dragIdRef.current = null
    if (!draggedId) return
    const item = items.find(i => i.id === draggedId)
    if (!item || item.stato === statoChiave) return
    setItems(prev => prev.map(i => i.id === draggedId ? { ...i, stato: statoChiave } : i))
    fetch(`${API_URL}/api/attivita/${draggedId}/stato`, {
      method: 'PATCH', headers: authHeadersJson(token), body: JSON.stringify({ stato: statoChiave }),
    }).then(res => { if (!res.ok) fetchAll() }).catch(() => fetchAll())
  }

  // ── CRUD ──
  const openAdd = () => {
    setForm({ ...EMPTY_FORM, stato: statiPresale[0]?.chiave ?? '' })
    setFormErr(null)
    setEditingId(null)
    setModal('add')
  }

  const openEdit = (item: PresaleItem) => {
    setEditingId(item.id)
    setForm({
      clienteId: item.clienteId ?? '',
      progettoId: item.progettoId ?? '',
      attivita: item.attivita,
      stato: item.stato,
      pmIds: item.pmIds,
      presaleAssegnatarioId: item.presaleAssegnatarioId ?? '',
      presaleGiornateStimate: item.presaleGiornateStimate !== null ? String(item.presaleGiornateStimate) : '',
      presaleScadenzaStima: item.presaleScadenzaStima ?? '',
      giornateVendute: item.giornateVendute !== null ? String(item.giornateVendute) : '',
      presaleLinkRequisiti: item.presaleLinkRequisiti ?? '',
      presaleLinkStima: item.presaleLinkStima ?? '',
      note: item.note ?? '',
      inizio: item.inizio ?? '',
      deadline: item.deadline ?? '',
    })
    setFormErr(null)
    setSelected(null)
    setModal('edit')
  }

  const handleSave = async () => {
    if (!form.clienteId || !form.progettoId || !form.attivita.trim()) {
      setFormErr('Cliente, progetto e attività sono obbligatori.'); return
    }
    setSaving(true); setFormErr(null)
    try {
      const url = modal === 'edit' ? `${API_URL}/api/attivita/${editingId}` : `${API_URL}/api/attivita`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const body = {
        clienteId: form.clienteId,
        progettoId: form.progettoId,
        attivita: form.attivita.trim(),
        stato: form.stato,
        pmIds: form.pmIds,
        presaleAssegnatarioId: form.presaleAssegnatarioId || null,
        presaleGiornateStimate: numOrNull(form.presaleGiornateStimate),
        presaleScadenzaStima: form.presaleScadenzaStima || null,
        giornateVendute: numOrNull(form.giornateVendute),
        presaleLinkRequisiti: form.presaleLinkRequisiti.trim() || null,
        presaleLinkStima: form.presaleLinkStima.trim() || null,
        note: form.note.trim() || null,
        inizio: form.inizio || null,
        deadline: form.deadline || null,
        ...(modal === 'add' ? { tipo: 'STANDARD' } : {}),
      }
      const res = await fetch(url, { method, headers: authHeadersJson(token), body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setModal(null)
      await fetchAll()
    } catch {
      setFormErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmEffettiva = async (statoChiave: string) => {
    if (!confirmTarget) return
    setConfirming(true)
    try {
      const res = await fetch(`${API_URL}/api/attivita/${confirmTarget.id}/stato`, {
        method: 'PATCH', headers: authHeadersJson(token), body: JSON.stringify({ stato: statoChiave }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setApiError((data as { error?: string }).error ?? 'Errore durante la conferma.')
        return
      }
      setConfirmTarget(null); setSelected(null)
      await fetchAll()
    } catch {
      setApiError('Errore di rete durante la conferma.')
    } finally {
      setConfirming(false)
    }
  }

  const handleDelete = async () => {
    if (!delTarget) return
    try {
      const res = await fetch(`${API_URL}/api/attivita/${delTarget.id}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!res.ok) { setApiError('Errore durante l\'eliminazione.'); return }
      setDelTarget(null); setSelected(null)
      await fetchAll()
    } catch {
      setApiError('Errore di rete durante l\'eliminazione.')
    }
  }

  const noPresaleStates = !loading && statiPresale.length === 0

  return (
    <div className="ps-page">
      <div className="ps-toolbar">
        <div className="ps-toolbar-filters">
          <input
            className="ps-search"
            type="search"
            placeholder="Cerca attività, cliente, progetto…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="ps-input ps-filter-select" value={filterCliente} onChange={e => setFilterCliente(e.target.value)}>
            <option value="">Tutti i clienti</option>
            {clientiInUso.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <button className="ps-btn ps-btn--primary" type="button" onClick={openAdd} disabled={noPresaleStates}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Nuova attività Presale
        </button>
      </div>

      {apiError && <p className="ps-page-error" role="alert">{apiError}</p>}

      {noPresaleStates && (
        <div className="ps-empty">
          <p className="ps-empty-title">Nessuna fase Presale configurata</p>
          <p className="ps-empty-sub">
            Vai in <strong>Impostazioni → Stati Attività</strong> e attiva il flag "Fase Presale"
            sugli stati che vuoi usare come colonne di questa board.
          </p>
        </div>
      )}

      {loading ? (
        <div className="ps-loading">Caricamento…</div>
      ) : !noPresaleStates && (
        <div className="ps-board">
          {statiPresale.map(col => {
            const colItems = displayItems.filter(i => i.stato === col.chiave)
            return (
              <div
                key={col.chiave}
                className="ps-col"
                onDragOver={e => e.preventDefault()}
                onDrop={() => onCardDrop(col.chiave)}
              >
                <div className="ps-col-head" style={{ ['--ps-col-c' as string]: col.colore }}>
                  <span className="ps-col-dot" style={{ backgroundColor: col.colore }} />
                  <span className="ps-col-title">{col.label}</span>
                  <span className="ps-col-count">{colItems.length}</span>
                </div>
                <div className="ps-col-body">
                  {colItems.map(item => (
                    <PresaleCard key={item.id} item={item} accent={col.colore} onDragStart={id => { dragIdRef.current = id }} onOpen={setSelected} />
                  ))}
                  {colItems.length === 0 && <p className="ps-col-empty">—</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(modal === 'add' || modal === 'edit') && (
        <PresaleModal
          mode={modal}
          form={form}
          statiPresale={statiPresale}
          clienti={clienti}
          progetti={progetti}
          pms={pms}
          devHubs={devHubs}
          loading={saving}
          apiError={formErr}
          onChange={setForm}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {selected && (
        <DetailDrawer
          item={selected}
          token={token}
          statoCfg={statoByChiave.get(selected.stato)}
          statoByChiave={statoByChiave}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onConfirm={() => { setConfirmTarget(selected); }}
          onDelete={() => setDelTarget(selected)}
        />
      )}

      {confirmTarget && (
        <ConfirmEffettiva
          item={confirmTarget}
          statiNormali={statiNormali}
          loading={confirming}
          onConfirm={handleConfirmEffettiva}
          onClose={() => setConfirmTarget(null)}
        />
      )}

      {delTarget && (
        <SectionModal onClose={() => setDelTarget(null)} labelledBy="ps-del-title">
          <div className="ps-modal ps-modal--sm">
            <div className="ps-modal-header">
              <h2 id="ps-del-title" className="ps-modal-title">Elimina attività</h2>
              <button className="ps-modal-close" onClick={() => setDelTarget(null)} aria-label="Chiudi" type="button">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="ps-modal-body">
              <p className="ps-confirm-text">
                Eliminare l'attività <strong>{delTarget.attivita}</strong>? L'azione non è reversibile.
              </p>
            </div>
            <div className="ps-modal-footer">
              <button className="ps-btn ps-btn--ghost" type="button" onClick={() => setDelTarget(null)}>Annulla</button>
              <button className="ps-btn ps-btn--danger" type="button" onClick={handleDelete}>Elimina</button>
            </div>
          </div>
        </SectionModal>
      )}
    </div>
  )
}
