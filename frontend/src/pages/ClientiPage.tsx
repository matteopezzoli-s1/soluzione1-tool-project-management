import { useState, useEffect, useCallback } from 'react'
import { SectionModal } from '../components/SectionModal'
import './ClientiPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountRef { id: string; firstName: string; lastName: string }

interface Cliente {
  id:        string
  nome:      string
  referente: string | null
  email:     string | null
  telefono:  string | null
  note:      string | null
  accountId: string | null
  account:   AccountRef | null
  _count?:   { progetti: number }
}

interface AccountOption { id: string; firstName: string; lastName: string }

type FormData = {
  nome: string; referente: string; email: string; telefono: string; note: string; accountId: string
}
const EMPTY_FORM: FormData = { nome: '', referente: '', email: '', telefono: '', note: '', accountId: '' }

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

// ─── Initials avatar ──────────────────────────────────────────────────────────

function Initials({ nome }: { nome: string }) {
  const words = nome.trim().split(/\s+/)
  const letters = words.length >= 2
    ? `${words[0][0]}${words[1][0]}`.toUpperCase()
    : nome.slice(0, 2).toUpperCase()
  return <span className="cl-avatar" aria-hidden="true">{letters}</span>
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  title: string; form: FormData; loading: boolean; apiError: string | null
  accounts: AccountOption[]
  onChange: (f: FormData) => void; onSave: () => void; onClose: () => void
}

function Modal({ title, form, loading, apiError, accounts, onChange, onSave, onClose }: ModalProps) {
  const set = (key: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [key]: e.target.value })

  return (
    <SectionModal onClose={onClose} labelledBy="cl-modal-title">
      <div className="cl-modal">
        <div className="cl-modal-header">
          <h2 id="cl-modal-title" className="cl-modal-title">{title}</h2>
          <button className="cl-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="cl-modal-body">
          {apiError && <p className="cl-field-error cl-field-error--banner" role="alert">{apiError}</p>}
          <div className="cl-field-row">
            <div className="cl-field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="cl-nome" className="cl-label">Nome cliente <span aria-hidden="true">*</span></label>
              <input id="cl-nome" className="cl-input" type="text"
                value={form.nome} onChange={set('nome')}
                placeholder="es. Acme S.p.A." autoFocus autoComplete="organization" />
            </div>
          </div>
          <div className="cl-field-row">
            <div className="cl-field">
              <label htmlFor="cl-account" className="cl-label">Account</label>
              <select id="cl-account" className="cl-input cl-select"
                value={form.accountId} onChange={set('accountId')}>
                <option value="">— Nessun account —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
                ))}
              </select>
            </div>
            <div className="cl-field">
              <label htmlFor="cl-referente" className="cl-label">Referente</label>
              <input id="cl-referente" className="cl-input" type="text"
                value={form.referente} onChange={set('referente')}
                placeholder="es. Mario Rossi" />
            </div>
          </div>
          <div className="cl-field-row">
            <div className="cl-field">
              <label htmlFor="cl-email" className="cl-label">Email</label>
              <input id="cl-email" className="cl-input" type="email"
                value={form.email} onChange={set('email')}
                placeholder="es. info@acme.it" />
            </div>
            <div className="cl-field">
              <label htmlFor="cl-telefono" className="cl-label">Telefono</label>
              <input id="cl-telefono" className="cl-input" type="tel"
                value={form.telefono} onChange={set('telefono')}
                placeholder="es. +39 02 1234567" />
            </div>
          </div>
          <div className="cl-field">
            <label htmlFor="cl-note" className="cl-label">Note</label>
            <textarea id="cl-note" className="cl-input cl-textarea"
              value={form.note} onChange={set('note')}
              placeholder="Informazioni aggiuntive…" rows={3} />
          </div>
        </div>
        <div className="cl-modal-footer">
          <button className="cl-btn cl-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="cl-btn cl-btn--primary" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Confirm delete ───────────────────────────────────────────────────────────

function ConfirmDelete({ cliente, loading, onConfirm, onClose }: {
  cliente: Cliente; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  const n = cliente._count?.progetti ?? 0
  return (
    <SectionModal onClose={onClose} labelledBy="cl-del-title">
      <div className="cl-modal cl-modal--sm">
        <div className="cl-modal-header">
          <h2 id="cl-del-title" className="cl-modal-title">Elimina cliente</h2>
          <button className="cl-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="cl-modal-body">
          <p className="cl-confirm-text">
            Sei sicuro di voler eliminare <strong>{cliente.nome}</strong>?
            {n > 0 && <><br /><span className="cl-confirm-warn">Questo cliente ha {n} {n === 1 ? 'progetto associato' : 'progetti associati'}.</span></>}
            <br /><span className="cl-confirm-sub">Questa azione non è reversibile.</span>
          </p>
        </div>
        <div className="cl-modal-footer">
          <button className="cl-btn cl-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="cl-btn cl-btn--danger" type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── ClientiPage ──────────────────────────────────────────────────────────────

interface ClientiPageProps { token: string }

export default function ClientiPage({ token }: ClientiPageProps) {
  const [clienti,   setClienti]  = useState<Cliente[]>([])
  const [accounts,  setAccounts] = useState<AccountOption[]>([])
  const [loading,   setLoading]  = useState(true)
  const [apiError,  setApiError] = useState<string | null>(null)
  const [modal,     setModal]    = useState<'add' | 'edit' | null>(null)
  const [editing,   setEditing]  = useState<Cliente | null>(null)
  const [form,      setForm]     = useState<FormData>(EMPTY_FORM)
  const [saving,    setSaving]   = useState(false)
  const [formErr,   setFormErr]  = useState<string | null>(null)
  const [delTarget, setDelTarget] = useState<Cliente | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true); setApiError(null)
    try {
      const [rC, rA] = await Promise.all([
        fetch(`${API_URL}/clienti`,  { headers: authHeaders(token) }),
        fetch(`${API_URL}/accounts`, { headers: authHeaders(token) }),
      ])
      if (!rC.ok || !rA.ok) throw new Error()
      const [c, a] = await Promise.all([rC.json(), rA.json()])
      setClienti((c as Cliente[]).sort((a, b) => {
        const aAcc = a.account?.lastName ?? ''
        const bAcc = b.account?.lastName ?? ''
        return aAcc.localeCompare(bAcc, 'it') || a.nome.localeCompare(b.nome, 'it')
      })); setAccounts(a)
    } catch { setApiError('Impossibile caricare i dati.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchAll() }, [fetchAll])

  const openAdd = () => { setForm(EMPTY_FORM); setFormErr(null); setModal('add') }
  const openEdit = (c: Cliente) => {
    setEditing(c)
    setForm({
      nome: c.nome, referente: c.referente ?? '', email: c.email ?? '',
      telefono: c.telefono ?? '', note: c.note ?? '', accountId: c.accountId ?? '',
    })
    setFormErr(null); setModal('edit')
  }

  const handleSave = async () => {
    if (!form.nome.trim()) { setFormErr('Il nome del cliente è obbligatorio.'); return }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/clienti/${editing!.id}` : `${API_URL}/clienti`
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
      const res = await fetch(`${API_URL}/clienti/${delTarget.id}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!res.ok && res.status !== 404) throw new Error()
      setDelTarget(null); await fetchAll()
    } catch { setDelTarget(null); setApiError('Errore durante l\'eliminazione.') }
    finally { setDeleting(false) }
  }

  return (
    <div className="cl-page">
      <div className="cl-topbar">
        <div>
          <h1 className="cl-title">Anagrafica Clienti</h1>
          <p className="cl-subtitle">{loading ? '' : `${clienti.length} client${clienti.length !== 1 ? 'i' : 'e'}`}</p>
        </div>
        <button className="cl-btn cl-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Aggiungi cliente
        </button>
      </div>

      {apiError && !loading && <p className="cl-page-error" role="alert">{apiError}</p>}

      {loading ? (
        <div className="cl-loading">{Array.from({ length: 4 }, (_, i) => <div key={i} className="cl-skeleton" />)}</div>
      ) : clienti.length === 0 ? (
        <div className="cl-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <rect x="8" y="10" width="32" height="28" rx="4" stroke="#CBD5E1" strokeWidth="2" />
            <path d="M16 19h16M16 25h10" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
            <circle cx="36" cy="36" r="8" fill="#F1F5F9" stroke="#0D9488" strokeWidth="2" />
            <path d="M33 36h6M36 33v6" stroke="#0D9488" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="cl-empty-text">Nessun cliente ancora aggiunto.</p>
          <button className="cl-btn cl-btn--primary" type="button" onClick={openAdd}>Aggiungi il primo cliente</button>
        </div>
      ) : (
        <div className="cl-table-wrap">
          <table className="cl-table" aria-label="Elenco clienti">
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Account</th>
                <th scope="col">Referente</th>
                <th scope="col">Contatti</th>
                <th scope="col">Progetti</th>
                <th scope="col" className="cl-th--actions">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {clienti.map(c => (
                <tr key={c.id} className="cl-row">
                  <td className="cl-cell-name">
                    <Initials nome={c.nome} />
                    <div className="cl-cell-name-info">
                      <span className="cl-nome">{c.nome}</span>
                      {c.note && <span className="cl-note-preview">{c.note}</span>}
                    </div>
                  </td>
                  <td className="cl-cell-text">
                    {c.account
                      ? <span className="cl-account-tag">{c.account.firstName} {c.account.lastName}</span>
                      : <span className="cl-empty-cell">—</span>}
                  </td>
                  <td className="cl-cell-text">{c.referente ?? <span className="cl-empty-cell">—</span>}</td>
                  <td className="cl-cell-contacts">
                    {c.email    && <a href={`mailto:${c.email}`} className="cl-link">{c.email}</a>}
                    {c.telefono && <a href={`tel:${c.telefono}`} className="cl-link cl-link--phone">{c.telefono}</a>}
                    {!c.email && !c.telefono && <span className="cl-empty-cell">—</span>}
                  </td>
                  <td className="cl-cell-text">
                    <span className="cl-badge">{c._count?.progetti ?? 0}</span>
                  </td>
                  <td className="cl-cell-actions">
                    <button className="cl-icon-btn" type="button" aria-label={`Modifica ${c.nome}`} onClick={() => openEdit(c)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                        <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button className="cl-icon-btn cl-icon-btn--danger" type="button" aria-label={`Elimina ${c.nome}`} onClick={() => setDelTarget(c)}>
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
        <Modal title={modal === 'add' ? 'Aggiungi cliente' : 'Modifica cliente'}
          form={form} loading={saving} apiError={formErr} accounts={accounts}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {delTarget && (
        <ConfirmDelete cliente={delTarget} loading={deleting}
          onConfirm={handleDelete} onClose={() => setDelTarget(null)} />
      )}
    </div>
  )
}
