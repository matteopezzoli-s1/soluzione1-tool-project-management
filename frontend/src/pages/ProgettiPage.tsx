import { useState, useEffect, useCallback } from 'react'
import { SectionModal } from '../components/SectionModal'
import './ProgettiPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

type StatoProgetto = string  // chiave DB, es. "ATTIVO"

interface StatoProgettoConfig {
  id: string; chiave: string; label: string
  colore: string; isArchiviato: boolean; ordine: number
}

interface ClienteRef { id: string; nome: string }

interface Progetto {
  id: string; nome: string; descrizione: string | null
  stato: StatoProgetto; dataInizio: string | null; dataFine: string | null
  clienteId: string | null; cliente: ClienteRef | null
}

interface ClienteOption { id: string; nome: string }

type FormData = {
  nome: string; descrizione: string; stato: StatoProgetto
  clienteId: string; dataInizio: string; dataFine: string
}
const EMPTY_FORM: FormData = {
  nome: '', descrizione: '', stato: 'ATTIVO', clienteId: '', dataInizio: '', dataFine: ''
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function toInputDate(iso: string | null) {
  if (!iso) return ''
  return iso.split('T')[0]
}

// ─── Stato badge ─────────────────────────────────────────────────────────────

function StatoBadge({ stato, statiMap }: { stato: StatoProgetto; statiMap: Map<string, StatoProgettoConfig> }) {
  const cfg    = statiMap.get(stato)
  const label  = cfg?.label  ?? stato
  const colore = cfg?.colore ?? '#94a3b8'
  return (
    <span
      className="pr-badge"
      style={{
        backgroundColor: colore + '22',
        color:           colore,
        border:          `1px solid ${colore}55`,
      }}
    >
      {label}
    </span>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  title: string; form: FormData; loading: boolean; apiError: string | null
  clienti: ClienteOption[]; statiList: StatoProgettoConfig[]
  onChange: (f: FormData) => void; onSave: () => void; onClose: () => void
}

function Modal({ title, form, loading, apiError, clienti, statiList, onChange, onSave, onClose }: ModalProps) {
  const set = (key: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [key]: e.target.value })

  return (
    <SectionModal onClose={onClose} labelledBy="pr-modal-title">
      <div className="pr-modal">
        <div className="pr-modal-header">
          <h2 id="pr-modal-title" className="pr-modal-title">{title}</h2>
          <button className="pr-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="pr-modal-body">
          {apiError && <p className="pr-field-error pr-field-error--banner" role="alert">{apiError}</p>}

          <div className="pr-field">
            <label htmlFor="pr-nome" className="pr-label">Nome progetto <span aria-hidden="true">*</span></label>
            <input id="pr-nome" className="pr-input" type="text"
              value={form.nome} onChange={set('nome')}
              placeholder="es. Sito web e-commerce" autoFocus />
          </div>

          <div className="pr-field-row">
            <div className="pr-field">
              <label htmlFor="pr-cliente" className="pr-label">Cliente</label>
              <select id="pr-cliente" className="pr-input pr-select"
                value={form.clienteId} onChange={set('clienteId')}>
                <option value="">— Nessun cliente —</option>
                {clienti.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="pr-field">
              <label htmlFor="pr-stato" className="pr-label">Stato</label>
              <select id="pr-stato" className="pr-input pr-select"
                value={form.stato} onChange={set('stato')}>
                {statiList.map(s => (
                  <option key={s.chiave} value={s.chiave}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pr-field">
            <label htmlFor="pr-desc" className="pr-label">Descrizione</label>
            <textarea id="pr-desc" className="pr-input pr-textarea"
              value={form.descrizione} onChange={set('descrizione')}
              placeholder="Obiettivi e note del progetto…" rows={3} />
          </div>

          <div className="pr-field-row">
            <div className="pr-field">
              <label htmlFor="pr-inizio" className="pr-label">Data inizio</label>
              <input id="pr-inizio" className="pr-input" type="date"
                value={form.dataInizio} onChange={set('dataInizio')} />
            </div>
            <div className="pr-field">
              <label htmlFor="pr-fine" className="pr-label">Data fine</label>
              <input id="pr-fine" className="pr-input" type="date"
                value={form.dataFine} onChange={set('dataFine')} />
            </div>
          </div>
        </div>
        <div className="pr-modal-footer">
          <button className="pr-btn pr-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="pr-btn pr-btn--primary" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Confirm delete ───────────────────────────────────────────────────────────

function ConfirmDelete({ progetto, loading, onConfirm, onClose }: {
  progetto: Progetto; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="pr-del-title">
      <div className="pr-modal pr-modal--sm">
        <div className="pr-modal-header">
          <h2 id="pr-del-title" className="pr-modal-title">Elimina progetto</h2>
          <button className="pr-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="pr-modal-body">
          <p className="pr-confirm-text">
            Sei sicuro di voler eliminare <strong>{progetto.nome}</strong>?
            <br /><span className="pr-confirm-sub">Questa azione non è reversibile.</span>
          </p>
        </div>
        <div className="pr-modal-footer">
          <button className="pr-btn pr-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="pr-btn pr-btn--danger" type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── ProgettiPage ─────────────────────────────────────────────────────────────

interface ProgettiPageProps { token: string }

export default function ProgettiPage({ token }: ProgettiPageProps) {
  const [progetti,    setProgetti]    = useState<Progetto[]>([])
  const [clienti,     setClienti]     = useState<ClienteOption[]>([])
  const [statiConfig, setStatiConfig] = useState<StatoProgettoConfig[]>([])
  const [loading,     setLoading]     = useState(true)
  const [apiError,    setApiError]    = useState<string | null>(null)
  const [modal,       setModal]       = useState<'add' | 'edit' | null>(null)
  const [editing,     setEditing]     = useState<Progetto | null>(null)
  const [form,        setForm]        = useState<FormData>(EMPTY_FORM)
  const [saving,      setSaving]      = useState(false)
  const [formErr,     setFormErr]     = useState<string | null>(null)
  const [delTarget,   setDelTarget]   = useState<Progetto | null>(null)
  const [deleting,    setDeleting]    = useState(false)

  const statiMap  = new Map(statiConfig.map(s => [s.chiave, s]))
  const statiList = [...statiConfig].sort((a, b) => a.ordine - b.ordine)

  const fetchAll = useCallback(async () => {
    setLoading(true); setApiError(null)
    try {
      const [rP, rC, rS] = await Promise.all([
        fetch(`${API_URL}/progetti`,          { headers: authHeaders(token) }),
        fetch(`${API_URL}/clienti`,           { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/stati-progetto`, { headers: authHeaders(token) }),
      ])
      if (!rP.ok || !rC.ok) throw new Error()
      const [p, c, s] = await Promise.all([rP.json(), rC.json(), rS.ok ? rS.json() : Promise.resolve([])])
      setProgetti((p as Progetto[]).sort((a, b) =>
        (a.cliente?.nome ?? '').localeCompare(b.cliente?.nome ?? '', 'it') ||
        a.nome.localeCompare(b.nome, 'it')
      )); setClienti(c); setStatiConfig(s)
    } catch { setApiError('Impossibile caricare i dati.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    queueMicrotask(() => { fetchAll() })
  }, [fetchAll])

  const openAdd = () => { setForm(EMPTY_FORM); setFormErr(null); setModal('add') }
  const openEdit = (p: Progetto) => {
    setEditing(p)
    setForm({
      nome: p.nome, descrizione: p.descrizione ?? '', stato: p.stato,
      clienteId: p.clienteId ?? '',
      dataInizio: toInputDate(p.dataInizio), dataFine: toInputDate(p.dataFine),
    })
    setFormErr(null); setModal('edit')
  }

  const handleSave = async () => {
    if (!form.nome.trim()) { setFormErr('Il nome del progetto è obbligatorio.'); return }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/progetti/${editing!.id}` : `${API_URL}/progetti`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(form) })
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
      const res = await fetch(`${API_URL}/progetti/${delTarget.id}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null); await fetchAll()
    } catch { setDelTarget(null); setApiError('Errore durante l\'eliminazione.') }
    finally { setDeleting(false) }
  }

  const attivi     = progetti.filter(p => p.stato === 'ATTIVO').length
  const completati = progetti.filter(p => p.stato === 'COMPLETATO').length

  return (
    <div className="pr-page">
      <div className="pr-topbar">
        <div>
          <h1 className="pr-title">Anagrafica Progetti</h1>
          <p className="pr-subtitle">
            {loading ? '' : `${progetti.length} progett${progetti.length !== 1 ? 'i' : 'o'}`}
            {!loading && attivi > 0     && ` · ${attivi} attiv${attivi !== 1 ? 'i' : 'o'}`}
            {!loading && completati > 0 && ` · ${completati} completat${completati !== 1 ? 'i' : 'o'}`}
          </p>
        </div>
        <button className="pr-btn pr-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Aggiungi progetto
        </button>
      </div>

      {apiError && !loading && <p className="pr-page-error" role="alert">{apiError}</p>}

      {loading ? (
        <div className="pr-loading">{Array.from({ length: 4 }, (_, i) => <div key={i} className="pr-skeleton" />)}</div>
      ) : progetti.length === 0 ? (
        <div className="pr-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <rect x="6" y="8" width="36" height="32" rx="4" stroke="#CBD5E1" strokeWidth="2" />
            <path d="M6 16h36" stroke="#CBD5E1" strokeWidth="2" />
            <path d="M14 24h8M14 30h14" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
            <circle cx="36" cy="36" r="8" fill="#F1F5F9" stroke="#0D9488" strokeWidth="2" />
            <path d="M33 36h6M36 33v6" stroke="#0D9488" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="pr-empty-text">Nessun progetto ancora aggiunto.</p>
          <button className="pr-btn pr-btn--primary" type="button" onClick={openAdd}>Aggiungi il primo progetto</button>
        </div>
      ) : (
        <div className="pr-table-wrap">
          <table className="pr-table" aria-label="Elenco progetti">
            <thead>
              <tr>
                <th scope="col">Progetto</th>
                <th scope="col">Cliente</th>
                <th scope="col">Stato</th>
                <th scope="col">Periodo</th>
                <th scope="col" className="pr-th--actions">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {progetti.map(p => (
                <tr key={p.id} className="pr-row">
                  <td className="pr-cell-nome">
                    <span className="pr-nome">{p.nome}</span>
                    {p.descrizione && <span className="pr-desc-preview">{p.descrizione}</span>}
                  </td>
                  <td className="pr-cell-text">
                    {p.cliente
                      ? <span className="pr-cliente-tag">{p.cliente.nome}</span>
                      : <span className="pr-empty-cell">—</span>}
                  </td>
                  <td><StatoBadge stato={p.stato} statiMap={statiMap} /></td>
                  <td className="pr-cell-text pr-cell-date">
                    {p.dataInizio || p.dataFine ? (
                      <span className="pr-date-range">
                        {fmtDate(p.dataInizio) ?? '…'}
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
                          width="12" height="12" aria-hidden="true">
                          <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {fmtDate(p.dataFine) ?? '…'}
                      </span>
                    ) : <span className="pr-empty-cell">—</span>}
                  </td>
                  <td className="pr-cell-actions">
                    <button className="pr-icon-btn" type="button" aria-label={`Modifica ${p.nome}`} onClick={() => openEdit(p)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="pr-icon-btn pr-icon-btn--danger" type="button" aria-label={`Elimina ${p.nome}`} onClick={() => setDelTarget(p)}>
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
      )}

      {(modal === 'add' || modal === 'edit') && (
        <Modal
          title={modal === 'add' ? 'Aggiungi progetto' : 'Modifica progetto'}
          form={form} loading={saving} apiError={formErr} clienti={clienti}
          statiList={statiList}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {delTarget && (
        <ConfirmDelete progetto={delTarget} loading={deleting}
          onConfirm={handleDelete} onClose={() => setDelTarget(null)} />
      )}
    </div>
  )
}
