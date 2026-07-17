import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { SectionModal } from '../components/SectionModal'
import { DriveLinkField } from '../components/DriveLinkField'
import { useDriveConfig, type DriveConfig } from '../lib/useDriveConfig'
import {
  createDriveDoc, extractDriveFileId, getParentFolderId,
  isDrivePickerConfigured, isValidHttpUrl,
} from '../lib/googleDrive'
import './PresalePage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface PresaleItem {
  id: string
  attivita: string
  cliente: string; clienteId: string | null
  progetto: string; progettoId: string | null
  account: string; accountId: string | null
  projectManager: string; pmId: string | null
  devHub: string; devHubId: string | null
  stato: string
  giornateVendute: number | null
  note: string | null
  presaleLinkRequisiti: string | null
  presaleLinkStima: string | null
  presaleLinkOfferta: string | null
  presaleDriveFolderId: string | null
  presaleGiornateStimate: number | null
  presaleScadenzaStima: string | null
  presaleTipoIntervento: string | null
  presaleNotePerFase: Record<string, string> | null
  presaleAssegnatario: string
  presaleAssegnatarioId: string | null
  presaleEmailFasiInviate: string[]
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
interface ProgettoOption { id: string; nome: string; clienteId: string | null; pmRiferimentoId: string | null }

type FormData = {
  clienteId: string
  progettoId: string
  attivita: string
  stato: string
  pmId: string
  presaleAssegnatarioId: string
  presaleGiornateStimate: string
  presaleScadenzaStima: string
  giornateVendute: string
  presaleLinkRequisiti: string
  presaleLinkStima: string
  presaleLinkOfferta: string
  // Cartella Drive del file analisi (dal picker): radice bloccata della Stima
  presaleDriveFolderId: string
  presaleTipoIntervento: string
  presaleNotePerFase: Record<string, string>
  note: string
  inizio: string
  deadline: string
}

const EMPTY_FORM: FormData = {
  clienteId: '', progettoId: '', attivita: '', stato: '',
  pmId: '', presaleAssegnatarioId: '',
  presaleGiornateStimate: '', presaleScadenzaStima: '', giornateVendute: '',
  presaleLinkRequisiti: '', presaleLinkStima: '', presaleLinkOfferta: '', presaleDriveFolderId: '',
  presaleTipoIntervento: '', presaleNotePerFase: {}, note: '', inizio: '', deadline: '',
}

const TIPI_INTERVENTO: { value: string; label: string }[] = [
  { value: 'NUOVO_PROGETTO', label: 'Nuovo progetto' },
  { value: 'MODIFICA', label: 'Modifica ad applicativo esistente' },
]

// Stato normale in cui l'attività confermata esce dal presale (fisso).
const STATO_EFFETTIVA = 'DA_INIZIARE'

// Chiave stato → codice fase mail (mirror del backend). Serve a sapere quale
// mail compete alla fase corrente di una card (stato "inviata" e re-invio).
const STATO_TO_FASE_MAIL: Record<string, string> = {
  PRESALE_APERTURA: 'ANALISI_INIZIALE',
  PRESALE_PRESA_CARICO: 'PRESA_IN_CARICO',
  PRESALE_STIMA: 'STIMA',
  PRESALE_GIORNATE: 'TRATTATIVA_CLIENTE',
}
// true se la mail della fase corrente della card è già stata inviata.
function faseMailInviata(item: PresaleItem): boolean {
  const fase = STATO_TO_FASE_MAIL[item.stato]
  return !!fase && item.presaleEmailFasiInviate.includes(fase)
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
  | 'pmId' | 'presaleTipoIntervento' | 'presaleLinkRequisiti' | 'presaleScadenzaStima' | 'presaleAssegnatarioId'
  | 'presaleGiornateStimate' | 'presaleLinkStima' | 'presaleLinkOfferta' | 'giornateVendute'

const FASE_CAMPI: Record<string, PresaleField[]> = {
  PRESALE_APERTURA:     ['presaleTipoIntervento', 'pmId', 'presaleLinkRequisiti', 'presaleScadenzaStima'],
  PRESALE_PRESA_CARICO: ['presaleAssegnatarioId'],
  PRESALE_STIMA:        ['presaleGiornateStimate', 'presaleLinkStima'],
  PRESALE_GIORNATE:     ['giornateVendute', 'presaleLinkOfferta'],
}
const TUTTI_CAMPI: PresaleField[] = [
  'presaleTipoIntervento', 'pmId', 'presaleLinkRequisiti', 'presaleScadenzaStima', 'presaleAssegnatarioId',
  'presaleGiornateStimate', 'presaleLinkStima', 'presaleLinkOfferta', 'giornateVendute',
]

// Campi obbligatori per fase.
const REQUIRED_CAMPI: Record<string, PresaleField[]> = {
  PRESALE_APERTURA:     ['presaleTipoIntervento', 'pmId', 'presaleScadenzaStima'],
  PRESALE_PRESA_CARICO: ['presaleAssegnatarioId'],
  PRESALE_STIMA:        ['presaleGiornateStimate'],
  PRESALE_GIORNATE:     ['giornateVendute'],
}
const CAMPO_LABEL: Partial<Record<PresaleField, string>> = {
  presaleTipoIntervento: 'Tipo intervento', pmId: 'PM', presaleScadenzaStima: 'Stima desiderata entro il',
  presaleAssegnatarioId: 'Assegnatario DevHub', presaleGiornateStimate: 'Giornate stimate', giornateVendute: 'Giornate vendute',
}
function isObbligatorio(f: PresaleField): boolean {
  return Object.values(REQUIRED_CAMPI).some(list => list.includes(f))
}
function campiMancantiForm(form: FormData): PresaleField[] {
  return (REQUIRED_CAMPI[form.stato] ?? []).filter(f =>
    f === 'pmId' ? form.pmId === '' : (form[f] ?? '').toString().trim() === '')
}
// Fase completa a partire dai dati dell'item (per il gating dell'avanzamento).
function faseItemCompleta(item: PresaleItem, stato: string): boolean {
  return (REQUIRED_CAMPI[stato] ?? []).every(f => {
    switch (f) {
      case 'pmId': return !!item.pmId
      case 'presaleTipoIntervento': return !!item.presaleTipoIntervento
      case 'presaleScadenzaStima': return !!item.presaleScadenzaStima
      case 'presaleAssegnatarioId': return !!item.presaleAssegnatarioId
      case 'presaleGiornateStimate': return item.presaleGiornateStimate != null
      case 'giornateVendute': return item.giornateVendute != null
      default: return true
    }
  })
}

// ─── PM chips (multi-select) ────────────────────────────────────────────────

// Link documento nel drawer: anchor se URL valido, altrimenti avviso "link
// non valido" (i tre campi presale erano testo libero prima della validazione)
function PresaleLink({ url }: { url: string }) {
  return isValidHttpUrl(url)
    ? <a href={url} target="_blank" rel="noreferrer" className="ps-link">Apri su Drive ↗</a>
    : <span className="ps-link-invalid" title={`Valore attuale: "${url}"`}>link non valido — correggilo dalla modifica</span>
}

function PmChips({ pms, value, onChange }: {
  pms: UserRef[]; value: string | null; onChange: (id: string | null) => void
}) {
  if (pms.length === 0) return <span className="ps-field-hint">Nessun PM disponibile</span>
  // Un solo PM per attività: click = selezione singola (radio-like).
  const toggle = (id: string) =>
    onChange(value === id ? null : id)
  return (
    <div className="ps-chip-row">
      {pms.map(p => {
        const on = value === p.id
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
  mode, form, statiPresale, clienti, progetti, pms, devHubs, suggestedDevHub,
  loading, apiError, mailGiaInviata, driveCfg, onChange, onSave, onClose,
}: {
  mode: 'add' | 'edit'
  form: FormData
  statiPresale: StatoConfig[]
  clienti: ClienteOption[]
  progetti: ProgettoOption[]
  pms: UserRef[]
  devHubs: UserRef[]
  suggestedDevHub: { id: string; nome: string } | null
  loading: boolean
  apiError: string | null
  mailGiaInviata: boolean
  driveCfg: DriveConfig | null
  onChange: (f: FormData) => void
  onSave: (inviaMail: boolean) => void
  onClose: () => void
}) {
  // Bottone "Crea nuovo doc" (fase Stima): crea il Google Doc dell'analisi di
  // dettaglio nella cartella dell'analisi iniziale e compila il campo link.
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [createDocErr, setCreateDocErr] = useState<string | null>(null)

  // Cartella dell'analisi iniziale: quella memorizzata dal picker, oppure
  // risolta via Drive API dal link (anche incollato a mano). null = ignota.
  const resolveAnalisiFolder = async (): Promise<string | null> => {
    if (form.presaleDriveFolderId) return form.presaleDriveFolderId
    const fileId = extractDriveFileId(form.presaleLinkRequisiti)
    if (!fileId) return null
    return getParentFolderId(fileId)
  }

  const handleCreateStimaDoc = async () => {
    setCreatingDoc(true); setCreateDocErr(null)
    try {
      const folderId = await resolveAnalisiFolder()
      if (!folderId) {
        setCreateDocErr('Cartella dell\'analisi iniziale non determinabile: compila prima il link dell\'analisi requisiti.')
        return
      }
      const nome = `${form.attivita.trim() || 'Analisi'} — Analisi di dettaglio`
      const doc = await createDriveDoc(nome, folderId)
      onChange({ ...form, presaleLinkStima: doc.url, presaleDriveFolderId: folderId })
      window.open(doc.url, '_blank', 'noopener')
    } catch (e) {
      setCreateDocErr(e instanceof Error ? e.message : 'Errore nella creazione del documento.')
    } finally {
      setCreatingDoc(false)
    }
  }

  const progettiFiltrati = useMemo(
    () => progetti.filter(p => !form.clienteId || p.clienteId === form.clienteId),
    [progetti, form.clienteId],
  )
  const currentIdx = statiPresale.findIndex(s => s.chiave === form.stato)
  const currentCfg = statiPresale[currentIdx]
  const accent = currentCfg?.colore ?? '#7C3AED'
  const fasiPrecedenti = currentIdx > 0 ? statiPresale.slice(0, currentIdx) : []

  // Nota (per-fase) di una singola fase.
  const renderNota = (chiave: string) => (
    <div className="ps-field">
      <label className="ps-label">Note</label>
      <textarea
        className="ps-input ps-textarea"
        rows={2}
        value={form.presaleNotePerFase[chiave] ?? ''}
        placeholder="Note di questa fase (indipendenti dalle altre)…"
        onChange={e => onChange({ ...form, presaleNotePerFase: { ...form.presaleNotePerFase, [chiave]: e.target.value } })}
      />
    </div>
  )

  // Rende un singolo campo (usato sia per la fase corrente sia, negli accordion,
  // per le fasi precedenti — i campi sono univoci per fase).
  const req = (f: PresaleField) => isObbligatorio(f) ? <span aria-hidden="true"> *</span> : null
  const renderCampo = (f: PresaleField) => {
    switch (f) {
      case 'presaleTipoIntervento': return (
        <div key={f} className="ps-field">
          <span className="ps-label">Tipo intervento{req(f)}</span>
          <div className="ps-chip-row">
            {TIPI_INTERVENTO.map(t => {
              const on = form.presaleTipoIntervento === t.value
              return (
                <button key={t.value} type="button" className={`ps-chip${on ? ' ps-chip--on' : ''}`}
                  onClick={() => onChange({ ...form, presaleTipoIntervento: on ? '' : t.value })} aria-pressed={on}>
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
      )
      case 'pmId': return (
        <div key={f} className="ps-field">
          <span className="ps-label">PM{req(f)}</span>
          <PmChips pms={pms} value={form.pmId || null} onChange={id => onChange({ ...form, pmId: id ?? '' })} />
        </div>
      )
      case 'presaleLinkRequisiti': return (
        <div key={f} className="ps-field">
          <label className="ps-label" htmlFor="ps-req">Link Drive — analisi requisiti</label>
          <DriveLinkField
            id="ps-req"
            inputClassName="ps-input"
            value={form.presaleLinkRequisiti}
            rootId={driveCfg?.devId || undefined}
            pickerTitle="Scegli il documento di analisi (Drive Sviluppo)"
            // Digitazione manuale: la cartella memorizzata non è più affidabile
            onChange={url => onChange({ ...form, presaleLinkRequisiti: url, presaleDriveFolderId: '' })}
            // Scelta via picker: memorizzo anche la cartella (radice della Stima)
            onPicked={file => onChange({
              ...form,
              presaleLinkRequisiti: file.url,
              presaleDriveFolderId: file.parentId ?? '',
            })}
          />
        </div>
      )
      case 'presaleScadenzaStima': return (
        <div key={f} className="ps-field">
          <label className="ps-label" htmlFor="ps-scad-stima">Stima desiderata entro il{req(f)}</label>
          <input id="ps-scad-stima" className="ps-input" type="date" value={form.presaleScadenzaStima}
            onChange={e => onChange({ ...form, presaleScadenzaStima: e.target.value })} />
        </div>
      )
      case 'presaleAssegnatarioId': return (
        <div key={f} className="ps-field">
          <label className="ps-label" htmlFor="ps-assegnatario">Assegnatario DevHub{req(f)}</label>
          <select id="ps-assegnatario" className="ps-input ps-select" value={form.presaleAssegnatarioId}
            onChange={e => onChange({ ...form, presaleAssegnatarioId: e.target.value })}>
            <option value="">— Nessuno —</option>
            {devHubs.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
          </select>
          {suggestedDevHub && form.presaleAssegnatarioId !== suggestedDevHub.id && (
            <p className="ps-suggest">
              Responsabile DevHub del progetto: <strong>{suggestedDevHub.nome}</strong>
              <button type="button" className="ps-suggest-btn"
                onClick={() => onChange({ ...form, presaleAssegnatarioId: suggestedDevHub.id })}>Usa</button>
            </p>
          )}
        </div>
      )
      case 'presaleGiornateStimate': return (
        <div key={f} className="ps-field">
          <label className="ps-label" htmlFor="ps-stimate">Giornate stimate{req(f)}</label>
          <div className="ps-input-suffix">
            <input id="ps-stimate" className="ps-input" type="number" min="0" step="0.5" value={form.presaleGiornateStimate}
              onChange={e => onChange({ ...form, presaleGiornateStimate: e.target.value })} />
            <span className="ps-suffix">gg</span>
          </div>
        </div>
      )
      case 'presaleLinkStima': return (
        <div key={f} className="ps-field">
          <label className="ps-label" htmlFor="ps-stima">Link Drive — analisi dettaglio (opzionale)</label>
          <DriveLinkField
            id="ps-stima"
            inputClassName="ps-input"
            value={form.presaleLinkStima}
            rootId={form.presaleDriveFolderId || driveCfg?.devId || undefined}
            locked={!!form.presaleDriveFolderId}
            // Al click risolve la cartella dell'analisi iniziale (memorizzata
            // dal picker o ricavata via Drive API da un link incollato a
            // mano) e ci blocca dentro il picker; senza cartella → radice
            // del Drive Sviluppo.
            resolveRoot={async () => {
              const folderId = await resolveAnalisiFolder().catch(() => null)
              return folderId ? { rootId: folderId, locked: true } : null
            }}
            pickerTitle="Scegli l'analisi di dettaglio (cartella dell'analisi iniziale)"
            onChange={url => onChange({ ...form, presaleLinkStima: url })}
          />
          {isDrivePickerConfigured() && (
            <div className="ps-create-doc">
              <button
                className="ps-create-doc-btn"
                type="button"
                onClick={handleCreateStimaDoc}
                disabled={creatingDoc}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="13" height="13" aria-hidden="true">
                  <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                </svg>
                {creatingDoc ? 'Creazione…' : 'Crea nuovo doc nella cartella dell\'analisi'}
              </button>
              {createDocErr && <span className="ps-create-doc-err" role="alert">{createDocErr}</span>}
            </div>
          )}
        </div>
      )
      case 'giornateVendute': return (
        <div key={f} className="ps-field">
          <label className="ps-label" htmlFor="ps-vendute">Giornate vendute{req(f)}</label>
          <div className="ps-input-suffix">
            <input id="ps-vendute" className="ps-input" type="number" min="0" step="0.5" value={form.giornateVendute}
              onChange={e => onChange({ ...form, giornateVendute: e.target.value })} />
            <span className="ps-suffix">gg</span>
          </div>
        </div>
      )
      case 'presaleLinkOfferta': return (
        <div key={f} className="ps-field">
          <label className="ps-label" htmlFor="ps-offerta">Link Drive — documento di offerta (opzionale)</label>
          <DriveLinkField
            id="ps-offerta"
            inputClassName="ps-input"
            value={form.presaleLinkOfferta}
            rootId={driveCfg?.commId || undefined}
            pickerTitle="Scegli il documento di offerta (Drive Commerciale)"
            onChange={url => onChange({ ...form, presaleLinkOfferta: url })}
          />
        </div>
      )
      default: return null
    }
  }
  const campiFase = (chiave: string) => FASE_CAMPI[chiave] ?? TUTTI_CAMPI

  return (
    <SectionModal onClose={onClose} labelledBy="ps-modal-title">
      <div className="ps-modal ps-modal--form" style={{ ['--ps-accent' as string]: accent }}>
        <div className="ps-modal-head">
          <div className="ps-modal-head-txt">
            <span className="ps-eyebrow" style={{ color: accent }}>
              {mode === 'add' ? 'Nuova attività presale' : 'Attività presale'}
            </span>
            <h2 id="ps-modal-title" className="ps-modal-title">
              {mode === 'add' ? 'Apri la segnalazione' : (form.attivita || 'Modifica attività')}
            </h2>
          </div>
          <button className="ps-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Stepper della pipeline — solo indicatore (non cliccabile): il cambio
            fase avviene dal board (drag o bottone "Passa a…"), non da qui.
            In creazione mostro solo la prima fase. */}
        <div className="ps-stepper" role="group" aria-label="Fase della trattativa">
          {(mode === 'add' ? statiPresale.slice(0, 1) : statiPresale).map((s, i) => {
            const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
            return (
              <span
                key={s.chiave}
                className={`ps-step ps-step--${state} ps-step--static`}
                style={{ ['--ps-step-c' as string]: s.colore }}
                aria-current={state === 'current' ? 'step' : undefined}
                title={s.label}
              >
                <span className="ps-step-n">{state === 'done' ? '✓' : i + 1}</span>
                <span className="ps-step-t">{s.label}</span>
              </span>
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
                  onChange={e => {
                    // Pre-seleziona il PM di riferimento del progetto, se definito.
                    const pmRif = progetti.find(p => p.id === e.target.value)?.pmRiferimentoId
                    onChange({ ...form, progettoId: e.target.value, pmId: pmRif ?? form.pmId })
                  }}
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

            {campiFase(form.stato).length === 0 && (
              <p className="ps-section-hint">Nessun campo da compilare in questa fase.</p>
            )}
            {campiFase(form.stato).map(renderCampo)}
            {renderNota(form.stato)}
          </section>

          {/* Fasi precedenti: accordion compatti (chiusi), campi modificabili. */}
          {mode === 'edit' && fasiPrecedenti.length > 0 && (
            <section className="ps-section">
              <p className="ps-section-title">Fasi precedenti</p>
              {fasiPrecedenti.map(ph => (
                <details key={ph.chiave} className="ps-accordion">
                  <summary className="ps-accordion-sum">
                    <span className="ps-acc-dot" style={{ background: ph.colore }} />
                    <span className="ps-acc-label">{ph.label}</span>
                    <svg className="ps-acc-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                      strokeWidth="2" width="14" height="14" aria-hidden="true">
                      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <div className="ps-accordion-body">
                    {campiFase(ph.chiave).map(renderCampo)}
                    {renderNota(ph.chiave)}
                  </div>
                </details>
              ))}
            </section>
          )}
        </div>

        <div className="ps-modal-footer ps-modal-footer--split">
          <button className="ps-btn ps-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <div className="ps-footer-actions">
            <button className="ps-btn ps-btn--ghost" type="button" onClick={() => onSave(false)} disabled={loading}>
              {loading ? 'Salvataggio…' : 'Salva'}
            </button>
            <button className="ps-btn ps-btn--accent" type="button" onClick={() => onSave(true)} disabled={loading}
              title="Salva e invia subito la mail di questa fase via SAIOT">
              {loading ? 'Salvataggio…' : (mailGiaInviata ? 'Salva e re-invia mail' : 'Salva e invia mail')}
            </button>
          </div>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Conferma & rendi effettiva ─────────────────────────────────────────────

function ConfirmEffettiva({ item, statoEffettivaLabel, esisteStato, loading, onConfirm, onClose }: {
  item: PresaleItem
  statoEffettivaLabel: string
  esisteStato: boolean
  loading: boolean
  onConfirm: (inviaMail: boolean) => void
  onClose: () => void
}) {
  return (
    <SectionModal onClose={onClose} labelledBy="ps-eff-title">
      <div className="ps-modal ps-modal--sm">
        <div className="ps-modal-header">
          <h2 id="ps-eff-title" className="ps-modal-title">Conferma e avvia</h2>
          <button className="ps-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ps-modal-body">
          <p className="ps-confirm-text">
            L'attività <strong>{item.attivita}</strong> viene confermata: passa allo stato{' '}
            <strong>{statoEffettivaLabel}</strong> e <strong>esce dal presale</strong>, proseguendo come
            attività normale.
          </p>
          {!esisteStato && (
            <p className="ps-error-banner" role="alert">
              Lo stato «{statoEffettivaLabel}» non esiste tra gli stati attività. Crealo in
              Impostazioni → Stati Attività prima di confermare.
            </p>
          )}
        </div>
        <div className="ps-modal-footer ps-modal-footer--split">
          <button className="ps-btn ps-btn--ghost" type="button" onClick={onClose} disabled={loading}>Annulla</button>
          <div className="ps-footer-actions">
            <button className="ps-btn ps-btn--ghost" type="button" onClick={() => onConfirm(false)} disabled={loading || !esisteStato}>
              {loading ? 'Conferma…' : 'Conferma e avvia'}
            </button>
            <button className="ps-btn ps-btn--primary" type="button" onClick={() => onConfirm(true)} disabled={loading || !esisteStato}
              title="Conferma, avvia e invia la mail di progetto confermato">
              {loading ? 'Conferma…' : 'Conferma e invia mail'}
            </button>
          </div>
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

function DetailDrawer({ item, token, statoCfg, statoByChiave, mailSent, mailSending, onClose, onEdit, onConfirm, onDelete, onSendMail }: {
  item: PresaleItem
  token: string
  statoCfg: StatoConfig | undefined
  statoByChiave: Map<string, StatoConfig>
  mailSent: boolean
  mailSending: boolean
  onClose: () => void
  onEdit: () => void
  onConfirm: () => void
  onDelete: () => void
  onSendMail: () => void
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

          <div className="ps-mail-row">
            <span className={`ps-mail-badge ${mailSent ? 'is-sent' : 'is-unsent'}`}>
              {mailSent ? '✉ Mail di fase inviata' : '✉ Mail di fase non inviata'}
            </span>
            <button className="ps-btn ps-btn--ghost ps-btn--sm" type="button" onClick={onSendMail} disabled={mailSending}>
              {mailSending ? 'Invio…' : (mailSent ? 'Re-invia mail' : 'Invia mail')}
            </button>
          </div>

          {/* Solo i dati effettivamente compilati finora — le fasi non ancora
              raggiunte non mostrano righe vuote. */}
          <dl className="ps-dl">
            <div className="ps-dl-row"><dt>Cliente</dt><dd>{item.cliente}</dd></div>
            <div className="ps-dl-row"><dt>Progetto</dt><dd>{item.progetto}</dd></div>
            {item.presaleTipoIntervento && (
              <div className="ps-dl-row">
                <dt>Tipo intervento</dt>
                <dd>{TIPI_INTERVENTO.find(t => t.value === item.presaleTipoIntervento)?.label ?? item.presaleTipoIntervento}</dd>
              </div>
            )}
            {item.account && <div className="ps-dl-row"><dt>Account</dt><dd>{item.account}</dd></div>}
            {item.projectManager && <div className="ps-dl-row"><dt>PM</dt><dd>{item.projectManager}</dd></div>}
            {item.presaleAssegnatario && <div className="ps-dl-row"><dt>Assegnatario DevHub</dt><dd>{item.presaleAssegnatario}</dd></div>}
            {item.presaleScadenzaStima && <div className="ps-dl-row"><dt>Stima desiderata entro</dt><dd>{fmtDate(item.presaleScadenzaStima)}</dd></div>}
            {item.presaleGiornateStimate !== null && <div className="ps-dl-row"><dt>Giornate stimate</dt><dd>{fmtNum(item.presaleGiornateStimate)}</dd></div>}
            {item.giornateVendute !== null && <div className="ps-dl-row"><dt>Giornate vendute</dt><dd>{fmtNum(item.giornateVendute)}</dd></div>}
            {item.presaleLinkRequisiti && (
              <div className="ps-dl-row">
                <dt>Analisi requisiti</dt>
                <dd><PresaleLink url={item.presaleLinkRequisiti} /></dd>
              </div>
            )}
            {item.presaleLinkStima && (
              <div className="ps-dl-row">
                <dt>Analisi dettaglio</dt>
                <dd><PresaleLink url={item.presaleLinkStima} /></dd>
              </div>
            )}
            {item.presaleLinkOfferta && (
              <div className="ps-dl-row">
                <dt>Documento di offerta</dt>
                <dd><PresaleLink url={item.presaleLinkOfferta} /></dd>
              </div>
            )}
            {item.presaleNotePerFase && Object.entries(item.presaleNotePerFase)
              .filter(([, v]) => v && v.trim())
              .sort(([a], [b]) => (statoByChiave.get(a)?.ordine ?? 99) - (statoByChiave.get(b)?.ordine ?? 99))
              .map(([chiave, testo]) => (
                <div key={chiave} className="ps-dl-row">
                  <dt>Note · {statoByChiave.get(chiave)?.label ?? chiave}</dt>
                  <dd className="ps-dl-note">{testo}</dd>
                </div>
              ))}
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
            <button className="ps-btn ps-btn--primary" type="button" onClick={onConfirm}>Conferma e avvia</button>
          </div>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function PresaleCard({ item, accent, nextLabel, isLast, mailSent, mailSending, onDragStart, onOpen, onAdvance, onConfirm, onSendMail }: {
  item: PresaleItem
  accent: string
  nextLabel?: string
  isLast?: boolean
  mailSent: boolean
  mailSending: boolean
  onDragStart: (id: string) => void
  onOpen: (item: PresaleItem) => void
  onAdvance?: () => void
  onConfirm?: () => void
  onSendMail: () => void
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
        {item.presaleTipoIntervento && (
          <span className="ps-tag ps-tag--tipo">
            {item.presaleTipoIntervento === 'NUOVO_PROGETTO' ? 'Nuovo progetto' : 'Modifica'}
          </span>
        )}
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
      <div className="ps-card-mail" onClick={e => e.stopPropagation()}>
        <span className={`ps-mail-badge ${mailSent ? 'is-sent' : 'is-unsent'}`}>
          {mailSent ? '✉ Mail inviata' : '✉ Mail non inviata'}
        </span>
        <button
          type="button"
          className="ps-mail-btn"
          onClick={e => { e.stopPropagation(); onSendMail() }}
          disabled={mailSending}
          title={mailSent ? 'Re-invia la mail di questa fase' : 'Invia la mail di questa fase'}
        >
          {mailSending ? 'Invio…' : (mailSent ? 'Re-invia' : 'Invia')}
        </button>
      </div>
      {onAdvance && nextLabel && (
        <button
          type="button"
          className="ps-card-advance"
          style={{ ['--ps-card-c' as string]: accent }}
          onClick={e => { e.stopPropagation(); onAdvance() }}
          title={`Passa a: ${nextLabel}`}
        >
          Passa a {nextLabel} →
        </button>
      )}
      {isLast && onConfirm && (
        <button
          type="button"
          className="ps-card-advance ps-card-confirm"
          onClick={e => { e.stopPropagation(); onConfirm() }}
          title="Conferma e avvia (esce dal presale)"
        >
          ✓ Conferma e avvia
        </button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PresalePage({ token }: { token: string }) {
  const driveCfg = useDriveConfig(token)
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
  // Responsabile DevHub del progetto (se definito): suggerito come assegnatario
  const [suggestedDevHub, setSuggestedDevHub] = useState<{ id: string; nome: string } | null>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [selected, setSelected] = useState<PresaleItem | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<PresaleItem | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [delTarget, setDelTarget] = useState<PresaleItem | null>(null)
  const [sendingMailId, setSendingMailId] = useState<string | null>(null)

  const dragIdRef = useRef<string | null>(null)

  const statiPresale = useMemo(
    () => stati.filter(s => s.isPresale).sort((a, b) => a.ordine - b.ordine),
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
      setProgetti((p as any[]).map((pr: any) => ({ id: pr.id, nome: pr.nome, clienteId: pr.clienteId ?? null, pmRiferimentoId: pr.pmRiferimento?.id ?? pr.pmRiferimentoId ?? null })))
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

  // ── Cambio fase (drop su colonna o bottone "avanza" sulla card) ──
  // Sposta la card nella fase (solo in UI) e apre il modal su quella fase: il
  // nuovo stato viene persistito SOLO al "Salva" (la PUT include lo stato).
  // Annulla/chiusura del modal ripristinano la card nella fase di partenza.
  const phaseRevertRef = useRef<{ id: string; stato: string } | null>(null)

  const changePhaseAndOpen = (item: PresaleItem, statoChiave: string) => {
    // Avanzando (fase successiva) i campi obbligatori della fase corrente devono
    // essere compilati. Tornare indietro è sempre consentito.
    const fromIdx = statiPresale.findIndex(s => s.chiave === item.stato)
    const toIdx = statiPresale.findIndex(s => s.chiave === statoChiave)
    if (toIdx > fromIdx && !faseItemCompleta(item, item.stato)) {
      setApiError(`Completa i campi obbligatori di "${statiPresale[fromIdx]?.label ?? 'questa fase'}" prima di avanzare.`)
      return
    }
    setApiError(null)
    const moved = { ...item, stato: statoChiave }
    if (item.stato !== statoChiave) {
      phaseRevertRef.current = { id: item.id, stato: item.stato }
      setItems(prev => prev.map(i => i.id === item.id ? moved : i))
    }
    openEdit(moved)
  }

  // Chiusura del modal senza salvare: se il modal era stato aperto da un
  // cambio fase, la card torna nella fase di partenza (niente era persistito).
  const closeModalWithRevert = () => {
    const rev = phaseRevertRef.current
    if (rev) {
      setItems(prev => prev.map(i => i.id === rev.id ? { ...i, stato: rev.stato } : i))
      phaseRevertRef.current = null
    }
    setModal(null)
  }

  const onCardDrop = (statoChiave: string) => {
    const draggedId = dragIdRef.current
    dragIdRef.current = null
    if (!draggedId) return
    const item = items.find(i => i.id === draggedId)
    if (!item || item.stato === statoChiave) return
    // Le fasi sono sequenziali: si può spostare solo alla fase adiacente
    // (una avanti o una indietro), niente salti.
    const fromIdx = statiPresale.findIndex(s => s.chiave === item.stato)
    const toIdx = statiPresale.findIndex(s => s.chiave === statoChiave)
    if (fromIdx === -1 || toIdx === -1 || Math.abs(toIdx - fromIdx) !== 1) {
      setApiError('Le fasi sono sequenziali: puoi spostare l’attività solo alla fase precedente o successiva.')
      return
    }
    changePhaseAndOpen(item, statoChiave)
  }

  // Conferma consentita solo se i campi obbligatori della fase corrente ci sono.
  const tryConfirm = (item: PresaleItem | null) => {
    if (!item) return
    if (!faseItemCompleta(item, item.stato)) {
      setApiError('Completa i campi obbligatori della fase prima di confermare.')
      return
    }
    setApiError(null)
    setConfirmTarget(item)
  }

  // ── CRUD ──
  const openAdd = () => {
    phaseRevertRef.current = null
    setForm({ ...EMPTY_FORM, stato: statiPresale[0]?.chiave ?? '' })
    setFormErr(null)
    setEditingId(null)
    setSuggestedDevHub(null)
    setModal('add')
  }

  const openEdit = (item: PresaleItem) => {
    setEditingId(item.id)
    setSuggestedDevHub(item.devHubId ? { id: item.devHubId, nome: item.devHub } : null)
    setForm({
      clienteId: item.clienteId ?? '',
      progettoId: item.progettoId ?? '',
      attivita: item.attivita,
      stato: item.stato,
      pmId: item.pmId ?? '',
      presaleAssegnatarioId: item.presaleAssegnatarioId ?? '',
      presaleGiornateStimate: item.presaleGiornateStimate !== null ? String(item.presaleGiornateStimate) : '',
      presaleScadenzaStima: item.presaleScadenzaStima ?? '',
      giornateVendute: item.giornateVendute !== null ? String(item.giornateVendute) : '',
      presaleLinkRequisiti: item.presaleLinkRequisiti ?? '',
      presaleLinkStima: item.presaleLinkStima ?? '',
      presaleLinkOfferta: item.presaleLinkOfferta ?? '',
      presaleDriveFolderId: item.presaleDriveFolderId ?? '',
      presaleTipoIntervento: item.presaleTipoIntervento ?? '',
      presaleNotePerFase: item.presaleNotePerFase ?? {},
      note: item.note ?? '',
      inizio: item.inizio ?? '',
      deadline: item.deadline ?? '',
    })
    setFormErr(null)
    setSelected(null)
    setModal('edit')
  }

  const handleSave = async (inviaMail: boolean) => {
    if (!form.clienteId || !form.progettoId || !form.attivita.trim()) {
      setFormErr('Cliente, progetto e attività sono obbligatori.'); return
    }
    const mancanti = campiMancantiForm(form)
    if (mancanti.length) {
      setFormErr('Compila i campi obbligatori: ' + mancanti.map(f => CAMPO_LABEL[f] ?? f).join(', ') + '.'); return
    }
    // Valida solo i link nuovi o modificati: i valori storici non conformi
    // (testo libero pre-validazione) non bloccano salvataggi che non li toccano.
    const itemCorrente = modal === 'edit' ? items.find(i => i.id === editingId) : undefined
    for (const [label, value, attuale] of [
      ['analisi requisiti', form.presaleLinkRequisiti, itemCorrente?.presaleLinkRequisiti ?? ''],
      ['analisi dettaglio', form.presaleLinkStima, itemCorrente?.presaleLinkStima ?? ''],
      ['documento di offerta', form.presaleLinkOfferta, itemCorrente?.presaleLinkOfferta ?? ''],
    ] as const) {
      const invariato = value.trim() === attuale.trim()
      if (!invariato && value.trim() && !isValidHttpUrl(value)) {
        setFormErr(`Il link ${label} non è un URL valido (deve iniziare con http:// o https://).`); return
      }
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
        pmId: form.pmId || null,
        presaleAssegnatarioId: form.presaleAssegnatarioId || null,
        presaleGiornateStimate: numOrNull(form.presaleGiornateStimate),
        presaleScadenzaStima: form.presaleScadenzaStima || null,
        giornateVendute: numOrNull(form.giornateVendute),
        presaleLinkRequisiti: form.presaleLinkRequisiti.trim() || null,
        presaleLinkStima: form.presaleLinkStima.trim() || null,
        presaleLinkOfferta: form.presaleLinkOfferta.trim() || null,
        presaleDriveFolderId: form.presaleDriveFolderId.trim() || null,
        presaleTipoIntervento: form.presaleTipoIntervento || null,
        presaleNotePerFase: form.presaleNotePerFase,
        note: form.note.trim() || null,
        inizio: form.inizio || null,
        deadline: form.deadline || null,
        inviaMail,
        ...(modal === 'add' ? { tipo: 'STANDARD' } : {}),
      }
      const res = await fetch(url, { method, headers: authHeadersJson(token), body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      // Salvataggio riuscito: il nuovo stato è persistito, niente revert
      phaseRevertRef.current = null
      setModal(null)
      await fetchAll()
    } catch {
      setFormErr('Errore di rete. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  // Invio/re-invio manuale della mail di fase (bottone sulla card o nel dettaglio).
  const sendMailFor = async (item: PresaleItem) => {
    setSendingMailId(item.id); setApiError(null)
    try {
      const res = await fetch(`${API_URL}/api/attivita/${item.id}/invia-mail`, {
        method: 'POST', headers: authHeadersJson(token), body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || (data as { sent?: boolean }).sent === false) {
        setApiError((data as { error?: string }).error ?? 'Invio mail non riuscito.')
        return
      }
      // Aggiorna lo stato "inviata" localmente (card + eventuale dettaglio aperto).
      const fase = (data as { fase?: string }).fase ?? STATO_TO_FASE_MAIL[item.stato]
      const addFase = (i: PresaleItem): PresaleItem =>
        fase ? { ...i, presaleEmailFasiInviate: Array.from(new Set([...i.presaleEmailFasiInviate, fase])) } : i
      setItems(prev => prev.map(i => i.id === item.id ? addFase(i) : i))
      setSelected(prev => prev && prev.id === item.id ? addFase(prev) : prev)
    } catch {
      setApiError('Errore di rete durante l\'invio della mail.')
    } finally {
      setSendingMailId(null)
    }
  }

  const handleConfirmEffettiva = async (inviaMail: boolean) => {
    if (!confirmTarget) return
    setConfirming(true)
    try {
      const res = await fetch(`${API_URL}/api/attivita/${confirmTarget.id}/stato`, {
        method: 'PATCH', headers: authHeadersJson(token), body: JSON.stringify({ stato: STATO_EFFETTIVA, inviaMail }),
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
          {statiPresale.map((col, colIdx) => {
            const colItems = displayItems.filter(i => i.stato === col.chiave)
            const next = statiPresale[colIdx + 1]
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
                    <PresaleCard
                      key={item.id}
                      item={item}
                      accent={col.colore}
                      nextLabel={next?.label}
                      isLast={!next}
                      mailSent={faseMailInviata(item)}
                      mailSending={sendingMailId === item.id}
                      onDragStart={id => { dragIdRef.current = id }}
                      onOpen={setSelected}
                      onAdvance={next ? () => changePhaseAndOpen(item, next.chiave) : undefined}
                      onConfirm={() => tryConfirm(item)}
                      onSendMail={() => sendMailFor(item)}
                    />
                  ))}
                  {colItems.length === 0 && <p className="ps-col-empty">Nessuna attività</p>}
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
          suggestedDevHub={suggestedDevHub}
          loading={saving}
          apiError={formErr}
          mailGiaInviata={modal === 'edit' && !!editingId ? (items.find(i => i.id === editingId)?.presaleEmailFasiInviate.includes(STATO_TO_FASE_MAIL[form.stato] ?? '') ?? false) : false}
          driveCfg={driveCfg}
          onChange={setForm}
          onSave={handleSave}
          onClose={closeModalWithRevert}
        />
      )}

      {selected && (
        <DetailDrawer
          item={selected}
          token={token}
          statoCfg={statoByChiave.get(selected.stato)}
          statoByChiave={statoByChiave}
          mailSent={faseMailInviata(selected)}
          mailSending={sendingMailId === selected.id}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onConfirm={() => tryConfirm(selected)}
          onDelete={() => setDelTarget(selected)}
          onSendMail={() => sendMailFor(selected)}
        />
      )}

      {confirmTarget && (
        <ConfirmEffettiva
          item={confirmTarget}
          statoEffettivaLabel={statoByChiave.get(STATO_EFFETTIVA)?.label ?? 'Da iniziare'}
          esisteStato={statoByChiave.has(STATO_EFFETTIVA)}
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
