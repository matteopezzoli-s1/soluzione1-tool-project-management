import { useState, useEffect, useCallback } from 'react'
import { SectionModal } from '../components/SectionModal'
import { useDriveConfig } from '../lib/useDriveConfig'
import {
  isDrivePickerConfigured, openDrivePicker, createDriveFolder, createFolderTree,
  findFolderInDriveByName, extractDriveFolderId, driveFolderUrl,
  PRODOTTI_FOLDER_NAME, type DriveTreeNode,
} from '../lib/googleDrive'
import './ProgettiPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// Naming convention Drive (doc "Reparto Sviluppo" 1.3)
const progettoFolderName = (cliente: string, progetto: string) => `${cliente.trim()} - ${progetto.trim()}`
const prodottoFolderName = (nome: string) => `Sviluppo - ${nome.trim()}`

// ─── Types ────────────────────────────────────────────────────────────────────

type Tipo = 'CLIENTE' | 'PRODOTTO'
type StatoProgetto = string  // chiave DB, es. "ATTIVO"

interface StatoProgettoConfig {
  id: string; chiave: string; label: string
  colore: string; isArchiviato: boolean; ordine: number
}

interface ClienteRef { id: string; nome: string }
interface PoRef { id: string; firstName: string | null; lastName: string }
interface DevHubRef { id: string; firstName: string | null; lastName: string }

interface Progetto {
  id: string; nome: string; descrizione: string | null; tipo: Tipo
  stato: StatoProgetto; colore: string | null
  dataInizio: string | null; dataFine: string | null
  clienteId: string | null; cliente: ClienteRef | null
  poId: string | null; po: PoRef | null
  pmRiferimentoId: string | null; pmRiferimento: PoRef | null
  responsabileDevHubId: string | null; responsabileDevHub: DevHubRef | null
  driveFolderId: string | null; driveFolderUrl: string | null; driveAnalisiFolderId: string | null
}

interface ClienteOption { id: string; nome: string; driveFolderId: string | null }
interface PoOption { id: string; firstName: string | null; lastName: string }
interface DevHubOption { id: string; firstName: string | null; lastName: string }

type FormData = {
  nome: string; descrizione: string; stato: StatoProgetto
  clienteId: string; poId: string; pmRiferimentoId: string; responsabileDevHubId: string; colore: string
  dataInizio: string; dataFine: string
}
const emptyForm = (): FormData => ({
  nome: '', descrizione: '', stato: 'ATTIVO', clienteId: '', poId: '', pmRiferimentoId: '', responsabileDevHubId: '', colore: '#0D9488', dataInizio: '', dataFine: '',
})

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

function poName(po: PoRef | null) {
  if (!po) return null
  return [po.firstName, po.lastName].filter(Boolean).join(' ')
}

function devHubName(d: DevHubRef | null) {
  if (!d) return null
  return [d.firstName, d.lastName].filter(Boolean).join(' ')
}

const entityLabelFor = (tipo: Tipo) => (tipo === 'CLIENTE' ? 'progetto' : 'prodotto')

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

interface DriveSectionState {
  folderId: string | null
  folderUrl: string | null
  busy: boolean
  msg: { kind: 'ok' | 'err' | 'info'; text: string } | null
}

interface ModalProps {
  tipo: Tipo; title: string; form: FormData; loading: boolean; apiError: string | null
  clienti: ClienteOption[]; pos: PoOption[]; devHubs: DevHubOption[]; statiList: StatoProgettoConfig[]
  isEdit: boolean; drive: DriveSectionState; canPickDrive: boolean
  onLinkExisting: () => void; onCreateTree: () => void; onUnlinkDrive: () => void
  onChange: (f: FormData) => void; onSave: () => void; onClose: () => void
}

function Modal({ tipo, title, form, loading, apiError, clienti, pos, devHubs, statiList,
  isEdit, drive, canPickDrive, onLinkExisting, onCreateTree, onUnlinkDrive,
  onChange, onSave, onClose }: ModalProps) {
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
            <label htmlFor="pr-nome" className="pr-label">
              {tipo === 'CLIENTE' ? 'Nome progetto' : 'Nome prodotto'} <span aria-hidden="true">*</span>
            </label>
            <input id="pr-nome" className="pr-input" type="text"
              value={form.nome} onChange={set('nome')}
              placeholder={tipo === 'CLIENTE' ? 'es. Sito web e-commerce' : 'es. Praticko'} autoFocus />
          </div>

          {tipo === 'CLIENTE' ? (
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
          ) : (
            <div className="pr-field-row">
              <div className="pr-field">
                <label htmlFor="pr-po" className="pr-label">PO di riferimento</label>
                <select id="pr-po" className="pr-input pr-select"
                  value={form.poId} onChange={set('poId')}>
                  <option value="">— Nessun PO —</option>
                  {pos.map(p => <option key={p.id} value={p.id}>{[p.firstName, p.lastName].filter(Boolean).join(' ')}</option>)}
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
          )}

          {/* PM di riferimento (un solo PM): solo per i progetti CLIENTE — i
              prodotti hanno il PO. Usato per pre-compilare il PM su attività
              e presale. */}
          {tipo === 'CLIENTE' && (
            <div className="pr-field">
              <label htmlFor="pr-pmrif" className="pr-label">PM di riferimento</label>
              <select id="pr-pmrif" className="pr-input pr-select"
                value={form.pmRiferimentoId} onChange={set('pmRiferimentoId')}>
                <option value="">— Nessun PM —</option>
                {pos.map(p => <option key={p.id} value={p.id}>{[p.firstName, p.lastName].filter(Boolean).join(' ')}</option>)}
              </select>
            </div>
          )}

          {/* Responsabile DevHub: attributo del progetto indipendente dal tipo
              (CLIENTE o PRODOTTO) — le attività/attività roadmap collegate lo
              ereditano in sola lettura, non è più impostabile a livello loro. */}
          <div className="pr-field">
            <label htmlFor="pr-devhub" className="pr-label">Responsabile DevHub</label>
            <select id="pr-devhub" className="pr-input pr-select"
              value={form.responsabileDevHubId} onChange={set('responsabileDevHubId')}>
              <option value="">— Nessun responsabile —</option>
              {devHubs.map(d => <option key={d.id} value={d.id}>{[d.firstName, d.lastName].filter(Boolean).join(' ')}</option>)}
            </select>
          </div>

          {tipo === 'PRODOTTO' && (
            <div className="pr-field">
              <label htmlFor="pr-colore" className="pr-label">Colore badge</label>
              <div className="pr-color-row">
                <input id="pr-colore" className="pr-color-input" type="color"
                  value={form.colore} onChange={set('colore')} />
                <input className="pr-input pr-input--hex" type="text"
                  value={form.colore} onChange={set('colore')}
                  placeholder="#0D9488" pattern="^#[0-9a-fA-F]{3,8}$" />
              </div>
            </div>
          )}

          <div className="pr-field">
            <label htmlFor="pr-desc" className="pr-label">Descrizione</label>
            <textarea id="pr-desc" className="pr-input pr-textarea"
              value={form.descrizione} onChange={set('descrizione')}
              placeholder={tipo === 'CLIENTE' ? 'Obiettivi e note del progetto…' : 'Obiettivi e note del prodotto…'} rows={3} />
          </div>

          {tipo === 'CLIENTE' && (
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
          )}

          <div className="pr-field pr-drive">
            <span className="pr-label">Cartella Drive</span>
            {!isEdit ? (
              <p className="pr-drive-hint">
                {canPickDrive
                  ? `Alla creazione verrà generata la cartella del ${entityLabelFor(tipo)} con l'alberatura standard su Drive.`
                  : 'Collegabile dopo il salvataggio (Picker Drive non configurato).'}
              </p>
            ) : drive.folderId ? (
              <div className="pr-drive-linked">
                <a className="pr-link" href={drive.folderUrl ?? driveFolderUrl(drive.folderId)}
                  target="_blank" rel="noopener noreferrer">Apri cartella su Drive ↗</a>
                <button className="pr-btn pr-btn--ghost pr-btn--sm" type="button"
                  onClick={onUnlinkDrive} disabled={drive.busy}>Scollega</button>
              </div>
            ) : (
              <div className="pr-drive-actions">
                <button className="pr-btn pr-btn--ghost pr-btn--sm" type="button"
                  onClick={onLinkExisting} disabled={drive.busy || !canPickDrive}>
                  Collega cartella esistente
                </button>
                <button className="pr-btn pr-btn--ghost pr-btn--sm" type="button"
                  onClick={onCreateTree} disabled={drive.busy || !canPickDrive}>
                  {drive.busy ? 'Creazione…' : 'Crea cartelle'}
                </button>
                {!canPickDrive && <span className="pr-drive-hint">Picker Drive non configurato.</span>}
              </div>
            )}
            {drive.msg && <p className={`pr-drive-msg pr-drive-msg--${drive.msg.kind}`}>{drive.msg.text}</p>}
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

function ConfirmDelete({ progetto, tipo, loading, onConfirm, onClose }: {
  progetto: Progetto; tipo: Tipo; loading: boolean; onConfirm: () => void; onClose: () => void
}) {
  const label = tipo === 'CLIENTE' ? 'progetto' : 'prodotto'
  return (
    <SectionModal onClose={onClose} labelledBy="pr-del-title">
      <div className="pr-modal pr-modal--sm">
        <div className="pr-modal-header">
          <h2 id="pr-del-title" className="pr-modal-title">Elimina {label}</h2>
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

// ─── ProgettiSezione ──────────────────────────────────────────────────────────

interface ProgettiSezioneProps { token: string; tipo: Tipo }

function ProgettiSezione({ token, tipo }: ProgettiSezioneProps) {
  const [progetti,    setProgetti]    = useState<Progetto[]>([])
  const [clienti,     setClienti]     = useState<ClienteOption[]>([])
  const [pos,         setPos]         = useState<PoOption[]>([])
  const [devHubs,     setDevHubs]     = useState<DevHubOption[]>([])
  const [statiConfig, setStatiConfig] = useState<StatoProgettoConfig[]>([])
  const [loading,     setLoading]     = useState(true)
  const [apiError,    setApiError]    = useState<string | null>(null)
  const [modal,       setModal]       = useState<'add' | 'edit' | null>(null)
  const [editing,     setEditing]     = useState<Progetto | null>(null)
  const [form,        setForm]        = useState<FormData>(emptyForm())
  const [saving,      setSaving]      = useState(false)
  const [formErr,     setFormErr]     = useState<string | null>(null)
  const [delTarget,   setDelTarget]   = useState<Progetto | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [drive,       setDrive]       = useState<DriveSectionState>({ folderId: null, folderUrl: null, busy: false, msg: null })
  const [tree,        setTree]        = useState<DriveTreeNode[] | null>(null)

  const driveCfg = useDriveConfig(token)
  const canPickDrive = isDrivePickerConfigured()

  // Carica una volta il template alberatura (per la creazione delle cartelle).
  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/config/drive-tree`, { headers: authHeaders(token) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setTree((d as { tree: DriveTreeNode[] }).tree) })
      .catch(() => { /* resta null: creazione alberatura disabilitata finché non carica */ })
    return () => { cancelled = true }
  }, [token])

  // Si salva solo la root del progetto: la "Analisi dei Requisiti" viene
  // ricavata per nome dal picker, quindi driveAnalisiFolderId resta null
  // (è un override riservato ai casi speciali, es. verticali di prodotto).
  const patchDrive = useCallback(async (
    progettoId: string, folderId: string | null, folderUrl: string | null,
  ) => {
    const res = await fetch(`${API_URL}/progetti/${progettoId}/drive`, {
      method: 'PATCH', headers: authHeaders(token),
      body: JSON.stringify({ driveFolderId: folderId, driveFolderUrl: folderUrl, driveAnalisiFolderId: null }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? `Errore ${res.status}`)
    }
  }, [token])

  // Cartella genitore dove creare la cartella del progetto/prodotto, e nome
  // secondo la naming convention. null se manca l'ancora necessaria.
  // Per i PRODOTTO l'ancora "Prodotti" si ricava dal Drive Sviluppo per nome
  // (o dall'ID configurato), così basta configurare il solo Drive Sviluppo.
  const resolveParentAndName = useCallback(async (p: Progetto): Promise<{ parentId: string; name: string } | null> => {
    if (tipo === 'PRODOTTO') {
      const prodottiId = driveCfg?.prodottiId
        || (driveCfg?.devId ? await findFolderInDriveByName(driveCfg.devId, PRODOTTI_FOLDER_NAME).catch(() => null) : null)
      if (!prodottiId) return null
      return { parentId: prodottiId, name: prodottoFolderName(p.nome) }
    }
    const cliente = clienti.find(c => c.id === p.clienteId)
    if (!cliente?.driveFolderId || !cliente.nome) return null
    return { parentId: cliente.driveFolderId, name: progettoFolderName(cliente.nome, p.nome) }
  }, [tipo, driveCfg, clienti])

  const statiMap  = new Map(statiConfig.map(s => [s.chiave, s]))
  const statiList = [...statiConfig].sort((a, b) => a.ordine - b.ordine)

  const entityLabel = tipo === 'CLIENTE' ? 'progetto' : 'prodotto'
  const entityLabelPlural = tipo === 'CLIENTE' ? 'progetti' : 'prodotti'

  const fetchAll = useCallback(async () => {
    setLoading(true); setApiError(null)
    try {
      const [rP, rC, rPo, rDh, rS] = await Promise.all([
        fetch(`${API_URL}/progetti?tipo=${tipo}`, { headers: authHeaders(token) }),
        fetch(`${API_URL}/clienti`,                { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=PM`,      { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/users?role=DEVHUB`,  { headers: authHeaders(token) }),
        fetch(`${API_URL}/api/stati-progetto`,     { headers: authHeaders(token) }),
      ])
      if (!rP.ok || !rC.ok) throw new Error()
      const [p, c, po, dh, s] = await Promise.all([
        rP.json(), rC.json(), rPo.ok ? rPo.json() : Promise.resolve([]), rDh.ok ? rDh.json() : Promise.resolve([]), rS.ok ? rS.json() : Promise.resolve([]),
      ])
      setProgetti((p as Progetto[]).sort((a, b) =>
        (a.cliente?.nome ?? '').localeCompare(b.cliente?.nome ?? '', 'it') ||
        a.nome.localeCompare(b.nome, 'it')
      )); setClienti(c); setPos(po); setDevHubs(dh); setStatiConfig(s)
    } catch { setApiError(`Impossibile caricare i dati.`) }
    finally { setLoading(false) }
  }, [token, tipo])

  useEffect(() => {
    queueMicrotask(() => { fetchAll() })
  }, [fetchAll])

  const openAdd = () => {
    setForm(emptyForm()); setFormErr(null)
    setDrive({ folderId: null, folderUrl: null, busy: false, msg: null })
    setModal('add')
  }
  const openEdit = (p: Progetto) => {
    setEditing(p)
    setForm({
      nome: p.nome, descrizione: p.descrizione ?? '', stato: p.stato,
      clienteId: p.clienteId ?? '', poId: p.poId ?? '', pmRiferimentoId: p.pmRiferimentoId ?? '', responsabileDevHubId: p.responsabileDevHubId ?? '', colore: p.colore ?? '#0D9488',
      dataInizio: toInputDate(p.dataInizio), dataFine: toInputDate(p.dataFine),
    })
    setDrive({ folderId: p.driveFolderId, folderUrl: p.driveFolderUrl, busy: false, msg: null })
    setFormErr(null); setModal('edit')
  }

  // Collega una cartella progetto esistente e risolve la sottocartella
  // "Analisi dei Requisiti" al suo interno (se c'è) come radice del picker.
  const handleLinkExisting = async () => {
    if (!editing) return
    setDrive(d => ({ ...d, busy: true, msg: null }))
    try {
      const rootId = tipo === 'PRODOTTO'
        ? (driveCfg?.prodottiId || driveCfg?.devId)
        : (clienti.find(c => c.id === editing.clienteId)?.driveFolderId || driveCfg?.gestioneId || driveCfg?.devId)
      const picked = await openDrivePicker({ selectFolders: true, rootId: rootId || undefined, title: `Seleziona la cartella del ${entityLabel}` })
      if (!picked) { setDrive(d => ({ ...d, busy: false })); return }
      const folderId = extractDriveFolderId(picked.url) ?? picked.fileId
      await patchDrive(editing.id, folderId, picked.url)
      setDrive({ folderId, folderUrl: picked.url, busy: false,
        msg: { kind: 'ok', text: 'Cartella collegata.' } })
      await fetchAll()
    } catch (e) {
      setDrive(d => ({ ...d, busy: false, msg: { kind: 'err', text: e instanceof Error ? e.message : 'Errore Drive' } }))
    }
  }

  // Crea la cartella del progetto + l'alberatura del template e la collega.
  const handleCreateTree = async () => {
    if (!editing) return
    if (!tree) { setDrive(d => ({ ...d, msg: { kind: 'err', text: 'Template alberatura non ancora caricato.' } })); return }
    setDrive(d => ({ ...d, busy: true, msg: null }))
    const target = await resolveParentAndName(editing).catch(() => null)
    if (!target) {
      setDrive(d => ({ ...d, busy: false, msg: { kind: 'err', text: tipo === 'PRODOTTO'
        ? 'Cartella "Prodotti" non trovata nel Drive Sviluppo: verifica il Drive Sviluppo in Impostazioni.'
        : 'Il cliente non ha una cartella Drive collegata: collegala prima dalla pagina Clienti.' } }))
      return
    }
    try {
      const { folderId, url } = await createDriveFolder(target.name, target.parentId)
      await createFolderTree(tree, folderId)
      await patchDrive(editing.id, folderId, url)
      setDrive({ folderId, folderUrl: url, busy: false, msg: { kind: 'ok', text: 'Alberatura creata e collegata.' } })
      await fetchAll()
    } catch (e) {
      setDrive(d => ({ ...d, busy: false, msg: { kind: 'err', text: e instanceof Error ? e.message : 'Errore creazione cartelle' } }))
    }
  }

  const handleUnlinkDrive = async () => {
    if (!editing) return
    setDrive(d => ({ ...d, busy: true, msg: null }))
    try {
      await patchDrive(editing.id, null, null)
      setDrive({ folderId: null, folderUrl: null, busy: false, msg: { kind: 'info', text: 'Cartella scollegata (contenuti su Drive non toccati).' } })
      await fetchAll()
    } catch (e) {
      setDrive(d => ({ ...d, busy: false, msg: { kind: 'err', text: e instanceof Error ? e.message : 'Errore' } }))
    }
  }

  const handleSave = async () => {
    if (!form.nome.trim()) { setFormErr(`Il nome del ${entityLabel} è obbligatorio.`); return }
    setSaving(true); setFormErr(null)
    try {
      const url    = modal === 'edit' ? `${API_URL}/progetti/${editing!.id}` : `${API_URL}/progetti`
      const method = modal === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify({ ...form, tipo }) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`); return
      }
      // Nuovo progetto/prodotto: crea l'alberatura su Drive se possibile.
      // L'errore Drive non annulla la creazione — si segnala e resta
      // collegabile/creabile a mano dalla modifica.
      if (modal === 'add' && canPickDrive && tree) {
        try {
          const created = await res.json() as Progetto
          const target = await resolveParentAndName(created)
          if (!target) {
            setApiError(tipo === 'PRODOTTO'
              ? `${entityLabel} creato, ma non ho trovato la cartella "Prodotti" nel Drive Sviluppo: crea le cartelle a mano dalla modifica.`
              : `${entityLabel} creato, ma il cliente non ha una cartella Drive collegata: collegala dai Clienti e poi crea le cartelle dalla modifica.`)
          } else {
            const { folderId, url: fUrl } = await createDriveFolder(target.name, target.parentId)
            await createFolderTree(tree, folderId)
            await patchDrive(created.id, folderId, fUrl)
          }
        } catch (e) {
          setApiError(`${entityLabel} creato, ma le cartelle Drive non sono state create: ${e instanceof Error ? e.message : 'errore'}. Crealle dalla modifica.`)
        }
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
    <div className="pr-sezione">
      <div className="pr-topbar">
        <div>
          <p className="pr-subtitle">
            {loading ? '' : `${progetti.length} ${progetti.length !== 1 ? entityLabelPlural : entityLabel}`}
            {!loading && attivi > 0     && ` · ${attivi} attiv${attivi !== 1 ? 'i' : 'o'}`}
            {!loading && completati > 0 && ` · ${completati} completat${completati !== 1 ? 'i' : 'o'}`}
          </p>
        </div>
        <button className="pr-btn pr-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Aggiungi {entityLabel}
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
          <p className="pr-empty-text">Nessun {entityLabel} ancora aggiunto.</p>
          <button className="pr-btn pr-btn--primary" type="button" onClick={openAdd}>Aggiungi il primo {entityLabel}</button>
        </div>
      ) : (
        <div className="pr-table-wrap">
          <table className="pr-table" aria-label={`Elenco ${entityLabelPlural}`}>
            <thead>
              <tr>
                <th scope="col">{tipo === 'CLIENTE' ? 'Progetto' : 'Prodotto'}</th>
                <th scope="col">{tipo === 'CLIENTE' ? 'Cliente' : 'PO'}</th>
                {tipo === 'CLIENTE' && <th scope="col">PM di riferimento</th>}
                <th scope="col">Resp. DevHub</th>
                <th scope="col">Stato</th>
                <th scope="col">Drive</th>
                {tipo === 'CLIENTE' && <th scope="col">Periodo</th>}
                <th scope="col" className="pr-th--actions">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {progetti.map(p => (
                <tr key={p.id} className="pr-row">
                  <td className="pr-cell-nome">
                    <span className="pr-nome">
                      {tipo === 'PRODOTTO' && <span className="pr-color-dot" style={{ backgroundColor: p.colore ?? '#0D9488' }} aria-hidden="true" />}
                      {p.nome}
                    </span>
                    {p.descrizione && <span className="pr-desc-preview">{p.descrizione}</span>}
                  </td>
                  <td className="pr-cell-text">
                    {tipo === 'CLIENTE'
                      ? (p.cliente ? <span className="pr-cliente-tag">{p.cliente.nome}</span> : <span className="pr-empty-cell">—</span>)
                      : (p.po ? <span className="pr-po-tag">{poName(p.po)}</span> : <span className="pr-empty-cell">—</span>)}
                  </td>
                  {tipo === 'CLIENTE' && (
                    <td className="pr-cell-text">
                      {p.pmRiferimento ? <span className="pr-po-tag">{poName(p.pmRiferimento)}</span> : <span className="pr-empty-cell">—</span>}
                    </td>
                  )}
                  <td className="pr-cell-text">
                    {p.responsabileDevHub ? <span className="pr-po-tag">{devHubName(p.responsabileDevHub)}</span> : <span className="pr-empty-cell">—</span>}
                  </td>
                  <td><StatoBadge stato={p.stato} statiMap={statiMap} /></td>
                  <td className="pr-cell-text">
                    {p.driveFolderId
                      ? <a className="pr-link" href={p.driveFolderUrl ?? driveFolderUrl(p.driveFolderId)}
                          target="_blank" rel="noopener noreferrer" title="Apri cartella Drive">📁</a>
                      : <span className="pr-drive-missing" title="Cartelle Drive non collegate">⚠︎</span>}
                  </td>
                  {tipo === 'CLIENTE' && (
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
                  )}
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
          tipo={tipo}
          title={modal === 'add' ? `Aggiungi ${entityLabel}` : `Modifica ${entityLabel}`}
          form={form} loading={saving} apiError={formErr} clienti={clienti} pos={pos} devHubs={devHubs}
          statiList={statiList}
          isEdit={modal === 'edit'} drive={drive} canPickDrive={canPickDrive}
          onLinkExisting={handleLinkExisting} onCreateTree={handleCreateTree} onUnlinkDrive={handleUnlinkDrive}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {delTarget && (
        <ConfirmDelete progetto={delTarget} tipo={tipo} loading={deleting}
          onConfirm={handleDelete} onClose={() => setDelTarget(null)} />
      )}
    </div>
  )
}

// ─── ProgettiPage ─────────────────────────────────────────────────────────────

interface ProgettiPageProps { token: string }

export default function ProgettiPage({ token }: ProgettiPageProps) {
  const [tipo, setTipo] = useState<Tipo>('CLIENTE')

  return (
    <div className="pr-page">
      <div className="pr-page-topbar">
        <h1 className="pr-title">Progetti & Prodotti</h1>
      </div>

      <div className="pr-tabs" role="tablist" aria-label="Sezioni progetti">
        <button
          role="tab" type="button" aria-selected={tipo === 'CLIENTE'}
          className={`pr-tab${tipo === 'CLIENTE' ? ' pr-tab--active' : ''}`}
          onClick={() => setTipo('CLIENTE')}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16">
            <path d="M2 6a2 2 0 0 1 2-2h3.586a1 1 0 0 1 .707.293L9.707 5.7A1 1 0 0 0 10.414 6H16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Progetti
        </button>
        <button
          role="tab" type="button" aria-selected={tipo === 'PRODOTTO'}
          className={`pr-tab${tipo === 'PRODOTTO' ? ' pr-tab--active' : ''}`}
          onClick={() => setTipo('PRODOTTO')}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16">
            <rect x="3" y="3" width="6" height="6" rx="1.3" />
            <rect x="11" y="3" width="6" height="6" rx="1.3" />
            <rect x="3" y="11" width="6" height="6" rx="1.3" />
            <rect x="11" y="11" width="6" height="6" rx="1.3" />
          </svg>
          Prodotti
        </button>
      </div>

      <div role="tabpanel" aria-label={tipo === 'CLIENTE' ? 'Progetti' : 'Prodotti'}>
        <ProgettiSezione key={tipo} token={token} tipo={tipo} />
      </div>
    </div>
  )
}
