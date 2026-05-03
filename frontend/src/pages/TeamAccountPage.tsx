import { useState, useEffect, useCallback } from 'react'
import './TeamAccountPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface Account {
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
  return <span className="ta-avatar" aria-hidden="true">{letters}</span>
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
    <div className="ta-overlay" role="dialog" aria-modal="true" aria-labelledby="ta-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ta-modal" onKeyDown={handleKey}>
        <div className="ta-modal-header">
          <h2 id="ta-modal-title" className="ta-modal-title">{title}</h2>
          <button className="ta-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="ta-modal-body">
          {apiError && (
            <p className="ta-field-error ta-field-error--banner" role="alert">{apiError}</p>
          )}

          <div className="ta-field-row">
            <div className="ta-field">
              <label htmlFor="ta-firstName" className="ta-label">Nome <span aria-hidden="true">*</span></label>
              <input id="ta-firstName" className="ta-input" type="text"
                value={form.firstName} onChange={set('firstName')}
                placeholder="es. Mario" autoFocus autoComplete="given-name" />
            </div>
            <div className="ta-field">
              <label htmlFor="ta-lastName" className="ta-label">Cognome <span aria-hidden="true">*</span></label>
              <input id="ta-lastName" className="ta-input" type="text"
                value={form.lastName} onChange={set('lastName')}
                placeholder="es. Rossi" autoComplete="family-name" />
            </div>
          </div>

          <div className="ta-field">
            <label htmlFor="ta-email" className="ta-label">Email <span aria-hidden="true">*</span></label>
            <input id="ta-email" className="ta-input" type="email"
              value={form.email} onChange={set('email')}
              placeholder="es. mario.rossi@azienda.it" autoComplete="email" />
          </div>
        </div>

        <div className="ta-modal-footer">
          <button className="ta-btn ta-btn--ghost" type="button" onClick={onClose}
            disabled={loading}>
            Annulla
          </button>
          <button className="ta-btn ta-btn--primary" type="button" onClick={onSave}
            disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm delete dialog ────────────────────────────────────────────────────

function ConfirmDelete({ account, loading, onConfirm, onClose }: {
  account: Account; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <div className="ta-overlay" role="dialog" aria-modal="true" aria-labelledby="ta-confirm-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ta-modal ta-modal--sm">
        <div className="ta-modal-header">
          <h2 id="ta-confirm-title" className="ta-modal-title">Elimina Account</h2>
          <button className="ta-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ta-modal-body">
          <p className="ta-confirm-text">
            Sei sicuro di voler eliminare{' '}
            <strong>{account.firstName} {account.lastName}</strong>?
            <br />
            <span className="ta-confirm-sub">Questa azione non è reversibile.</span>
          </p>
        </div>
        <div className="ta-modal-footer">
          <button className="ta-btn ta-btn--ghost" type="button" onClick={onClose}
            disabled={loading}>Annulla</button>
          <button className="ta-btn ta-btn--danger" type="button" onClick={onConfirm}
            disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TeamAccountPage ──────────────────────────────────────────────────────────

interface TeamAccountPageProps { token: string }

export default function TeamAccountPage({ token }: TeamAccountPageProps) {
  const [accounts,  setAccounts]  = useState<Account[]>([])
  const [loading,   setLoading]   = useState(true)
  const [apiError,  setApiError]  = useState<string | null>(null)

  const [modal,     setModal]     = useState<'add' | 'edit' | null>(null)
  const [editing,   setEditing]   = useState<Account | null>(null)
  const [form,      setForm]      = useState<FormData>(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)
  const [formErr,   setFormErr]   = useState<string | null>(null)

  const [delTarget, setDelTarget] = useState<Account | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch(`${API_URL}/accounts`, { headers: authHeaders(token) })
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      setAccounts(await res.json())
    } catch {
      setApiError('Impossibile caricare l\'elenco account. Verifica la connessione.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setFormErr(null)
    setModal('add')
  }

  const openEdit = (account: Account) => {
    setEditing(account)
    setForm({ firstName: account.firstName, lastName: account.lastName, email: account.email })
    setFormErr(null)
    setModal('edit')
  }

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setFormErr('Tutti i campi sono obbligatori.')
      return
    }
    setSaving(true)
    setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/accounts/${editing!.id}` : `${API_URL}/accounts`
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
      await fetchAccounts()
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
      const res = await fetch(`${API_URL}/accounts/${delTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null)
      await fetchAccounts()
    } catch {
      setDelTarget(null)
      setApiError('Errore durante l\'eliminazione.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="ta-page">

      <div className="ta-topbar">
        <div>
          <h1 className="ta-title">Anagrafica Account</h1>
          <p className="ta-subtitle">
            {loading ? '' : `${accounts.length} Account${accounts.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button className="ta-btn ta-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
            width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Aggiungi Account
        </button>
      </div>

      {apiError && !loading && (
        <p className="ta-page-error" role="alert">{apiError}</p>
      )}

      {loading ? (
        <div className="ta-loading" aria-label="Caricamento in corso">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="ta-skeleton" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="ta-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <circle cx="18" cy="16" r="8" stroke="#CBD5E1" strokeWidth="2" />
            <path d="M4 40c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
            <path d="M32 28l8 8m0-8l-8 8" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="ta-empty-text">Nessun account ancora aggiunto.</p>
          <button className="ta-btn ta-btn--primary" type="button" onClick={openAdd}>
            Aggiungi il primo Account
          </button>
        </div>
      ) : (
        <div className="ta-table-wrap">
          <table className="ta-table" aria-label="Elenco Account">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Email</th>
                <th scope="col" className="ta-th--actions">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(account => (
                <tr key={account.id} className="ta-row">
                  <td className="ta-cell-name">
                    <Initials first={account.firstName} last={account.lastName} />
                    <span className="ta-fullname">
                      {account.firstName} {account.lastName}
                    </span>
                  </td>
                  <td className="ta-cell-email">
                    <a href={`mailto:${account.email}`} className="ta-email-link">{account.email}</a>
                  </td>
                  <td className="ta-cell-actions">
                    <button className="ta-icon-btn" type="button"
                      aria-label={`Modifica ${account.firstName} ${account.lastName}`}
                      onClick={() => openEdit(account)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
                        width="16" height="16" aria-hidden="true">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="ta-icon-btn ta-icon-btn--danger" type="button"
                      aria-label={`Elimina ${account.firstName} ${account.lastName}`}
                      onClick={() => setDelTarget(account)}>
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
          title={modal === 'add' ? 'Aggiungi Account' : 'Modifica Account'}
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
          account={delTarget}
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDelTarget(null)}
        />
      )}

    </div>
  )
}
