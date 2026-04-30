import { useState, useEffect, useCallback } from 'react'
import './TeamPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface PM {
  id:        string
  firstName: string
  lastName:  string
  email:     string
}

type FormData = { firstName: string; lastName: string; email: string }
const EMPTY_FORM: FormData = { firstName: '', lastName: '', email: '' }

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

// ─── Avatar initials ──────────────────────────────────────────────────────────

function Initials({ first, last }: { first: string; last: string }) {
  const letters = `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
  return <span className="tm-avatar" aria-hidden="true">{letters}</span>
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  title:    string
  form:     FormData
  loading:  boolean
  apiError: string | null
  onChange: (f: FormData) => void
  onSave:   () => void
  onClose:  () => void
}

function Modal({ title, form, loading, apiError, onChange, onSave, onClose }: ModalProps) {
  const set = (key: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value })

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSave()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="tm-overlay" role="dialog" aria-modal="true" aria-labelledby="tm-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tm-modal" onKeyDown={handleKey}>
        <div className="tm-modal-header">
          <h2 id="tm-modal-title" className="tm-modal-title">{title}</h2>
          <button className="tm-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="tm-modal-body">
          {apiError && (
            <p className="tm-field-error tm-field-error--banner" role="alert">{apiError}</p>
          )}

          <div className="tm-field-row">
            <div className="tm-field">
              <label htmlFor="tm-firstName" className="tm-label">Nome <span aria-hidden="true">*</span></label>
              <input id="tm-firstName" className="tm-input" type="text"
                value={form.firstName} onChange={set('firstName')}
                placeholder="es. Mario" autoFocus autoComplete="given-name" />
            </div>
            <div className="tm-field">
              <label htmlFor="tm-lastName" className="tm-label">Cognome <span aria-hidden="true">*</span></label>
              <input id="tm-lastName" className="tm-input" type="text"
                value={form.lastName} onChange={set('lastName')}
                placeholder="es. Rossi" autoComplete="family-name" />
            </div>
          </div>

          <div className="tm-field">
            <label htmlFor="tm-email" className="tm-label">Email <span aria-hidden="true">*</span></label>
            <input id="tm-email" className="tm-input" type="email"
              value={form.email} onChange={set('email')}
              placeholder="es. mario.rossi@azienda.it" autoComplete="email" />
          </div>
        </div>

        <div className="tm-modal-footer">
          <button className="tm-btn tm-btn--ghost" type="button" onClick={onClose}
            disabled={loading}>
            Annulla
          </button>
          <button className="tm-btn tm-btn--primary" type="button" onClick={onSave}
            disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm delete dialog ────────────────────────────────────────────────────

function ConfirmDelete({ pm, loading, onConfirm, onClose }: {
  pm: PM; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <div className="tm-overlay" role="dialog" aria-modal="true" aria-labelledby="tm-confirm-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tm-modal tm-modal--sm">
        <div className="tm-modal-header">
          <h2 id="tm-confirm-title" className="tm-modal-title">Elimina PM</h2>
          <button className="tm-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="tm-modal-body">
          <p className="tm-confirm-text">
            Sei sicuro di voler eliminare{' '}
            <strong>{pm.firstName} {pm.lastName}</strong>?
            <br />
            <span className="tm-confirm-sub">Questa azione non è reversibile.</span>
          </p>
        </div>
        <div className="tm-modal-footer">
          <button className="tm-btn tm-btn--ghost" type="button" onClick={onClose}
            disabled={loading}>Annulla</button>
          <button className="tm-btn tm-btn--danger" type="button" onClick={onConfirm}
            disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TeamPage ─────────────────────────────────────────────────────────────────

interface TeamPageProps { token: string }

export default function TeamPage({ token }: TeamPageProps) {
  const [pms,      setPms]      = useState<PM[]>([])
  const [loading,  setLoading]  = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)

  // Modal state
  const [modal,    setModal]    = useState<'add' | 'edit' | null>(null)
  const [editing,  setEditing]  = useState<PM | null>(null)
  const [form,     setForm]     = useState<FormData>(EMPTY_FORM)
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState<string | null>(null)

  // Delete confirm state
  const [delTarget, setDelTarget] = useState<PM | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  // ── Fetch list ──────────────────────────────────────────────
  const fetchPMs = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch(`${API_URL}/pm`, { headers: authHeaders(token) })
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      setPms(await res.json())
    } catch {
      setApiError('Impossibile caricare l\'elenco PM. Verifica la connessione.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchPMs() }, [fetchPMs])

  // ── Open add ───────────────────────────────────────────────
  const openAdd = () => {
    setForm(EMPTY_FORM)
    setFormErr(null)
    setModal('add')
  }

  // ── Open edit ──────────────────────────────────────────────
  const openEdit = (pm: PM) => {
    setEditing(pm)
    setForm({ firstName: pm.firstName, lastName: pm.lastName, email: pm.email })
    setFormErr(null)
    setModal('edit')
  }

  // ── Save (create or update) ─────────────────────────────────
  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setFormErr('Tutti i campi sono obbligatori.')
      return
    }
    setSaving(true)
    setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/pm/${editing!.id}` : `${API_URL}/pm`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: authHeaders(token),
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setModal(null)
      await fetchPMs()
    } catch {
      setFormErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!delTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/pm/${delTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null)
      await fetchPMs()
    } catch {
      setDelTarget(null)
      setApiError('Errore durante l\'eliminazione.')
    } finally {
      setDeleting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="tm-page">

      <div className="tm-topbar">
        <div>
          <h1 className="tm-title">Team PM</h1>
          <p className="tm-subtitle">
            {loading ? '' : `${pms.length} Project Manager${pms.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button className="tm-btn tm-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
            width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Aggiungi PM
        </button>
      </div>

      {apiError && !loading && (
        <p className="tm-page-error" role="alert">{apiError}</p>
      )}

      {loading ? (
        <div className="tm-loading" aria-label="Caricamento in corso">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="tm-skeleton" />
          ))}
        </div>
      ) : pms.length === 0 ? (
        <div className="tm-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <circle cx="18" cy="16" r="8" stroke="#CBD5E1" strokeWidth="2" />
            <path d="M4 40c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
            <path d="M32 28l8 8m0-8l-8 8" stroke="#0D9488" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="tm-empty-text">Nessun PM ancora aggiunto.</p>
          <button className="tm-btn tm-btn--primary" type="button" onClick={openAdd}>
            Aggiungi il primo PM
          </button>
        </div>
      ) : (
        <div className="tm-table-wrap">
          <table className="tm-table" aria-label="Elenco Project Manager">
            <thead>
              <tr>
                <th scope="col">PM</th>
                <th scope="col">Email</th>
                <th scope="col" className="tm-th--actions">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {pms.map(pm => (
                <tr key={pm.id} className="tm-row">
                  <td className="tm-cell-name">
                    <Initials first={pm.firstName} last={pm.lastName} />
                    <span className="tm-fullname">
                      {pm.firstName} {pm.lastName}
                    </span>
                  </td>
                  <td className="tm-cell-email">
                    <a href={`mailto:${pm.email}`} className="tm-email-link">{pm.email}</a>
                  </td>
                  <td className="tm-cell-actions">
                    <button className="tm-icon-btn" type="button"
                      aria-label={`Modifica ${pm.firstName} ${pm.lastName}`}
                      onClick={() => openEdit(pm)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
                        width="16" height="16" aria-hidden="true">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="tm-icon-btn tm-icon-btn--danger" type="button"
                      aria-label={`Elimina ${pm.firstName} ${pm.lastName}`}
                      onClick={() => setDelTarget(pm)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
                        width="16" height="16" aria-hidden="true">
                        <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11"
                          strokeLinecap="round" strokeLinejoin="round" />
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
          title={modal === 'add' ? 'Aggiungi Project Manager' : 'Modifica Project Manager'}
          form={form}
          loading={saving}
          apiError={formErr}
          onChange={setForm}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {delTarget && (
        <ConfirmDelete
          pm={delTarget}
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDelTarget(null)}
        />
      )}

    </div>
  )
}
