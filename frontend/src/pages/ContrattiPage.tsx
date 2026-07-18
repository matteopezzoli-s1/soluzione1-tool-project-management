import { useState, useEffect, useCallback, useMemo } from 'react'
import { SectionModal } from '../components/SectionModal'
import { DriveLinkField } from '../components/DriveLinkField'
import { useDriveConfig } from '../lib/useDriveConfig'
import './ContrattiPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoContratto = 'MANUTENZIONE' | 'MANUTENZIONE_AMS'

const TIPO_LABELS: Record<TipoContratto, string> = {
  MANUTENZIONE:     'Manutenzione',
  MANUTENZIONE_AMS: 'Manutenzione + AMS',
}

interface UserRef { id: string; firstName: string | null; lastName: string | null; name: string | null }

// Applicazione coperta = Progetto del cliente; il suo pmRiferimento è la
// fonte (sola lettura) del "PM" mostrato sul contratto.
interface ProgettoRef { id: string; nome: string; pmRiferimento: UserRef | null }

interface Contratto {
  id: string; titolo: string; tipo: TipoContratto; anno: number; stato: string
  dataInizio: string | null; dataFine: string | null
  importoTotale: number | null; fatturato: boolean
  riferimentoOrdineVendita: string | null
  // Agganciate dall'import Zoho via ordine di vendita (come le attività)
  giornateConsuntivate: number | null
  driveUrl: string | null; driveFolderId: string | null
  note: string | null
  clienteId: string; cliente: { id: string; nome: string }
  applicazioni: ProgettoRef[]
}

interface StatoContratto { id: string; chiave: string; label: string; colore: string; isChiuso: boolean; ordine: number }
interface ClienteOption { id: string; nome: string }
interface ProgettoOption { id: string; nome: string; clienteId: string | null; pmRiferimento: UserRef | null }

type FormData = {
  clienteId: string; titolo: string; tipo: TipoContratto; anno: string; stato: string
  dataInizio: string; dataFine: string
  importoTotale: string; fatturato: boolean
  riferimentoOrdineVendita: string; driveUrl: string; driveFolderId: string; note: string
  applicazioniIds: string[]
}

const ANNO_CORRENTE = new Date().getFullYear()

const EMPTY_FORM: FormData = {
  clienteId: '', titolo: '', tipo: 'MANUTENZIONE', anno: String(ANNO_CORRENTE), stato: '',
  dataInizio: '', dataFine: '',
  importoTotale: '', fatturato: false,
  riferimentoOrdineVendita: '', driveUrl: '', driveFolderId: '', note: '',
  applicazioniIds: [],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function displayUser(u: UserRef | null): string {
  if (!u) return ''
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ')
  return full || u.name || ''
}

// PM (sola lettura) di un contratto: i pmRiferimento distinti dei progetti
// coperti — uno solo se un PM li gestisce tutti.
function pmsDi(applicazioni: ProgettoRef[]): UserRef[] {
  const map = new Map<string, UserRef>()
  for (const a of applicazioni) {
    if (a.pmRiferimento) map.set(a.pmRiferimento.id, a.pmRiferimento)
  }
  return Array.from(map.values())
}

function fmtEur(n: number): string {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const MS_DAY = 86_400_000

function giorniA(iso: string): number {
  const target = new Date(iso); target.setHours(23, 59, 59, 999)
  return Math.ceil((target.getTime() - Date.now()) / MS_DAY)
}

// Scadenza rilevante di un contratto non chiuso: la data di fine, se entro
// la finestra di preavviso (60 giorni).
const PREAVVISO_GIORNI = 60

interface ScadenzaInfo { data: string; giorni: number }

function scadenzaInfo(c: Contratto, isChiuso: boolean): ScadenzaInfo | null {
  if (isChiuso || !c.dataFine) return null
  const giorni = giorniA(c.dataFine)
  return giorni <= PREAVVISO_GIORNI ? { data: c.dataFine, giorni } : null
}

function scadenzaLabel(s: ScadenzaInfo): string {
  if (s.giorni < 0) return `scaduto il ${fmtData(s.data)}`
  if (s.giorni === 0) return 'scade oggi'
  return `scade il ${fmtData(s.data)} (${s.giorni} gg)`
}

// ─── Stato chip ───────────────────────────────────────────────────────────────

function StatoChip({ stato, stati }: { stato: string; stati: StatoContratto[] }) {
  const cfg = stati.find((s) => s.chiave === stato)
  const colore = cfg?.colore ?? '#94A3B8'
  return (
    <span className="ct-stato-chip" style={{ background: `${colore}1A`, color: colore, borderColor: `${colore}55` }}>
      <span className="ct-stato-dot" style={{ background: colore }} aria-hidden="true" />
      {cfg?.label ?? stato}
    </span>
  )
}

// ─── Barra consumato vs importo totale ───────────────────────────────────────

function BudgetBar({ consumato, totale }: { consumato: number; totale: number }) {
  const pct = totale > 0 ? (consumato / totale) * 100 : 0
  const level = pct > 90 ? 'over' : pct > 70 ? 'warn' : 'ok'
  return (
    <div className="ct-budget">
      <div className="ct-budget-labels">
        <span>{fmtEur(consumato)}</span>
        <span className="ct-budget-tot">/ {fmtEur(totale)}</span>
      </div>
      <div className="ct-bar" role="img" aria-label={`Consumato ${Math.round(pct)}% dell'importo totale`}>
        <div className={`ct-bar-fill ct-bar-fill--${level}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

// ─── Modal form ───────────────────────────────────────────────────────────────

interface ModalProps {
  title: string; form: FormData; loading: boolean; apiError: string | null
  clienti: ClienteOption[]; stati: StatoContratto[]
  progetti: ProgettoOption[]
  contrattiRootId?: string
  onChange: (f: FormData) => void; onSave: () => void; onClose: () => void
}

function ContrattoModal({
  title, form, loading, apiError, clienti, stati, progetti,
  contrattiRootId, onChange, onSave, onClose,
}: ModalProps) {
  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => onChange({ ...form, [key]: value })
  const setEv = (key: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [key]: e.target.value })

  // Cambiare cliente invalida le applicazioni selezionate (sono sue)
  const setCliente = (clienteId: string) =>
    onChange({ ...form, clienteId, applicazioniIds: [] })

  const progettiCliente = progetti.filter((p) => p.clienteId === form.clienteId)
  // PM ereditati (sola lettura) dalle applicazioni selezionate
  const pmSelezionati = pmsDi(progettiCliente.filter((p) => form.applicazioniIds.includes(p.id)))

  const toggleApplicazione = (id: string) => {
    const cur = form.applicazioniIds
    set('applicazioniIds', cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }

  return (
    <SectionModal onClose={onClose} labelledBy="ct-modal-title">
      <div className="ct-modal">
        <div className="ct-modal-header">
          <h2 id="ct-modal-title" className="ct-modal-title">{title}</h2>
          <button className="ct-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ct-modal-body">
          {apiError && <p className="ct-field-error ct-field-error--banner" role="alert">{apiError}</p>}

          <div className="ct-field-row">
            <div className="ct-field">
              <label htmlFor="ct-cliente" className="ct-label">Cliente <span aria-hidden="true">*</span></label>
              <select id="ct-cliente" className="ct-input ct-select" value={form.clienteId}
                onChange={(e) => setCliente(e.target.value)} autoFocus>
                <option value="">— Seleziona cliente —</option>
                {clienti.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="ct-field">
              <label htmlFor="ct-titolo" className="ct-label">Titolo <span aria-hidden="true">*</span></label>
              <input id="ct-titolo" className="ct-input" type="text" value={form.titolo}
                onChange={setEv('titolo')} placeholder={`es. Assistenza ${form.anno || ANNO_CORRENTE}`} />
            </div>
          </div>

          <div className="ct-field-row ct-field-row--3">
            <div className="ct-field">
              <label htmlFor="ct-tipo" className="ct-label">Tipo</label>
              <select id="ct-tipo" className="ct-input ct-select" value={form.tipo}
                onChange={(e) => set('tipo', e.target.value as TipoContratto)}>
                {(Object.keys(TIPO_LABELS) as TipoContratto[]).map((t) => (
                  <option key={t} value={t}>{TIPO_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="ct-field">
              <label htmlFor="ct-anno" className="ct-label">Anno <span aria-hidden="true">*</span></label>
              <input id="ct-anno" className="ct-input" type="number" min={2000} max={2100}
                value={form.anno} onChange={setEv('anno')} />
            </div>
            <div className="ct-field">
              <label htmlFor="ct-stato" className="ct-label">Stato</label>
              <select id="ct-stato" className="ct-input ct-select" value={form.stato} onChange={setEv('stato')}>
                {stati.map((s) => <option key={s.chiave} value={s.chiave}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="ct-field-row ct-field-row--3">
            <div className="ct-field">
              <label htmlFor="ct-inizio" className="ct-label">Data inizio</label>
              <input id="ct-inizio" className="ct-input" type="date" value={form.dataInizio} onChange={setEv('dataInizio')} />
            </div>
            <div className="ct-field">
              <label htmlFor="ct-fine" className="ct-label">Data fine</label>
              <input id="ct-fine" className="ct-input" type="date" value={form.dataFine} onChange={setEv('dataFine')} />
              <span className="ct-hint">Vuota = continuativo</span>
            </div>
          </div>

          <div className="ct-field">
            <label htmlFor="ct-importo" className="ct-label">Importo totale (€)</label>
            <input id="ct-importo" className="ct-input" type="number" min={0} step="0.01"
              value={form.importoTotale} onChange={setEv('importoTotale')} placeholder="es. 12000" />
            <span className="ct-hint">Riferimento del confronto con le consuntivazioni importate.</span>
          </div>

          <label className="ct-check">
            <input type="checkbox" checked={form.fatturato}
              onChange={(e) => set('fatturato', e.target.checked)} />
            Fatturato
          </label>

          <div className="ct-field">
            <label htmlFor="ct-ordine-vendita" className="ct-label">Ordine di vendita</label>
            <input id="ct-ordine-vendita" className="ct-input" type="text" value={form.riferimentoOrdineVendita}
              onChange={setEv('riferimentoOrdineVendita')} placeholder="es. GO-ORDV-2026-49" />
            <span className="ct-hint">L'import consuntivi Zoho aggancia le ore al contratto tramite questo codice, come per le attività.</span>
          </div>

          <div className="ct-field">
            <label htmlFor="ct-drive" className="ct-label">Contratto su Drive</label>
            <DriveLinkField
              id="ct-drive"
              value={form.driveUrl}
              onChange={(url) => set('driveUrl', url)}
              onPicked={(f) => onChange({ ...form, driveUrl: f.url, driveFolderId: f.parentId ?? '' })}
              rootId={contrattiRootId || undefined}
              pickerTitle="Contratto — Contratti annuali clienti e prodotti"
              placeholder="https://drive.google.com/… o https://docs.google.com/…"
              inputClassName="ct-input"
            />
          </div>

          <div className="ct-field">
            <span className="ct-label">Applicazioni coperte</span>
            {form.clienteId === '' ? (
              <span className="ct-hint">Seleziona prima il cliente per vederne i progetti.</span>
            ) : progettiCliente.length === 0 ? (
              <span className="ct-hint">Nessun progetto per questo cliente — creali da Progetti &amp; Prodotti.</span>
            ) : (
              <div className="ct-chips" role="group" aria-label="Applicazioni coperte dal contratto">
                {progettiCliente.map((p) => {
                  const on = form.applicazioniIds.includes(p.id)
                  return (
                    <button key={p.id} type="button"
                      className={`ct-chip${on ? ' ct-chip--on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleApplicazione(p.id)}>
                      {p.nome}
                    </button>
                  )
                })}
              </div>
            )}
            {pmSelezionati.length > 0 && (
              <span className="ct-pm-line">
                PM di riferimento: <strong>{pmSelezionati.map(displayUser).join(', ')}</strong>
              </span>
            )}
          </div>

          <div className="ct-field">
            <label htmlFor="ct-note" className="ct-label">Note</label>
            <textarea id="ct-note" className="ct-input ct-textarea" value={form.note}
              onChange={setEv('note')} placeholder="Solleciti, accordi, promemoria…" rows={3} />
          </div>
        </div>
        <div className="ct-modal-footer">
          <button className="ct-btn ct-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="ct-btn ct-btn--primary" type="button" onClick={onSave} disabled={loading}>
            {loading ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Clona su altro anno ──────────────────────────────────────────────────────
// Rinnovo annuale senza riscrivere tutto: crea una copia del contratto
// sull'anno scelto (date shiftate, stato/fatturato/consuntivato/ordine reset).

function ClonaModal({ contratto, loading, error, onConfirm, onClose }: {
  contratto: Contratto; loading: boolean; error: string | null
  onConfirm: (anno: number) => void; onClose: () => void
}) {
  const [anno, setAnno] = useState(String(contratto.anno + 1))
  const annoNum = Number(anno)
  const annoValido = Number.isInteger(annoNum) && annoNum >= 2000 && annoNum <= 2100 && annoNum !== contratto.anno

  return (
    <SectionModal onClose={onClose} labelledBy="ct-clona-title">
      <div className="ct-modal ct-modal--sm">
        <div className="ct-modal-header">
          <h2 id="ct-clona-title" className="ct-modal-title">Clona contratto</h2>
          <button className="ct-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ct-modal-body">
          {error && <p className="ct-field-error ct-field-error--banner" role="alert">{error}</p>}
          <p className="ct-confirm-text">
            Crea una copia di <strong>{contratto.titolo}</strong> ({contratto.cliente.nome}, {contratto.anno}) su un altro anno di competenza.
          </p>
          <div className="ct-field ct-field--half">
            <label htmlFor="ct-clona-anno" className="ct-label">Anno di competenza</label>
            <input id="ct-clona-anno" className="ct-input" type="number" min={2000} max={2100}
              value={anno} onChange={(e) => setAnno(e.target.value)} autoFocus />
            {annoNum === contratto.anno && <span className="ct-field-error">Scegli un anno diverso da quello del contratto.</span>}
          </div>
          <p className="ct-confirm-sub">
            Le date vengono spostate sul nuovo anno; applicazioni e importo copiati.
            Stato, fatturato, consuntivato, ordine di vendita, link Drive e note ripartono da zero.
          </p>
        </div>
        <div className="ct-modal-footer">
          <button className="ct-btn ct-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="ct-btn ct-btn--primary" type="button" disabled={!annoValido || loading}
            onClick={() => onConfirm(annoNum)}>
            {loading ? 'Clonazione…' : `Clona sul ${annoValido ? annoNum : '…'}`}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Confirm delete ───────────────────────────────────────────────────────────

function ConfirmDelete({ contratto, loading, error, onConfirm, onClose }: {
  contratto: Contratto; loading: boolean; error: string | null
  onConfirm: () => void; onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="ct-del-title">
      <div className="ct-modal ct-modal--sm">
        <div className="ct-modal-header">
          <h2 id="ct-del-title" className="ct-modal-title">Elimina contratto</h2>
          <button className="ct-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ct-modal-body">
          {error && <p className="ct-field-error ct-field-error--banner" role="alert">{error}</p>}
          <p className="ct-confirm-text">
            Sei sicuro di voler eliminare <strong>{contratto.titolo}</strong> di <strong>{contratto.cliente.nome}</strong>?
            <br /><span className="ct-confirm-sub">Questa azione non è reversibile.</span>
          </p>
        </div>
        <div className="ct-modal-footer">
          <button className="ct-btn ct-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <button className="ct-btn ct-btn--danger" type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Eliminazione…' : 'Elimina'}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── ContrattiPage ────────────────────────────────────────────────────────────

interface ContrattiPageProps { token: string }

export default function ContrattiPage({ token }: ContrattiPageProps) {
  const [contratti, setContratti] = useState<Contratto[]>([])
  const [stati, setStati]         = useState<StatoContratto[]>([])
  const [clienti, setClienti]     = useState<ClienteOption[]>([])
  const [progetti, setProgetti]   = useState<ProgettoOption[]>([])
  const [costoMedio, setCostoMedio]   = useState<number | null>(null)
  const [loading, setLoading]     = useState(true)
  const [apiError, setApiError]   = useState<string | null>(null)

  const driveCfg = useDriveConfig(token)

  // Filtri
  const [fAnno, setFAnno]       = useState<number>(ANNO_CORRENTE)
  const [fStato, setFStato]     = useState('')
  const [fTipo, setFTipo]       = useState('')
  const [fCliente, setFCliente] = useState('')
  const [fPm, setFPm]           = useState('')

  // Modale / eliminazione / righe espanse
  const [modal, setModal]       = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing]   = useState<Contratto | null>(null)
  const [form, setForm]         = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [formErr, setFormErr]   = useState<string | null>(null)
  const [delTarget, setDelTarget] = useState<Contratto | null>(null)
  const [deleting, setDeleting]   = useState(false)
  const [delErr, setDelErr]       = useState<string | null>(null)
  const [cloneTarget, setCloneTarget] = useState<Contratto | null>(null)
  const [cloning, setCloning]     = useState(false)
  const [cloneErr, setCloneErr]   = useState<string | null>(null)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())

  const fetchAll = useCallback(async () => {
    setLoading(true); setApiError(null)
    try {
      const get = (path: string) => fetch(`${API_URL}${path}`, { headers: authHeaders(token) })
      const [rCon, rStati, rCli, rProg, rCfg] = await Promise.all([
        get('/api/contratti'),
        get('/api/stati-contratto'),
        get('/clienti'),
        get('/progetti?tipo=CLIENTE'),
        get('/api/config/contratti'),
      ])
      if (!rCon.ok || !rStati.ok || !rCli.ok || !rProg.ok) throw new Error()
      setContratti(await rCon.json())
      setStati(await rStati.json())
      setClienti(await rCli.json())
      setProgetti(await rProg.json())
      if (rCfg.ok) {
        const cfg = (await rCfg.json()) as { costoMedioGiornata: number | null }
        setCostoMedio(cfg.costoMedioGiornata)
      }
    } catch { setApiError('Impossibile caricare i contratti.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    queueMicrotask(() => { fetchAll() })
  }, [fetchAll])

  const statoChiuso = useCallback((chiave: string) =>
    stati.find((s) => s.chiave === chiave)?.isChiuso ?? false, [stati])

  // Consumato € del contratto: giornate consuntivate (agganciate dall'import
  // Zoho via ordine di vendita) × costo medio giornata.
  const consumatoDi = useCallback((c: Contratto): number | null => {
    if (costoMedio === null || c.giornateConsuntivate === null) return null
    return c.giornateConsuntivate * costoMedio
  }, [costoMedio])

  // ── Banner scadenze (tutti gli anni, non solo quello filtrato) ──
  const inScadenza = useMemo(() =>
    contratti
      .map((c) => ({ c, s: scadenzaInfo(c, statoChiuso(c.stato)) }))
      .filter((x): x is { c: Contratto; s: ScadenzaInfo } => x.s !== null)
      .sort((a, b) => a.s.giorni - b.s.giorni),
  [contratti, statoChiuso])

  // Opzioni del filtro PM: i pmRiferimento distinti presenti sui contratti
  const pmOptions = useMemo(() => {
    const map = new Map<string, UserRef>()
    for (const c of contratti) for (const pm of pmsDi(c.applicazioni)) map.set(pm.id, pm)
    return Array.from(map.values()).sort((a, b) => displayUser(a).localeCompare(displayUser(b), 'it'))
  }, [contratti])

  // ── Filtri + raggruppamento per cliente ──
  const filtered = useMemo(() => contratti.filter((c) =>
    c.anno === fAnno &&
    (fStato === '' || c.stato === fStato) &&
    (fTipo === '' || c.tipo === fTipo) &&
    (fCliente === '' || c.clienteId === fCliente) &&
    (fPm === '' || pmsDi(c.applicazioni).some((pm) => pm.id === fPm))
  ), [contratti, fAnno, fStato, fTipo, fCliente, fPm])

  const gruppi = useMemo(() => {
    const map = new Map<string, { nome: string; contratti: Contratto[] }>()
    for (const c of filtered) {
      if (!map.has(c.clienteId)) map.set(c.clienteId, { nome: c.cliente.nome, contratti: [] })
      map.get(c.clienteId)!.contratti.push(c)
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
  }, [filtered])

  const anniOptions = useMemo(() => {
    const anni = new Set<number>(contratti.map((c) => c.anno))
    anni.add(ANNO_CORRENTE)
    return Array.from(anni).sort((a, b) => b - a)
  }, [contratti])

  const totaleImporto = filtered.reduce((s, c) => s + (c.importoTotale ?? 0), 0)

  // ── CRUD handlers ──
  const openAdd = () => {
    setForm({ ...EMPTY_FORM, anno: String(fAnno), stato: stati[0]?.chiave ?? 'IN_DEFINIZIONE' })
    setEditing(null); setFormErr(null); setModal('add')
  }

  const openEdit = (c: Contratto) => {
    setEditing(c)
    setForm({
      clienteId: c.clienteId, titolo: c.titolo, tipo: c.tipo, anno: String(c.anno), stato: c.stato,
      dataInizio: c.dataInizio?.slice(0, 10) ?? '', dataFine: c.dataFine?.slice(0, 10) ?? '',
      importoTotale: c.importoTotale !== null ? String(c.importoTotale) : '',
      fatturato: c.fatturato,
      riferimentoOrdineVendita: c.riferimentoOrdineVendita ?? '', driveUrl: c.driveUrl ?? '',
      driveFolderId: c.driveFolderId ?? '', note: c.note ?? '',
      applicazioniIds: c.applicazioni.map((a) => a.id),
    })
    setFormErr(null); setModal('edit')
  }

  const handleSave = async () => {
    if (!form.clienteId) { setFormErr('Seleziona il cliente.'); return }
    if (!form.titolo.trim()) { setFormErr('Il titolo è obbligatorio.'); return }
    const anno = Number(form.anno)
    if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) { setFormErr('Anno non valido.'); return }
    const num = (s: string): number | null | 'err' => {
      if (s.trim() === '') return null
      const n = Number(s.replace(',', '.'))
      return Number.isFinite(n) && n >= 0 ? n : 'err'
    }
    const importoTotale = num(form.importoTotale)
    if (importoTotale === 'err') {
      setFormErr('L\'importo deve essere un numero ≥ 0.'); return
    }
    setSaving(true); setFormErr(null)
    try {
      const url = modal === 'edit' ? `${API_URL}/api/contratti/${editing!.id}` : `${API_URL}/api/contratti`
      const res = await fetch(url, {
        method: modal === 'edit' ? 'PUT' : 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          titolo: form.titolo, tipo: form.tipo, anno, stato: form.stato,
          clienteId: form.clienteId,
          dataInizio: form.dataInizio || null, dataFine: form.dataFine || null,
          importoTotale, fatturato: form.fatturato,
          riferimentoOrdineVendita: form.riferimentoOrdineVendita || null,
          driveUrl: form.driveUrl || null, driveFolderId: form.driveFolderId || null,
          note: form.note || null,
          applicazioniIds: form.applicazioniIds,
        }),
      })
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
    setDeleting(true); setDelErr(null)
    try {
      const res = await fetch(`${API_URL}/api/contratti/${delTarget.id}`, { method: 'DELETE', headers: authHeaders(token) })
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}))
        setDelErr((data as { error?: string }).error ?? `Errore ${res.status}`); return
      }
      setDelTarget(null); await fetchAll()
    } catch { setDelErr('Errore di rete. Riprova.') }
    finally { setDeleting(false) }
  }

  const handleClona = async (anno: number) => {
    if (!cloneTarget) return
    setCloning(true); setCloneErr(null)
    try {
      const res = await fetch(`${API_URL}/api/contratti/${cloneTarget.id}/clona`, {
        method: 'POST', headers: authHeaders(token), body: JSON.stringify({ anno }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setCloneErr((data as { error?: string }).error ?? `Errore ${res.status}`); return
      }
      setCloneTarget(null)
      setFAnno(anno) // porta il filtro sull'anno del clone, così si vede subito
      await fetchAll()
    } catch { setCloneErr('Errore di rete. Riprova.') }
    finally { setCloning(false) }
  }

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // ─── Render ───
  return (
    <div className="ct-page">
      <div className="ct-topbar">
        <div>
          <h1 className="ct-title">Contratti Assistenza / AMS</h1>
          <p className="ct-subtitle">
            {loading ? '' : `${filtered.length} contratt${filtered.length === 1 ? 'o' : 'i'} nel ${fAnno}${totaleImporto > 0 ? ` · ${fmtEur(totaleImporto)}` : ''}`}
          </p>
        </div>
        <button className="ct-btn ct-btn--primary" type="button" onClick={openAdd}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          Nuovo contratto
        </button>
      </div>

      {/* ── Banner scadenze ── */}
      {!loading && inScadenza.length > 0 && (
        <div className="ct-warning" role="status">
          <div className="ct-warning-head">
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <strong>{inScadenza.length} contratt{inScadenza.length === 1 ? 'o' : 'i'} da attenzionare</strong>
            <span className="ct-warning-sub">scadenza entro {PREAVVISO_GIORNI} giorni</span>
          </div>
          <ul className="ct-warning-list">
            {inScadenza.map(({ c, s }) => (
              <li key={c.id}>
                <button type="button" className={`ct-warning-item${s.giorni < 0 ? ' ct-warning-item--overdue' : ''}`}
                  onClick={() => openEdit(c)}>
                  <span className="ct-warning-cliente">{c.cliente.nome}</span>
                  <span className="ct-warning-titolo">{c.titolo}</span>
                  <span className="ct-warning-quando">{scadenzaLabel(s)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Filtri ── */}
      <div className="ct-filters">
        <select className="ct-input ct-select ct-filter" value={fAnno} aria-label="Filtra per anno"
          onChange={(e) => setFAnno(Number(e.target.value))}>
          {anniOptions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="ct-input ct-select ct-filter" value={fStato} aria-label="Filtra per stato"
          onChange={(e) => setFStato(e.target.value)}>
          <option value="">Tutti gli stati</option>
          {stati.map((s) => <option key={s.chiave} value={s.chiave}>{s.label}</option>)}
        </select>
        <select className="ct-input ct-select ct-filter" value={fTipo} aria-label="Filtra per tipo"
          onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Tutti i tipi</option>
          {(Object.keys(TIPO_LABELS) as TipoContratto[]).map((t) => (
            <option key={t} value={t}>{TIPO_LABELS[t]}</option>
          ))}
        </select>
        <select className="ct-input ct-select ct-filter" value={fCliente} aria-label="Filtra per cliente"
          onChange={(e) => setFCliente(e.target.value)}>
          <option value="">Tutti i clienti</option>
          {clienti.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="ct-input ct-select ct-filter" value={fPm} aria-label="Filtra per PM"
          onChange={(e) => setFPm(e.target.value)}>
          <option value="">Tutti i PM</option>
          {pmOptions.map((u) => <option key={u.id} value={u.id}>{displayUser(u)}</option>)}
        </select>
      </div>

      {apiError && !loading && <p className="ct-page-error" role="alert">{apiError}</p>}

      {loading ? (
        <div className="ct-loading">{Array.from({ length: 4 }, (_, i) => <div key={i} className="ct-skeleton" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="ct-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48" aria-hidden="true">
            <path d="M14 6h16l6 6v28a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" stroke="#CBD5E1" strokeWidth="2" strokeLinejoin="round" />
            <path d="M18 20h12M18 26h12M18 32h7" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="ct-empty-text">Nessun contratto per i filtri selezionati.</p>
          <button className="ct-btn ct-btn--primary" type="button" onClick={openAdd}>Aggiungi il primo contratto</button>
        </div>
      ) : (
        <div className="ct-table-wrap">
          <table className="ct-table" aria-label="Elenco contratti">
            <thead>
              <tr>
                <th scope="col" aria-label="Espandi" />
                <th scope="col">Contratto</th>
                <th scope="col">Tipo</th>
                <th scope="col">Periodo</th>
                <th scope="col">Stato</th>
                <th scope="col">PM</th>
                <th scope="col" className="ct-th--num">Importo</th>
                <th scope="col">Fatturato</th>
                <th scope="col">Consumato</th>
                <th scope="col" className="ct-th--actions">Azioni</th>
              </tr>
            </thead>
            {gruppi.map((g) => (
              <tbody key={g.nome} className="ct-group">
                <tr className="ct-group-row">
                  <td colSpan={10}>
                    <span className="ct-group-nome">{g.nome}</span>
                    <span className="ct-group-count">{g.contratti.length} contratt{g.contratti.length === 1 ? 'o' : 'i'}</span>
                  </td>
                </tr>
                {g.contratti.map((c) => {
                  const isOpen = expanded.has(c.id)
                  const scad = scadenzaInfo(c, statoChiuso(c.stato))
                  const consumato = consumatoDi(c)
                  const pms = pmsDi(c.applicazioni)
                  return (
                    <FragmentRow key={c.id}>
                      <tr className={`ct-row${scad ? ' ct-row--warn' : ''}`}>
                        <td className="ct-cell-expand">
                          <button type="button" className={`ct-expand-btn${isOpen ? ' ct-expand-btn--open' : ''}`}
                            aria-expanded={isOpen} aria-label={`Dettagli di ${c.titolo}`}
                            onClick={() => toggleExpand(c.id)}>
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" width="14" height="14" aria-hidden="true">
                              <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </td>
                        <td>
                          <div className="ct-cell-titolo">
                            <span className="ct-titolo">{c.titolo}</span>
                            {c.applicazioni.length > 0 && (
                              <span className="ct-app-count">{c.applicazioni.map((a) => a.nome).join(', ')}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`ct-tipo ct-tipo--${c.tipo === 'MANUTENZIONE_AMS' ? 'ams' : 'man'}`}>
                            {TIPO_LABELS[c.tipo]}
                          </span>
                        </td>
                        <td className="ct-cell-text">
                          {c.dataInizio ? fmtData(c.dataInizio) : '—'}
                          {' → '}
                          {c.dataFine ? fmtData(c.dataFine) : <span title="Continuativo">∞</span>}
                          {scad && (
                            <span className={`ct-scad-badge${scad.giorni < 0 ? ' ct-scad-badge--overdue' : ''}`}>
                              {scad.giorni < 0 ? 'scaduto' : `${scad.giorni} gg`}
                            </span>
                          )}
                        </td>
                        <td><StatoChip stato={c.stato} stati={stati} /></td>
                        <td className="ct-cell-text">{pms.length > 0 ? pms.map(displayUser).join(', ') : <span className="ct-empty-cell">—</span>}</td>
                        <td className="ct-cell-num">{c.importoTotale !== null ? fmtEur(c.importoTotale) : <span className="ct-empty-cell">—</span>}</td>
                        <td>
                          {c.fatturato
                            ? <span className="ct-fatt-badge ct-fatt-badge--si">Fatturato</span>
                            : <span className="ct-fatt-badge">Da fatturare</span>}
                        </td>
                        <td className="ct-cell-budget">
                          {c.importoTotale !== null && consumato !== null
                            ? <BudgetBar consumato={consumato} totale={c.importoTotale} />
                            : <span className="ct-empty-cell" title={
                                costoMedio === null
                                  ? 'Imposta il costo medio giornata in Impostazioni per vedere il consumato'
                                  : c.giornateConsuntivate === null
                                    ? 'Nessun consuntivato agganciato: verifica l’ordine di vendita e lancia l’import Zoho'
                                    : 'Compila l’importo totale per il confronto'
                              }>—</span>}
                        </td>
                        <td className="ct-cell-actions">
                          {c.driveUrl && (
                            <a className="ct-icon-btn" href={c.driveUrl} target="_blank" rel="noreferrer"
                              aria-label={`Apri contratto su Drive: ${c.titolo}`} title="Apri su Drive">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15" aria-hidden="true">
                                <path d="M8 3h8l6 10-4 7H6l-4-7L8 3z" strokeLinejoin="round" />
                                <path d="M8 3l6 10M16 3l-6 10h12M2 13h12l-4 7" strokeLinejoin="round" />
                              </svg>
                            </a>
                          )}
                          <button className="ct-icon-btn" type="button" aria-label={`Clona ${c.titolo} su un altro anno`}
                            title="Clona su un altro anno"
                            onClick={() => { setCloneErr(null); setCloneTarget(c) }}>
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                              <rect x="7" y="7" width="10" height="10" rx="1.5" strokeLinejoin="round" />
                              <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button className="ct-icon-btn" type="button" aria-label={`Modifica ${c.titolo}`} onClick={() => openEdit(c)}>
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                              <path d="M13.5 3.5a2.121 2.121 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button className="ct-icon-btn ct-icon-btn--danger" type="button" aria-label={`Elimina ${c.titolo}`}
                            onClick={() => { setDelErr(null); setDelTarget(c) }}>
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="16" height="16" aria-hidden="true">
                              <path d="M3 6h14M8 6V4h4v2M5 6l1 11h8l1-11" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="ct-detail-row">
                          <td colSpan={10}>
                            <div className="ct-detail">
                              <div className="ct-detail-grid">
                                <div>
                                  <span className="ct-detail-label">Ordine di vendita</span>
                                  <span className="ct-detail-value">{c.riferimentoOrdineVendita ?? '—'}</span>
                                </div>
                                <div>
                                  <span className="ct-detail-label">Applicazioni</span>
                                  <span className="ct-detail-value">
                                    {c.applicazioni.length > 0
                                      ? c.applicazioni.map((a) =>
                                          a.pmRiferimento ? `${a.nome} (PM ${displayUser(a.pmRiferimento)})` : a.nome
                                        ).join(', ')
                                      : '—'}
                                  </span>
                                </div>
                              </div>
                              <div>
                                <span className="ct-detail-label">Consuntivato (da import Zoho)</span>
                                <span className="ct-detail-value">
                                  {c.giornateConsuntivate !== null
                                    ? <>{c.giornateConsuntivate.toLocaleString('it-IT', { maximumFractionDigits: 2 })} gg{consumato !== null && ` · ${fmtEur(consumato)}`}</>
                                    : c.riferimentoOrdineVendita
                                      ? 'Nessun import ancora agganciato a questo ordine di vendita'
                                      : 'Compila l’ordine di vendita per agganciare le consuntivazioni'}
                                </span>
                              </div>
                              {c.note && (
                                <div>
                                  <span className="ct-detail-label">Note</span>
                                  <p className="ct-detail-note">{c.note}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {(modal === 'add' || modal === 'edit') && (
        <ContrattoModal
          title={modal === 'add' ? 'Nuovo contratto' : 'Modifica contratto'}
          form={form} loading={saving} apiError={formErr}
          clienti={clienti} stati={stati} progetti={progetti}
          contrattiRootId={driveCfg?.contrattiId || undefined}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)}
        />
      )}
      {cloneTarget && (
        <ClonaModal contratto={cloneTarget} loading={cloning} error={cloneErr}
          onConfirm={handleClona} onClose={() => setCloneTarget(null)} />
      )}
      {delTarget && (
        <ConfirmDelete contratto={delTarget} loading={deleting} error={delErr}
          onConfirm={handleDelete} onClose={() => setDelTarget(null)} />
      )}
    </div>
  )
}

// Wrapper per coppie di <tr> (riga + dettaglio espanso) dentro la mappa.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
