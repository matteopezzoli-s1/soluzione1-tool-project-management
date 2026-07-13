import { useState, useEffect, useCallback } from 'react'
import { SectionModal } from '../components/SectionModal'
import './UtentiPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'ACCOUNT' | 'PM' | 'BOARD' | 'DEVHUB'

const ROLE_META: Record<Role, { label: string; className: string }> = {
  ACCOUNT: { label: 'Account', className: 'ut-role-chip--account' },
  PM:      { label: 'PM',      className: 'ut-role-chip--pm' },
  BOARD:   { label: 'Board',   className: 'ut-role-chip--board' },
  DEVHUB:  { label: 'DevHub',  className: 'ut-role-chip--devhub' },
}
const ALL_ROLES: Role[] = ['ACCOUNT', 'PM', 'BOARD', 'DEVHUB']

interface UserItem {
  id:        string
  firstName: string | null
  lastName:  string | null
  name:      string | null
  email:     string | null
  roles:     Role[]
}

type FormData = { firstName: string; lastName: string; email: string; roles: Role[] }
const EMPTY_FORM: FormData = { firstName: '', lastName: '', email: '', roles: [] }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function displayName(u: { firstName: string | null; lastName: string | null; name: string | null; email: string | null }) {
  const fromParts = [u.firstName, u.lastName].filter(Boolean).join(' ')
  return fromParts || u.name || u.email || '—'
}

function initialsOf(u: { firstName: string | null; lastName: string | null; name: string | null; email: string | null }) {
  const source = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || u.email || '?'
  const parts = source.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ user }: { user: UserItem }) {
  return <span className="ut-avatar" aria-hidden="true">{initialsOf(user)}</span>
}

// ─── Role chips (sola visualizzazione) ───────────────────────────────────────

function RoleChips({ roles }: { roles: Role[] }) {
  if (roles.length === 0) return <span className="ut-empty-cell">Nessun ruolo</span>
  return (
    <div className="ut-role-chips">
      {roles.map(r => (
        <span key={r} className={`ut-role-chip ${ROLE_META[r].className}`}>{ROLE_META[r].label}</span>
      ))}
    </div>
  )
}

// ─── Role picker (checkbox multi-select — 4 ruoli fissi, non editabili) ──────

function RolePicker({ value, onChange }: { value: Role[]; onChange: (roles: Role[]) => void }) {
  const toggle = (role: Role) => {
    onChange(value.includes(role) ? value.filter(r => r !== role) : [...value, role])
  }
  return (
    <div className="ut-role-picker" role="group" aria-label="Ruoli">
      {ALL_ROLES.map(role => {
        const active = value.includes(role)
        const meta = ROLE_META[role]
        return (
          <button
            key={role}
            type="button"
            className={`ut-role-option ${meta.className}${active ? ' ut-role-option--active' : ''}`}
            aria-pressed={active}
            onClick={() => toggle(role)}
          >
            <span className="ut-role-option__dot" aria-hidden="true" />
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  title:            string
  form:             FormData
  loading:          boolean
  apiError:         string | null
  emailReadOnly?:   boolean
  reactivateNotice?: boolean
  onChange:  (f: FormData) => void
  onSave:    () => void
  onReactivate?: () => void
  onClose:   () => void
}

function Modal({
  title, form, loading, apiError, emailReadOnly, reactivateNotice,
  onChange, onSave, onReactivate, onClose,
}: ModalProps) {
  const set = (key: 'firstName' | 'lastName' | 'email') => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value })

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      if (reactivateNotice) onReactivate?.()
      else onSave()
    }
    if (e.key === 'Escape') onClose()
  }

  return (
    <SectionModal onClose={onClose} labelledBy="ut-modal-title">
      <div className="ut-modal" onKeyDown={handleKey}>
        <div className="ut-modal-header">
          <h2 id="ut-modal-title" className="ut-modal-title">{title}</h2>
          <button className="ut-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="ut-modal-body">
          {apiError && (
            <p className="ut-field-error ut-field-error--banner" role="alert">{apiError}</p>
          )}
          {reactivateNotice && (
            <p className="ut-field-notice ut-field-error--banner" role="alert">
              Un utente con questa email era stato eliminato in precedenza. Confermi di volerlo
              riabilitare con i dati inseriti?
            </p>
          )}

          <div className="ut-field-row">
            <div className="ut-field">
              <label htmlFor="ut-firstName" className="ut-label">Nome <span aria-hidden="true">*</span></label>
              <input id="ut-firstName" className="ut-input" type="text"
                value={form.firstName} onChange={set('firstName')}
                placeholder="es. Mario" autoFocus autoComplete="given-name" />
            </div>
            <div className="ut-field">
              <label htmlFor="ut-lastName" className="ut-label">Cognome <span aria-hidden="true">*</span></label>
              <input id="ut-lastName" className="ut-input" type="text"
                value={form.lastName} onChange={set('lastName')}
                placeholder="es. Rossi" autoComplete="family-name" />
            </div>
          </div>

          <div className="ut-field">
            <label htmlFor="ut-email" className="ut-label">Email</label>
            <input id="ut-email" className="ut-input" type="email"
              value={form.email} onChange={set('email')}
              placeholder="es. mario.rossi@azienda.it" autoComplete="email"
              readOnly={emailReadOnly} aria-readonly={emailReadOnly} />
            {emailReadOnly && (
              <span className="ut-field-hint">L'email non è modificabile dopo la creazione dell'utente.</span>
            )}
          </div>

          <div className="ut-field">
            <span className="ut-label">Ruoli</span>
            <RolePicker value={form.roles} onChange={roles => onChange({ ...form, roles })} />
            <span className="ut-field-hint">Un utente può avere più ruoli contemporaneamente.</span>
          </div>
        </div>

        <div className="ut-modal-footer">
          <button className="ut-btn ut-btn--ghost" type="button" onClick={onClose}
            disabled={loading}>
            Annulla
          </button>
          {reactivateNotice ? (
            <button className="ut-btn ut-btn--primary" type="button" onClick={onReactivate}
              disabled={loading}>
              {loading ? 'Riattivazione…' : 'Riabilita utente'}
            </button>
          ) : (
            <button className="ut-btn ut-btn--primary" type="button" onClick={onSave}
              disabled={loading}>
              {loading ? 'Salvataggio…' : 'Salva'}
            </button>
          )}
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Confirm delete dialog ────────────────────────────────────────────────────

function ConfirmDelete({ user, loading, onConfirm, onClose }: {
  user: UserItem; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="ut-confirm-title">
      <div className="ut-modal ut-modal--sm">
        <div className="ut-modal-header">
          <h2 id="ut-confirm-title" className="ut-modal-title">Elimina utente</h2>
          <button className="ut-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
              width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ut-modal-body">
          <p className="ut-confirm-text">
            Sei sicuro di voler eliminare{' '}
            <strong>{displayName(user)}</strong>?
            <br />
            <span className="ut-confirm-sub">
              Non sarà più visibile in elenco né selezionabile come PM/Account/PO/DevHub, e non
              potrà più accedere all'applicazione. I riferimenti alle attività/progetti già
              assegnati restano intatti.
            </span>
          </p>
        </div>
        <div className="ut-modal-footer">
          <button className="ut-btn ut-btn--ghost" type="button" onClick={onClose}
            disabled={loading}>Annulla</button>
          <button className="ut-btn ut-btn--danger" type="button" onClick={onConfirm}
            disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── UtentiPage ───────────────────────────────────────────────────────────────

interface UtentiPageProps { token: string }

export default function UtentiPage({ token }: UtentiPageProps) {
  const [users,    setUsers]    = useState<UserItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)

  const [modal,    setModal]    = useState<'add' | 'edit' | null>(null)
  const [editing,  setEditing]  = useState<UserItem | null>(null)
  const [form,     setForm]     = useState<FormData>(EMPTY_FORM)
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState<string | null>(null)

  const [delTarget, setDelTarget] = useState<UserItem | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  // Quando la creazione (409) trova un'email già usata da un utente eliminato
  // logicamente, mostriamo un avviso nella stessa modale e proponiamo di
  // riattivarlo invece di crearne uno nuovo.
  const [reactivateId, setReactivateId] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch(`${API_URL}/api/users`, { headers: authHeaders(token) })
      if (!res.ok) throw new Error(`Errore ${res.status}`)
      setUsers(await res.json())
    } catch {
      setApiError('Impossibile caricare l\'elenco utenti. Verifica la connessione.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    queueMicrotask(() => { fetchUsers() })
  }, [fetchUsers])

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setFormErr(null)
    setReactivateId(null)
    setModal('add')
  }

  const openEdit = (user: UserItem) => {
    setEditing(user)
    setForm({
      firstName: user.firstName ?? '',
      lastName:  user.lastName ?? '',
      email:     user.email ?? '',
      roles:     user.roles,
    })
    setFormErr(null)
    setReactivateId(null)
    setModal('edit')
  }

  const closeModal = () => {
    setModal(null)
    setReactivateId(null)
  }

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFormErr('Nome e cognome sono obbligatori.')
      return
    }
    setSaving(true)
    setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/api/users/${editing!.id}` : `${API_URL}/api/users`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: authHeaders(token),
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (modal === 'add' && res.status === 409 && (data as { code?: string }).code === 'PREVIOUSLY_DELETED') {
          setReactivateId((data as { user?: { id: string } }).user?.id ?? null)
          return
        }
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setModal(null)
      await fetchUsers()
    } catch {
      setFormErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  const handleReactivate = async () => {
    if (!reactivateId) return
    setSaving(true)
    setFormErr(null)
    try {
      const res = await fetch(`${API_URL}/api/users/${reactivateId}/riattiva`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setModal(null)
      setReactivateId(null)
      await fetchUsers()
    } catch {
      setFormErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  const openDelete = (user: UserItem) => {
    setDelTarget(user)
  }

  const handleDelete = async () => {
    if (!delTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_URL}/api/users/${delTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null)
      await fetchUsers()
    } catch {
      setDelTarget(null)
      setApiError('Errore durante l\'eliminazione.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="ut-page">

      <div className="ut-topbar">
        <div>
          <h1 className="ut-title">Anagrafica Utenti</h1>
          <p className="ut-subtitle">
            {loading ? '' : `${users.length} utent${users.length !== 1 ? 'i' : 'e'}`}
          </p>
        </div>
        <button className="ut-btn ut-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
            width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Aggiungi utente
        </button>
      </div>

      {apiError && !loading && (
        <p className="ut-page-error" role="alert">{apiError}</p>
      )}

      {loading ? (
        <div className="ut-loading" aria-label="Caricamento in corso">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="ut-skeleton" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="ut-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <circle cx="18" cy="16" r="8" stroke="#CBD5E1" strokeWidth="2" />
            <path d="M4 40c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
            <path d="M32 28l8 8m0-8l-8 8" stroke="#0D9488" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="ut-empty-text">Nessun utente ancora aggiunto.</p>
          <button className="ut-btn ut-btn--primary" type="button" onClick={openAdd}>
            Aggiungi il primo utente
          </button>
        </div>
      ) : (
        <div className="ut-table-wrap">
          <table className="ut-table" aria-label="Elenco utenti">
            <thead>
              <tr>
                <th scope="col">Utente</th>
                <th scope="col">Email</th>
                <th scope="col">Ruoli</th>
                <th scope="col" className="ut-th--actions">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="ut-row">
                  <td className="ut-cell-name">
                    <Avatar user={user} />
                    <span className="ut-fullname">{displayName(user)}</span>
                  </td>
                  <td>
                    {user.email
                      ? <a href={`mailto:${user.email}`} className="ut-email-link">{user.email}</a>
                      : <span className="ut-empty-cell">—</span>}
                  </td>
                  <td><RoleChips roles={user.roles} /></td>
                  <td className="ut-cell-actions">
                    <button className="ut-icon-btn" type="button"
                      aria-label={`Modifica ${displayName(user)}`}
                      onClick={() => openEdit(user)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75"
                        width="16" height="16" aria-hidden="true">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z"
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="ut-icon-btn ut-icon-btn--danger" type="button"
                      aria-label={`Elimina ${displayName(user)}`}
                      onClick={() => openDelete(user)}>
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
          title={modal === 'add' ? 'Aggiungi utente' : 'Modifica utente'}
          form={form}
          loading={saving}
          apiError={formErr}
          emailReadOnly={modal === 'edit'}
          reactivateNotice={!!reactivateId}
          onChange={setForm}
          onSave={handleSave}
          onReactivate={handleReactivate}
          onClose={closeModal}
        />
      )}

      {delTarget && (
        <ConfirmDelete
          user={delTarget}
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDelTarget(null)}
        />
      )}

    </div>
  )
}
