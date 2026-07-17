import { useState, useEffect, useCallback, useRef } from 'react'
import { SectionModal } from '../components/SectionModal'
import './ImpostazioniPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatoConfig {
  id: string
  chiave: string
  label: string
  colore: string
  isArchiviato: boolean
  escludiDaConteggio: boolean
  isPresale?: boolean
  // Solo stati contratto: contratto concluso, escluso dal banner scadenze.
  // In questa pagina viaggia mappato su isArchiviato (stesso toggle, label diverse).
  isChiuso?: boolean
  ordine: number
}

type Sezione = 'attivita' | 'progetto' | 'roadmap' | 'tag' | 'contratto'

interface FormState {
  label: string
  colore: string
  isArchiviato: boolean
  escludiDaConteggio: boolean
  isPresale: boolean
  ordine: string
}

const EMPTY_FORM: FormState = {
  label: '',
  colore: '#3b82f6',
  isArchiviato: false,
  escludiDaConteggio: false,
  isPresale: false,
  ordine: '99',
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}
function authHeadersJson(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function labelToChiave(label: string): string {
  return label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || '…'
}

// ─── Color dot ────────────────────────────────────────────────────────────────

function ColorDot({ colore }: { colore: string }) {
  return (
    <span
      className="imp-color-dot"
      style={{ backgroundColor: colore }}
      aria-hidden="true"
    />
  )
}

// ─── Stato badge preview ──────────────────────────────────────────────────────

function StatoBadgePreview({ stato }: { stato: StatoConfig }) {
  return (
    <span
      className="imp-badge"
      style={{
        backgroundColor: stato.colore + '22',
        color:           stato.colore,
        borderColor:     stato.colore + '55',
      }}
    >
      {stato.label}
    </span>
  )
}

// ─── Stato form modal ─────────────────────────────────────────────────────────

interface StatoModalProps {
  title: string
  form: FormState
  chiavePreview: string
  loading: boolean
  apiError: string | null
  showEscludi?: boolean
  // Stati contratto: il toggle Archiviato assume la semantica Chiuso/Aperto
  chiusoMode?: boolean
  onChange: (f: FormState) => void
  onSave: () => void
  onClose: () => void
}

function StatoModal({ title, form, chiavePreview, loading, apiError, showEscludi, chiusoMode, onChange, onSave, onClose }: StatoModalProps) {
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => { firstRef.current?.focus() }, [])

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...form, [key]: key === 'isArchiviato' ? (e.target as HTMLInputElement).checked : e.target.value })

  return (
    <SectionModal onClose={onClose} labelledBy="imp-modal-title">
      <div className="imp-modal">
        <div className="imp-modal-header">
          <h2 id="imp-modal-title" className="imp-modal-title">{title}</h2>
          <button className="imp-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="imp-modal-body">
          {apiError && (
            <p className="imp-error-banner" role="alert">{apiError}</p>
          )}

          {/* Label */}
          <div className="imp-field">
            <label htmlFor="imp-label" className="imp-label">
              Etichetta <span aria-hidden="true">*</span>
            </label>
            <input
              id="imp-label"
              ref={firstRef}
              className="imp-input"
              type="text"
              value={form.label}
              onChange={set('label')}
              placeholder="es. In lavorazione"
            />
            {form.label.trim() && (
              <span className="imp-chiave-preview">
                Chiave: <code>{chiavePreview}</code>
              </span>
            )}
          </div>

          {/* Colore */}
          <div className="imp-field">
            <label htmlFor="imp-colore" className="imp-label">Colore</label>
            <div className="imp-color-row">
              <input
                id="imp-colore"
                className="imp-color-input"
                type="color"
                value={form.colore}
                onChange={set('colore')}
              />
              <input
                className="imp-input imp-input--hex"
                type="text"
                value={form.colore}
                onChange={set('colore')}
                placeholder="#3b82f6"
                pattern="^#[0-9a-fA-F]{3,8}$"
              />
              {form.label && (
                <StatoBadgePreview stato={{
                  id: '', chiave: chiavePreview, label: form.label || 'Anteprima',
                  colore: form.colore, isArchiviato: form.isArchiviato,
                  escludiDaConteggio: form.escludiDaConteggio, isPresale: form.isPresale, ordine: 0,
                }} />
              )}
            </div>
          </div>

          {/* Tipo */}
          <div className="imp-field">
            <span className="imp-label">Tipo</span>
            <label className="imp-toggle-wrap">
              <input
                type="checkbox"
                className="imp-toggle-input"
                checked={form.isArchiviato}
                onChange={set('isArchiviato')}
                role="switch"
                aria-checked={form.isArchiviato}
              />
              <span className="imp-toggle-track" data-checked={form.isArchiviato}>
                <span className="imp-toggle-thumb" />
              </span>
              <span className="imp-toggle-label">
                {chiusoMode
                  ? (form.isArchiviato
                      ? <><span className="imp-tipo-tag imp-tipo-tag--arch">Chiuso</span> — escluso dal banner scadenze</>
                      : <><span className="imp-tipo-tag imp-tipo-tag--active">Aperto</span> — monitorato per le scadenze</>)
                  : (form.isArchiviato
                      ? <><span className="imp-tipo-tag imp-tipo-tag--arch">Archiviato</span> — non visibile nei filtri attivi</>
                      : <><span className="imp-tipo-tag imp-tipo-tag--active">Attivo</span> — visibile nel filtro "Solo attivi"</>)
                }
              </span>
            </label>
          </div>

          {/* Escludi da conteggio — solo per stati attività */}
          {showEscludi && (
            <div className="imp-field">
              <span className="imp-label">Conteggio budget</span>
              <label className="imp-toggle-wrap">
                <input
                  type="checkbox"
                  className="imp-toggle-input"
                  checked={form.escludiDaConteggio}
                  onChange={e => onChange({ ...form, escludiDaConteggio: e.target.checked })}
                  role="switch"
                  aria-checked={form.escludiDaConteggio}
                />
                <span className="imp-toggle-track" data-checked={form.escludiDaConteggio}>
                  <span className="imp-toggle-thumb" />
                </span>
                <span className="imp-toggle-label">
                  {form.escludiDaConteggio
                    ? <><span className="imp-tipo-tag imp-tipo-tag--amber">Escluso</span> — giornate non conteggiate nei totali</>
                    : <><span className="imp-tipo-tag imp-tipo-tag--active">Incluso</span> — giornate conteggiate nei totali</>
                  }
                </span>
              </label>
            </div>
          )}

          {/* Fase Presale — solo per stati attività */}
          {showEscludi && (
            <div className="imp-field">
              <span className="imp-label">Fase Presale</span>
              <label className="imp-toggle-wrap">
                <input
                  type="checkbox"
                  className="imp-toggle-input"
                  checked={form.isPresale}
                  onChange={e => onChange({ ...form, isPresale: e.target.checked })}
                  role="switch"
                  aria-checked={form.isPresale}
                />
                <span className="imp-toggle-track" data-checked={form.isPresale}>
                  <span className="imp-toggle-thumb" />
                </span>
                <span className="imp-toggle-label">
                  {form.isPresale
                    ? <><span className="imp-tipo-tag imp-tipo-tag--presale">Presale</span> — colonna della board Presale</>
                    : <><span className="imp-tipo-tag imp-tipo-tag--active">Standard</span> — stato normale di attività</>
                  }
                </span>
              </label>
            </div>
          )}

          {/* Ordine */}
          <div className="imp-field imp-field--half">
            <label htmlFor="imp-ordine" className="imp-label">Ordine di visualizzazione</label>
            <input
              id="imp-ordine"
              className="imp-input"
              type="number"
              min="0"
              step="1"
              value={form.ordine}
              onChange={set('ordine')}
            />
            <span className="imp-field-hint">Numero più basso = mostrato prima</span>
          </div>
        </div>

        <div className="imp-modal-footer">
          <button className="imp-btn imp-btn--ghost" type="button" onClick={onClose} disabled={loading}>
            Annulla
          </button>
          <button className="imp-btn imp-btn--primary" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Confirm delete modal ─────────────────────────────────────────────────────

function ConfirmDelete({ stato, loading, onConfirm, onClose }: {
  stato: StatoConfig; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="imp-del-title">
      <div className="imp-modal imp-modal--sm">
        <div className="imp-modal-header">
          <h2 id="imp-del-title" className="imp-modal-title">Elimina stato</h2>
          <button className="imp-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="imp-modal-body">
          <p className="imp-confirm-text">
            Sei sicuro di voler eliminare lo stato{' '}
            <StatoBadgePreview stato={stato} />?
            <br />
            <span className="imp-confirm-sub">
              Questa azione non è reversibile. Lo stato non deve essere in uso.
            </span>
          </p>
        </div>
        <div className="imp-modal-footer">
          <button className="imp-btn imp-btn--ghost" type="button" onClick={onClose} disabled={loading}>
            Annulla
          </button>
          <button className="imp-btn imp-btn--danger" type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── StatiTable ───────────────────────────────────────────────────────────────

interface StatiTableProps {
  stati: StatoConfig[]
  loading: boolean
  showEscludi?: boolean
  chiusoMode?: boolean
  onEdit: (s: StatoConfig) => void
  onDelete: (s: StatoConfig) => void
}

function StatiTable({ stati, loading, showEscludi, chiusoMode, onEdit, onDelete }: StatiTableProps) {
  if (loading) {
    return (
      <div className="imp-skeleton-list">
        {[...Array(4)].map((_, i) => <div key={i} className="imp-skeleton" />)}
      </div>
    )
  }

  if (stati.length === 0) {
    return (
      <div className="imp-empty">
        <svg viewBox="0 0 48 48" fill="none" width="40" height="40" aria-hidden="true">
          <rect x="8" y="12" width="32" height="4" rx="2" fill="#CBD5E1" />
          <rect x="8" y="22" width="24" height="4" rx="2" fill="#E2E8F0" />
          <rect x="8" y="32" width="20" height="4" rx="2" fill="#E2E8F0" />
        </svg>
        <p className="imp-empty-text">Nessuno stato configurato.</p>
      </div>
    )
  }

  return (
    <div className="imp-table-wrap">
      <table className="imp-table" aria-label="Elenco stati">
        <thead>
          <tr>
            <th scope="col" className="imp-th">Stato</th>
            <th scope="col" className="imp-th imp-th--chiave">Chiave</th>
            <th scope="col" className="imp-th imp-th--tipo">Tipo</th>
            {showEscludi && <th scope="col" className="imp-th imp-th--tipo">Conteggio</th>}
            <th scope="col" className="imp-th imp-th--ordine">Ordine</th>
            <th scope="col" className="imp-th imp-th--actions"></th>
          </tr>
        </thead>
        <tbody>
          {stati.map(s => (
            <tr key={s.id} className="imp-row">
              <td className="imp-cell imp-cell--stato">
                <ColorDot colore={s.colore} />
                <StatoBadgePreview stato={s} />
                {s.isPresale && <span className="imp-tipo-tag imp-tipo-tag--presale">Presale</span>}
              </td>
              <td className="imp-cell imp-cell--chiave">
                <code className="imp-code">{s.chiave}</code>
              </td>
              <td className="imp-cell">
                <span className={`imp-tipo-tag ${s.isArchiviato ? 'imp-tipo-tag--arch' : 'imp-tipo-tag--active'}`}>
                  {chiusoMode ? (s.isArchiviato ? 'Chiuso' : 'Aperto') : (s.isArchiviato ? 'Archiviato' : 'Attivo')}
                </span>
              </td>
              {showEscludi && (
                <td className="imp-cell">
                  {s.escludiDaConteggio
                    ? <span className="imp-tipo-tag imp-tipo-tag--amber">Escluso</span>
                    : <span className="imp-tipo-tag imp-tipo-tag--active">Incluso</span>
                  }
                </td>
              )}
              <td className="imp-cell imp-cell--ordine">{s.ordine}</td>
              <td className="imp-cell imp-cell--actions">
                <button
                  className="imp-icon-btn"
                  type="button"
                  aria-label={`Modifica stato ${s.label}`}
                  onClick={() => onEdit(s)}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15">
                    <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  className="imp-icon-btn imp-icon-btn--danger"
                  type="button"
                  aria-label={`Elimina stato ${s.label}`}
                  onClick={() => onDelete(s)}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15">
                    <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── StatiSezione ─────────────────────────────────────────────────────────────

interface StatiSezioneProps {
  token: string
  sezione: Sezione
}

const SEZIONE_ENDPOINT: Record<Sezione, string> = {
  attivita:  '/api/stati-attivita',
  progetto:  '/api/stati-progetto',
  roadmap:   '/api/stati-roadmap',
  tag:       '/api/roadmap-tags',
  contratto: '/api/stati-contratto',
}

function StatiSezione({ token, sezione }: StatiSezioneProps) {
  const endpoint = SEZIONE_ENDPOINT[sezione]
  // Gli stati contratto hanno isChiuso al posto di isArchiviato: qui viaggia
  // mappato sul toggle isArchiviato del form, con label Chiuso/Aperto.
  const isContratto = sezione === 'contratto'

  const [stati,    setStati]    = useState<StatoConfig[]>([])
  const [loading,  setLoading]  = useState(true)
  const [pageErr,  setPageErr]  = useState<string | null>(null)
  const [modal,    setModal]    = useState<'add' | 'edit' | null>(null)
  const [editing,  setEditing]  = useState<StatoConfig | null>(null)
  const [form,     setForm]     = useState<FormState>(EMPTY_FORM)
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState<string | null>(null)
  const [delTarget, setDelTarget] = useState<StatoConfig | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchStati = useCallback(async () => {
    setLoading(true); setPageErr(null)
    try {
      const res = await fetch(`${API_URL}${endpoint}`, { headers: authHeaders(token) })
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      const data = (await res.json()) as StatoConfig[]
      setStati(isContratto ? data.map(s => ({ ...s, isArchiviato: !!s.isChiuso })) : data)
    } catch {
      setPageErr('Impossibile caricare gli stati.')
    } finally {
      setLoading(false)
    }
  }, [token, endpoint, isContratto])

  useEffect(() => {
    queueMicrotask(() => { fetchStati() })
  }, [fetchStati])

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, ordine: String((stati.at(-1)?.ordine ?? 0) + 1) })
    setFormErr(null)
    setModal('add')
  }

  const openEdit = (s: StatoConfig) => {
    setEditing(s)
    setForm({ label: s.label, colore: s.colore, isArchiviato: s.isArchiviato, escludiDaConteggio: s.escludiDaConteggio, isPresale: s.isPresale ?? false, ordine: String(s.ordine) })
    setFormErr(null)
    setModal('edit')
  }

  const handleSave = async () => {
    if (!form.label.trim()) { setFormErr('L\'etichetta è obbligatoria.'); return }
    if (form.colore && !/^#[0-9a-fA-F]{3,8}$/.test(form.colore)) {
      setFormErr('Colore non valido. Usa il formato hex (es. #3b82f6).'); return
    }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}${endpoint}/${editing!.id}` : `${API_URL}${endpoint}`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const body = isContratto
        ? {
            label:    form.label.trim(),
            colore:   form.colore || '#94a3b8',
            isChiuso: form.isArchiviato,
            ordine:   parseInt(form.ordine) || 99,
          }
        : {
            label:              form.label.trim(),
            colore:             form.colore || '#94a3b8',
            isArchiviato:       form.isArchiviato,
            escludiDaConteggio: sezione === 'attivita' ? form.escludiDaConteggio : false,
            isPresale:          sezione === 'attivita' ? form.isPresale : false,
            ordine:             parseInt(form.ordine) || 99,
          }
      const res = await fetch(url, { method, headers: authHeadersJson(token), body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setModal(null)
      await fetchStati()
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
      const res = await fetch(`${API_URL}${endpoint}/${delTarget.id}`, {
        method: 'DELETE', headers: authHeaders(token),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPageErr((data as { error?: string }).error ?? 'Errore durante l\'eliminazione.')
        setDelTarget(null)
        return
      }
      setDelTarget(null)
      await fetchStati()
    } catch {
      setPageErr('Errore durante l\'eliminazione.')
      setDelTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const chiavePreview = labelToChiave(form.label)
  const attiviCount   = stati.filter(s => !s.isArchiviato).length
  const archivCount   = stati.filter(s => s.isArchiviato).length

  return (
    <div className="imp-sezione">
      <div className="imp-sezione-topbar">
        <div>
          {!loading && (
            <p className="imp-sezione-sub">
              {stati.length} stati totali
              {attiviCount > 0 && ` · ${attiviCount} attivi`}
              {archivCount > 0 && ` · ${archivCount} archiviati`}
            </p>
          )}
        </div>
        <button className="imp-btn imp-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Nuovo stato
        </button>
      </div>

      {pageErr && <p className="imp-page-error" role="alert">{pageErr}</p>}

      <StatiTable
        stati={stati}
        loading={loading}
        showEscludi={sezione === 'attivita'}
        chiusoMode={isContratto}
        onEdit={openEdit}
        onDelete={setDelTarget}
      />

      {(modal === 'add' || modal === 'edit') && (
        <StatoModal
          title={modal === 'add' ? 'Nuovo stato' : 'Modifica stato'}
          form={form}
          chiavePreview={chiavePreview}
          loading={saving}
          apiError={formErr}
          showEscludi={sezione === 'attivita'}
          chiusoMode={isContratto}
          onChange={setForm}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {delTarget && (
        <ConfirmDelete
          stato={delTarget}
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDelTarget(null)}
        />
      )}
    </div>
  )
}

// ─── Tag Roadmap ──────────────────────────────────────────────────────────────
// Forma più leggera di uno "stato": solo label/colore/ordine, nessuna chiave,
// nessun tipo attivo/archiviato — un'attività roadmap può avere più tag.

interface TagConfig { id: string; label: string; colore: string; ordine: number }

interface TagFormState { label: string; colore: string; ordine: string }
const EMPTY_TAG_FORM: TagFormState = { label: '', colore: '#3b82f6', ordine: '99' }

function TagBadgePreview({ tag }: { tag: TagConfig | { label: string; colore: string } }) {
  return (
    <span className="imp-badge" style={{ backgroundColor: tag.colore + '22', color: tag.colore, borderColor: tag.colore + '55' }}>
      {tag.label}
    </span>
  )
}

function TagModal({ title, form, loading, apiError, onChange, onSave, onClose }: {
  title: string; form: TagFormState; loading: boolean; apiError: string | null
  onChange: (f: TagFormState) => void; onSave: () => void; onClose: () => void
}) {
  const firstRef = useRef<HTMLInputElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [])
  const set = (key: keyof TagFormState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...form, [key]: e.target.value })

  return (
    <SectionModal onClose={onClose} labelledBy="imp-tag-modal-title">
      <div className="imp-modal">
        <div className="imp-modal-header">
          <h2 id="imp-tag-modal-title" className="imp-modal-title">{title}</h2>
          <button className="imp-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="imp-modal-body">
          {apiError && <p className="imp-error-banner" role="alert">{apiError}</p>}

          <div className="imp-field">
            <label htmlFor="imp-tag-label" className="imp-label">Etichetta <span aria-hidden="true">*</span></label>
            <input id="imp-tag-label" ref={firstRef} className="imp-input" type="text"
              value={form.label} onChange={set('label')} placeholder="es. Investimento" />
          </div>

          <div className="imp-field">
            <label htmlFor="imp-tag-colore" className="imp-label">Colore</label>
            <div className="imp-color-row">
              <input id="imp-tag-colore" className="imp-color-input" type="color" value={form.colore} onChange={set('colore')} />
              <input className="imp-input imp-input--hex" type="text" value={form.colore} onChange={set('colore')}
                placeholder="#3b82f6" pattern="^#[0-9a-fA-F]{3,8}$" />
              {form.label && <TagBadgePreview tag={{ label: form.label, colore: form.colore }} />}
            </div>
          </div>

          <div className="imp-field imp-field--half">
            <label htmlFor="imp-tag-ordine" className="imp-label">Ordine di visualizzazione</label>
            <input id="imp-tag-ordine" className="imp-input" type="number" min="0" step="1" value={form.ordine} onChange={set('ordine')} />
            <span className="imp-field-hint">Numero più basso = mostrato prima</span>
          </div>
        </div>
        <div className="imp-modal-footer">
          <button className="imp-btn imp-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="imp-btn imp-btn--primary" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

function TagConfirmDelete({ tag, loading, onConfirm, onClose }: {
  tag: TagConfig; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="imp-tag-del-title">
      <div className="imp-modal imp-modal--sm">
        <div className="imp-modal-header">
          <h2 id="imp-tag-del-title" className="imp-modal-title">Elimina tag</h2>
          <button className="imp-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="imp-modal-body">
          <p className="imp-confirm-text">
            Sei sicuro di voler eliminare il tag <TagBadgePreview tag={tag} />?
            <br /><span className="imp-confirm-sub">Verrà rimosso da tutte le attività roadmap a cui è assegnato.</span>
          </p>
        </div>
        <div className="imp-modal-footer">
          <button className="imp-btn imp-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="imp-btn imp-btn--danger" type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

function TagSezione({ token }: { token: string }) {
  const [tags,      setTags]      = useState<TagConfig[]>([])
  const [loading,   setLoading]   = useState(true)
  const [pageErr,   setPageErr]   = useState<string | null>(null)
  const [modal,     setModal]     = useState<'add' | 'edit' | null>(null)
  const [editing,   setEditing]   = useState<TagConfig | null>(null)
  const [form,      setForm]      = useState<TagFormState>(EMPTY_TAG_FORM)
  const [saving,    setSaving]    = useState(false)
  const [formErr,   setFormErr]   = useState<string | null>(null)
  const [delTarget, setDelTarget] = useState<TagConfig | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const fetchTags = useCallback(async () => {
    setLoading(true); setPageErr(null)
    try {
      const res = await fetch(`${API_URL}/api/roadmap-tags`, { headers: authHeaders(token) })
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      setTags(await res.json())
    } catch {
      setPageErr('Impossibile caricare i tag.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { queueMicrotask(() => { fetchTags() }) }, [fetchTags])

  const openAdd = () => {
    setForm({ ...EMPTY_TAG_FORM, ordine: String((tags.at(-1)?.ordine ?? 0) + 1) })
    setFormErr(null)
    setModal('add')
  }
  const openEdit = (t: TagConfig) => {
    setEditing(t)
    setForm({ label: t.label, colore: t.colore, ordine: String(t.ordine) })
    setFormErr(null)
    setModal('edit')
  }

  const handleSave = async () => {
    if (!form.label.trim()) { setFormErr('L\'etichetta è obbligatoria.'); return }
    if (form.colore && !/^#[0-9a-fA-F]{3,8}$/.test(form.colore)) {
      setFormErr('Colore non valido. Usa il formato hex (es. #3b82f6).'); return
    }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/api/roadmap-tags/${editing!.id}` : `${API_URL}/api/roadmap-tags`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const body = { label: form.label.trim(), colore: form.colore || '#94a3b8', ordine: parseInt(form.ordine) || 99 }
      const res = await fetch(url, { method, headers: authHeadersJson(token), body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setModal(null)
      await fetchTags()
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
      const res = await fetch(`${API_URL}/api/roadmap-tags/${delTarget.id}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null)
      await fetchTags()
    } catch {
      setPageErr('Errore durante l\'eliminazione.')
      setDelTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="imp-sezione">
      <div className="imp-sezione-topbar">
        <div>{!loading && <p className="imp-sezione-sub">{tags.length} tag totali</p>}</div>
        <button className="imp-btn imp-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Nuovo tag
        </button>
      </div>

      {pageErr && <p className="imp-page-error" role="alert">{pageErr}</p>}

      {loading ? (
        <div className="imp-skeleton-list">{[...Array(3)].map((_, i) => <div key={i} className="imp-skeleton" />)}</div>
      ) : tags.length === 0 ? (
        <div className="imp-empty">
          <svg viewBox="0 0 48 48" fill="none" width="40" height="40" aria-hidden="true">
            <rect x="8" y="12" width="32" height="4" rx="2" fill="#CBD5E1" />
            <rect x="8" y="22" width="24" height="4" rx="2" fill="#E2E8F0" />
            <rect x="8" y="32" width="20" height="4" rx="2" fill="#E2E8F0" />
          </svg>
          <p className="imp-empty-text">Nessun tag configurato.</p>
        </div>
      ) : (
        <div className="imp-table-wrap">
          <table className="imp-table" aria-label="Elenco tag">
            <thead>
              <tr>
                <th scope="col" className="imp-th">Tag</th>
                <th scope="col" className="imp-th imp-th--ordine">Ordine</th>
                <th scope="col" className="imp-th imp-th--actions"></th>
              </tr>
            </thead>
            <tbody>
              {tags.map(t => (
                <tr key={t.id} className="imp-row">
                  <td className="imp-cell imp-cell--stato">
                    <ColorDot colore={t.colore} />
                    <TagBadgePreview tag={t} />
                  </td>
                  <td className="imp-cell imp-cell--ordine">{t.ordine}</td>
                  <td className="imp-cell imp-cell--actions">
                    <button className="imp-icon-btn" type="button" aria-label={`Modifica tag ${t.label}`} onClick={() => openEdit(t)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="imp-icon-btn imp-icon-btn--danger" type="button" aria-label={`Elimina tag ${t.label}`} onClick={() => setDelTarget(t)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15">
                        <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(modal === 'add' || modal === 'edit') && (
        <TagModal title={modal === 'add' ? 'Nuovo tag' : 'Modifica tag'} form={form} loading={saving} apiError={formErr}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {delTarget && (
        <TagConfirmDelete tag={delTarget} loading={deleting} onConfirm={handleDelete} onClose={() => setDelTarget(null)} />
      )}
    </div>
  )
}

// ─── Notifiche Presale (SAIOT) ────────────────────────────────────────────────
// Parametri dell'invio mail via SAIOT + email gruppo DevHub + interruttore.
// Il testo delle mail vive in SAIOT: qui solo endpoint/codici/destinatario.

interface PresaleEmailConfig {
  url: string
  contextCode: string
  senderCode: string
  eventName: string
  devhubEmail: string
  enabled: boolean
}

const EMPTY_PRESALE_CFG: PresaleEmailConfig = {
  url: '', contextCode: '', senderCode: '', eventName: 'tpm', devhubEmail: '', enabled: false,
}

function PresaleEmailSezione({ token }: { token: string }) {
  const [cfg, setCfg] = useState<PresaleEmailConfig>(EMPTY_PRESALE_CFG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageErr, setPageErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const fetchCfg = useCallback(async () => {
    setLoading(true); setPageErr(null)
    try {
      const res = await fetch(`${API_URL}/api/config/presale-email`, { headers: authHeaders(token) })
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      setCfg(await res.json())
    } catch {
      setPageErr('Impossibile caricare la configurazione.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { queueMicrotask(() => { fetchCfg() }) }, [fetchCfg])

  const set = <K extends keyof PresaleEmailConfig>(key: K, value: PresaleEmailConfig[K]) => {
    setCfg(prev => ({ ...prev, [key]: value }))
    setOkMsg(null)
  }

  const handleSave = async () => {
    if (cfg.devhubEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.devhubEmail.trim())) {
      setPageErr('Email gruppo DevHub non valida.'); return
    }
    setSaving(true); setPageErr(null); setOkMsg(null)
    try {
      const res = await fetch(`${API_URL}/api/config/presale-email`, {
        method: 'PUT', headers: authHeadersJson(token), body: JSON.stringify(cfg),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPageErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setCfg(await res.json())
      setOkMsg('Configurazione salvata.')
    } catch {
      setPageErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="imp-skeleton-list">{[...Array(4)].map((_, i) => <div key={i} className="imp-skeleton" />)}</div>
  }

  return (
    <div className="imp-sezione">
      <div className="imp-sezione-topbar">
        <p className="imp-sezione-sub">
          Notifiche via SAIOT a ogni passaggio di fase Presale. I testi delle mail sono configurati in SAIOT.
        </p>
      </div>

      {pageErr && <p className="imp-page-error" role="alert">{pageErr}</p>}
      {okMsg && <p className="imp-ok-banner" role="status">{okMsg}</p>}

      <div className="imp-cfg-card">
        {/* Interruttore invii */}
        <div className="imp-field">
          <span className="imp-label">Invii Presale</span>
          <label className="imp-toggle-wrap">
            <input
              type="checkbox"
              className="imp-toggle-input"
              checked={cfg.enabled}
              onChange={e => set('enabled', e.target.checked)}
              role="switch"
              aria-checked={cfg.enabled}
            />
            <span className="imp-toggle-track" data-checked={cfg.enabled}>
              <span className="imp-toggle-thumb" />
            </span>
            <span className="imp-toggle-label">
              {cfg.enabled
                ? <><span className="imp-tipo-tag imp-tipo-tag--active">Attivi</span> — le mail partono ai cambi di fase</>
                : <><span className="imp-tipo-tag imp-tipo-tag--arch">Disattivati</span> — nessuna mail viene inviata</>
              }
            </span>
          </label>
        </div>

        <div className="imp-field">
          <label htmlFor="cfg-devhub" className="imp-label">Email gruppo DevHub</label>
          <input id="cfg-devhub" className="imp-input" type="email" value={cfg.devhubEmail}
            onChange={e => set('devhubEmail', e.target.value)} placeholder="es. devhub@soluzione1.it" />
          <span className="imp-field-hint">Destinatario/Cc delle notifiche verso il team DevHub.</span>
        </div>

        {/* Parametri tecnici dell'integrazione SAIOT, raggruppati sotto un
            sotto-titolo per distinguerli dalle preferenze di invio sopra. */}
        <div className="imp-cfg-group">
          <h3 className="imp-cfg-subtitle">Configurazione SAIOT</h3>

          <div className="imp-field">
            <label htmlFor="cfg-url" className="imp-label">Endpoint SAIOT</label>
            <input id="cfg-url" className="imp-input" type="url" value={cfg.url}
              onChange={e => set('url', e.target.value)} placeholder="https://…/saiot-rest/rest/events/express" />
          </div>

          <div className="imp-cfg-row">
            <div className="imp-field">
              <label htmlFor="cfg-ctx" className="imp-label">contextCode</label>
              <input id="cfg-ctx" className="imp-input" type="text" value={cfg.contextCode}
                onChange={e => set('contextCode', e.target.value)} />
            </div>
            <div className="imp-field">
              <label htmlFor="cfg-snd" className="imp-label">senderCode</label>
              <input id="cfg-snd" className="imp-input" type="text" value={cfg.senderCode}
                onChange={e => set('senderCode', e.target.value)} />
            </div>
          </div>

          <div className="imp-field imp-field--half">
            <label htmlFor="cfg-ev" className="imp-label">event_name</label>
            <input id="cfg-ev" className="imp-input" type="text" value={cfg.eventName}
              onChange={e => set('eventName', e.target.value)} placeholder="tpm" />
          </div>
        </div>

        <div className="imp-cfg-actions">
          <button className="imp-btn imp-btn--primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva configurazione'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ImpostazioniPage ─────────────────────────────────────────────────────────
// Layout a due pannelli: nav verticale a sinistra con voci raggruppate,
// contenuto a destra. Le sezioni crescevano come tab orizzontali e non
// scalavano più: i gruppi della nav sono il punto di estensione per le
// prossime impostazioni.

// ─── Sezione Google Drive ─────────────────────────────────────────────────────
// Radici dei drive condivisi per i picker: Sviluppo (analisi prodotti +
// presale analisi/stima) e Commerciale (presale trattativa). L'utente incolla
// il link dello shared drive/cartella, il backend estrae e salva l'ID.

interface GDriveConfigForm { devUrl: string; commUrl: string; contrattiUrl: string }

function GoogleDriveSezione({ token }: { token: string }) {
  const [form, setForm]       = useState<GDriveConfigForm>({ devUrl: '', commUrl: '', contrattiUrl: '' })
  const [ids, setIds]         = useState<{ devId: string; commId: string; contrattiId: string }>({ devId: '', commId: '', contrattiId: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [pageErr, setPageErr] = useState<string | null>(null)
  const [okMsg, setOkMsg]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/api/config/google-drive`, { headers: authHeaders(token) })
        if (!res.ok) throw new Error()
        const data = await res.json() as { devUrl: string; devId: string; commUrl: string; commId: string; contrattiUrl: string; contrattiId: string }
        if (cancelled) return
        setForm({ devUrl: data.devUrl, commUrl: data.commUrl, contrattiUrl: data.contrattiUrl })
        setIds({ devId: data.devId, commId: data.commId, contrattiId: data.contrattiId })
      } catch {
        if (!cancelled) setPageErr('Impossibile caricare la configurazione.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const set = (key: keyof GDriveConfigForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }))
    setOkMsg(null)
  }

  const handleSave = async () => {
    setSaving(true); setPageErr(null); setOkMsg(null)
    try {
      const res = await fetch(`${API_URL}/api/config/google-drive`, {
        method: 'PUT', headers: authHeadersJson(token), body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPageErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      const data = await res.json() as { devUrl: string; devId: string; commUrl: string; commId: string; contrattiUrl: string; contrattiId: string }
      setForm({ devUrl: data.devUrl, commUrl: data.commUrl, contrattiUrl: data.contrattiUrl })
      setIds({ devId: data.devId, commId: data.commId, contrattiId: data.contrattiId })
      setOkMsg('Configurazione salvata.')
    } catch {
      setPageErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="imp-skeleton-list">{[...Array(3)].map((_, i) => <div key={i} className="imp-skeleton" />)}</div>
  }

  return (
    <div className="imp-sezione">
      <div className="imp-sezione-topbar">
        <p className="imp-sezione-sub">
          Drive condivisi usati dai picker "Scegli da Drive": incolla il link dello shared drive o di una sua cartella.
          Gli utenti vedono solo ciò a cui hanno già accesso su Drive.
        </p>
      </div>

      {pageErr && <p className="imp-page-error" role="alert">{pageErr}</p>}
      {okMsg && <p className="imp-ok-banner" role="status">{okMsg}</p>}

      <div className="imp-cfg-card">
        <div className="imp-field">
          <label htmlFor="cfg-gdrive-dev" className="imp-label">Drive Sviluppo</label>
          <input id="cfg-gdrive-dev" className="imp-input" type="url" value={form.devUrl}
            onChange={set('devUrl')} placeholder="https://drive.google.com/drive/folders/…" />
          <span className="imp-field-hint">
            Analisi della Roadmap Prodotti e fasi presale Analisi iniziale + Stima.
            {ids.devId && <> ID rilevato: <code>{ids.devId}</code></>}
          </span>
        </div>

        <div className="imp-field">
          <label htmlFor="cfg-gdrive-comm" className="imp-label">Drive Commerciale</label>
          <input id="cfg-gdrive-comm" className="imp-input" type="url" value={form.commUrl}
            onChange={set('commUrl')} placeholder="https://drive.google.com/drive/folders/…" />
          <span className="imp-field-hint">
            Fase presale Trattativa cliente (offerte).
            {ids.commId && <> ID rilevato: <code>{ids.commId}</code></>}
          </span>
        </div>

        <div className="imp-field">
          <label htmlFor="cfg-gdrive-contratti" className="imp-label">Drive Contratti</label>
          <input id="cfg-gdrive-contratti" className="imp-input" type="url" value={form.contrattiUrl}
            onChange={set('contrattiUrl')} placeholder="https://drive.google.com/drive/folders/…" />
          <span className="imp-field-hint">
            Documenti dei contratti assistenza/AMS (drive condiviso "Contratti annuali clienti e prodotti").
            {ids.contrattiId && <> ID rilevato: <code>{ids.contrattiId}</code></>}
          </span>
        </div>

        <div className="imp-cfg-actions">
          <button className="imp-btn imp-btn--primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva configurazione'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sezione Parametri Contratti ──────────────────────────────────────────────
// Costo medio giornata risorsa (€): usato dalla pagina Contratti per il
// confronto economico consuntivato × costo medio vs budget ordini.

function ContrattiConfigSezione({ token }: { token: string }) {
  const [valore, setValore]   = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [pageErr, setPageErr] = useState<string | null>(null)
  const [okMsg, setOkMsg]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/api/config/contratti`, { headers: authHeaders(token) })
        if (!res.ok) throw new Error()
        const data = await res.json() as { costoMedioGiornata: number | null }
        if (!cancelled) setValore(data.costoMedioGiornata !== null ? String(data.costoMedioGiornata) : '')
      } catch {
        if (!cancelled) setPageErr('Impossibile caricare la configurazione.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleSave = async () => {
    const n = valore.trim() === '' ? null : Number(valore.replace(',', '.'))
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setPageErr('Il costo medio deve essere un numero ≥ 0.'); return
    }
    setSaving(true); setPageErr(null); setOkMsg(null)
    try {
      const res = await fetch(`${API_URL}/api/config/contratti`, {
        method: 'PUT', headers: authHeadersJson(token),
        body: JSON.stringify({ costoMedioGiornata: n }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPageErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      const data = await res.json() as { costoMedioGiornata: number | null }
      setValore(data.costoMedioGiornata !== null ? String(data.costoMedioGiornata) : '')
      setOkMsg('Configurazione salvata.')
    } catch {
      setPageErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="imp-skeleton-list">{[...Array(2)].map((_, i) => <div key={i} className="imp-skeleton" />)}</div>
  }

  return (
    <div className="imp-sezione">
      <div className="imp-sezione-topbar">
        <p className="imp-sezione-sub">
          Parametri della pagina Contratti Assistenza / AMS.
        </p>
      </div>

      {pageErr && <p className="imp-page-error" role="alert">{pageErr}</p>}
      {okMsg && <p className="imp-ok-banner" role="status">{okMsg}</p>}

      <div className="imp-cfg-card">
        <div className="imp-field imp-field--half">
          <label htmlFor="cfg-costo-medio" className="imp-label">Costo medio giornata risorsa (€)</label>
          <input id="cfg-costo-medio" className="imp-input" type="number" min="0" step="0.01"
            value={valore} onChange={e => { setValore(e.target.value); setOkMsg(null) }} placeholder="es. 350" />
          <span className="imp-field-hint">
            Consumato € di un contratto = giornate consuntivate delle attività collegate × questo valore,
            confrontato col budget ordini. Vuoto = confronto disattivato.
          </span>
        </div>

        <div className="imp-cfg-actions">
          <button className="imp-btn imp-btn--primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva configurazione'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ImpostazioniPageProps { token: string; showPresaleEmail?: boolean }

type SettingsKey = Sezione | 'notifiche' | 'gdrive' | 'contratti-cfg'

interface SettingsNavItem {
  key: SettingsKey
  label: string
  icon: React.ReactNode
}

const NAV_GROUPS: Array<{ label: string; items: SettingsNavItem[] }> = [
  {
    label: 'Stati e tag',
    items: [
      {
        key: 'attivita', label: 'Stati Attività',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <path d="M8 3H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-3" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="7" y="2" width="6" height="3" rx="1" strokeLinecap="round" />
            <path d="M7 9h6M7 12h4" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        key: 'progetto', label: 'Stati Progetti',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <path d="M2 6a2 2 0 0 1 2-2h3.586a1 1 0 0 1 .707.293L9.707 5.7A1 1 0 0 0 10.414 6H16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        key: 'roadmap', label: 'Stati Roadmap',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <path d="M2 10h4l2-6 4 12 2-6h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        key: 'tag', label: 'Tag Roadmap',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <path d="M3 9l6-6h5a1 1 0 0 1 1 1v5l-6 6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4z" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12.5" cy="6.5" r="1.2" />
          </svg>
        ),
      },
      {
        key: 'contratto', label: 'Stati Contratti',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <path d="M6 2h6.586a1 1 0 0 1 .707.293l2.414 2.414a1 1 0 0 1 .293.707V17a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 8h5M8 11h5M8 14h2.5" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Contratti',
    items: [
      {
        key: 'contratti-cfg', label: 'Parametri Contratti',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M7.5 12.2c.5.8 1.4 1.3 2.5 1.3 1.4 0 2.5-.8 2.5-1.9 0-2.6-4.8-1.3-4.8-3.6 0-1 1-1.8 2.3-1.8 1 0 1.9.4 2.4 1.1M10 4.8v10.4" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Integrazioni',
    items: [
      {
        key: 'notifiche', label: 'Notifiche Presale',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <path d="M3 5h14v10H3z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 6l7 5 7-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        key: 'gdrive', label: 'Google Drive',
        icon: (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
            <path d="M7 3h6l5 8.5-3 5.5H5l-3-5.5L7 3z" strokeLinejoin="round" />
            <path d="M7 3l5 8.5M13 3l-5 8.5h10M2 11.5h10l-3 5.5" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
]

export default function ImpostazioniPage({ token, showPresaleEmail }: ImpostazioniPageProps) {
  const [tab, setTab] = useState<SettingsKey>('attivita')

  // "Notifiche Presale" resta dietro allowlist; un gruppo rimasto senza voci
  // visibili sparisce del tutto.
  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(it => it.key !== 'notifiche' || showPresaleEmail) }))
    .filter(g => g.items.length > 0)

  const activeLabel = groups.flatMap(g => g.items).find(it => it.key === tab)?.label ?? ''

  return (
    <div className="imp-page imp-page--wide">
      <div className="imp-topbar">
        <h1 className="imp-title">Impostazioni</h1>
        <p className="imp-subtitle">Stati, tag, integrazioni e notifiche dell'applicazione</p>
      </div>

      <div className="imp-body">
        <nav className="imp-nav" aria-label="Sezioni impostazioni">
          {groups.map(g => (
            <div key={g.label} className="imp-nav-group">
              <span className="imp-nav-group-label">{g.label}</span>
              {g.items.map(it => (
                <button
                  key={it.key}
                  type="button"
                  className={`imp-nav-item${tab === it.key ? ' imp-nav-item--active' : ''}`}
                  aria-current={tab === it.key ? 'page' : undefined}
                  onClick={() => setTab(it.key)}
                >
                  {it.icon}
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="imp-content" role="region" aria-label={activeLabel}>
          {tab === 'notifiche'
            ? <PresaleEmailSezione token={token} />
            : tab === 'gdrive'
              ? <GoogleDriveSezione token={token} />
              : tab === 'contratti-cfg'
                ? <ContrattiConfigSezione token={token} />
                : tab === 'tag'
                  ? <TagSezione token={token} />
                  : <StatiSezione key={tab} token={token} sezione={tab} />}
        </div>
      </div>
    </div>
  )
}
