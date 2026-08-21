import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { SectionModal } from '../components/SectionModal'
import { MultiSelectFilter, type MultiSelectOption } from '../components/MultiSelectFilter'
import { DriveLinkField } from '../components/DriveLinkField'
import { useDriveConfig } from '../lib/useDriveConfig'
import {
  isDrivePickerConfigured, extractDriveFileId, ensureChildFolder,
  getDriveNodeMeta, findChildFileByName, copyDriveFile, driveErrorReason,
  findChildFolderByYear,
} from '../lib/googleDrive'
import './ContrattiPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoContratto = 'MANUTENZIONE' | 'MANUTENZIONE_AMS'

const TIPO_LABELS: Record<TipoContratto, string> = {
  MANUTENZIONE:     'Manutenzione',
  MANUTENZIONE_AMS: 'Manutenzione + AMS',
}

// Etichette compatte per la cella "Tipo" della tabella: la label piena
// resta nei filtri e nel modal, dove non c'è concorrenza per lo spazio.
const TIPO_LABELS_BREVI: Record<TipoContratto, string> = {
  MANUTENZIONE:     'Manut.',
  MANUTENZIONE_AMS: 'Manut. + AMS',
}

const OPT_FATTURATO = [
  { value: 'si', label: 'Fatturato' },
  { value: 'no', label: 'Da fatturare' },
]

const optTipi = (Object.keys(TIPO_LABELS) as TipoContratto[])
  .map((t) => ({ value: t, label: TIPO_LABELS[t] }))

interface UserRef { id: string; firstName: string | null; lastName: string | null; name: string | null }

// L'account non è un campo del contratto: si eredita dal Cliente, e /clienti
// ne seleziona solo id + nome/cognome (nessun `name`).
type AccountRef = Omit<UserRef, 'name'> & { name?: string | null }

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
interface ClienteOption { id: string; nome: string; account: AccountRef | null }
interface ProgettoOption { id: string; nome: string; clienteId: string | null; pmRiferimento: UserRef | null }

type FormData = {
  clienteId: string; titolo: string; tipo: TipoContratto; anno: string; stato: string
  dataInizio: string; dataFine: string
  importoTotale: string; fatturato: boolean
  riferimentoOrdineVendita: string; driveUrl: string; driveFolderId: string; note: string
  applicazioniIds: string[]
}

const ANNO_CORRENTE = new Date().getFullYear()
// Estremi accettati dal backend (validateContrattoBody): oltre non si naviga.
const ANNO_MIN = 2000
const ANNO_MAX = 2100

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

function displayUser(u: UserRef | AccountRef | null): string {
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

// Periodo compatto: quando inizio e fine cadono nello stesso anno (il caso
// normale, l'anno di competenza) l'anno si scrive solo sulla data di fine.
function fmtGiornoMese(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
}

function stessoAnno(a: string, b: string): boolean {
  return new Date(a).getFullYear() === new Date(b).getFullYear()
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

// ─── Spinner ──────────────────────────────────────────────────────────────────
// La copia su Drive è lenta (più chiamate API in sequenza, una per contratto):
// senza un segnale visibile il modal sembra bloccato.

function Spinner() {
  return (
    <svg className="ct-spinner" viewBox="0 0 24 24" fill="none" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// Fase del clone, per dire all'utente *cosa* sta aspettando: `clone` è la
// chiamata al backend, `drive` la copia dei documenti (l'attesa lunga).
interface ClonaFase { step: 'clone' | 'drive'; label: string }

// ─── Clone del documento su Drive ─────────────────────────────────────────────
// Rinnovando un contratto si vuole anche il documento dell'anno prima nella
// cartella dell'anno nuovo. La struttura non è assunta ma **ricavata dal file
// di origine**: dal documento si risale alla sua cartella ("2026 - Contratti
// Alltub") e al nonno ("Contratti 2026"), si sostituisce l'anno in entrambi i
// nomi e si ricrea il percorso sulla destinazione, riusando le cartelle già
// esistenti. Così una cartella con una convenzione diversa viene rispettata
// invece di generarne una parallela.
//
// Tutto client-side: i token Drive vivono nel browser, il server non ne ha.

// Sostituisce l'anno in un nome, se c'è. Stessa tecnica del titolo contratto:
// quando l'anno non compare il nome resta identico.
function conAnno(nome: string, da: number, a: number): string {
  return nome.split(String(da)).join(String(a))
}

type EsitoDoc =
  | { kind: 'ok';      url: string; nome: string }
  | { kind: 'esiste';  url: string; nome: string }
  | { kind: 'skip';    motivo: string }
  | { kind: 'errore';  motivo: string }

async function clonaDocumentoDrive(
  sorgente: Contratto, annoDest: number, radiceContratti: string | null,
): Promise<EsitoDoc> {
  const fileId = extractDriveFileId(sorgente.driveUrl)
  if (!fileId) return { kind: 'skip', motivo: 'nessun documento collegato' }

  try {
    // Cartella che contiene il documento: quella salvata sul contratto, o
    // ricavata dal file per i link incollati a mano prima del picker.
    const fileMeta = await getDriveNodeMeta(fileId)
    if (!fileMeta) return { kind: 'errore', motivo: 'documento non leggibile su Drive' }
    const cartellaId = sorgente.driveFolderId || fileMeta.parentId
    if (!cartellaId) return { kind: 'errore', motivo: 'cartella del documento non determinabile' }

    const cartella = await getDriveNodeMeta(cartellaId)
    if (!cartella) return { kind: 'errore', motivo: 'cartella del documento non leggibile' }

    // Cartella "anno" in testa: si eredita il nome del nonno con l'anno
    // sostituito. Se il documento non è annidato (nonno assente o coincidente
    // con la radice) si ricade sulla convenzione "Contratti <anno>".
    const nonno = cartella.parentId && cartella.parentId !== radiceContratti
      ? await getDriveNodeMeta(cartella.parentId)
      : null
    const nomeAnno = nonno
      ? conAnno(nonno.name, sorgente.anno, annoDest)
      : `Contratti ${annoDest}`

    const radice = radiceContratti ?? nonno?.parentId ?? cartella.parentId
    if (!radice) return { kind: 'errore', motivo: 'radice Drive dei contratti non configurata' }

    const idAnno    = await ensureChildFolder(radice, nomeAnno)
    const idCliente = await ensureChildFolder(idAnno, conAnno(cartella.name, sorgente.anno, annoDest))

    const nomeFile = conAnno(fileMeta.name, sorgente.anno, annoDest)

    // Clone rilanciato: se il documento è già lì non si duplica.
    const esistente = await findChildFileByName(idCliente, nomeFile)
    if (esistente) return { kind: 'esiste', url: esistente.url, nome: nomeFile }

    const copia = await copyDriveFile(fileId, nomeFile, idCliente)
    return { kind: 'ok', url: copia.url, nome: nomeFile }
  } catch (e) {
    return { kind: 'errore', motivo: driveErrorReason(e) }
  }
}

// ─── Copertura assistenza ─────────────────────────────────────────────────────
// Il registro dice chi È coperto; questa sezione dice chi NON lo è, che è il
// dato che serve a gennaio. Tutto calcolato sui dati già in pagina (clienti,
// progetti cliente e contratti di ogni anno): nessuna chiamata extra.
// Un contratto copre a prescindere dallo stato — anche chiuso conta.

interface CoperturaProg { id: string; nome: string }

// Cliente coperto in un altro anno ma non in quello filtrato: il rinnovo
// non è stato fatto. Il contratto più vicino è il candidato da clonare.
interface RinnovoMancante {
  clienteId: string; cliente: string
  ultimo: Contratto
  progetti: CoperturaProg[]
}

// Cliente CON contratto nell'anno, ma alcuni suoi progetti non sono tra le
// applicazioni coperte: la dimenticanza più insidiosa.
interface ClienteConBuchi {
  clienteId: string; cliente: string
  contrattiAnno: Contratto[]
  progetti: CoperturaProg[]
}

interface MaiCoperto {
  clienteId: string; cliente: string
  progetti: CoperturaProg[]
}

interface Copertura {
  rinnovi: RinnovoMancante[]
  buchi: ClienteConBuchi[]
  mai: MaiCoperto[]
}

function calcolaCopertura(
  clienti: ClienteOption[], progetti: ProgettoOption[], contratti: Contratto[], anno: number,
): Copertura {
  const progettiPerCliente = new Map<string, ProgettoOption[]>()
  for (const p of progetti) {
    if (!p.clienteId) continue
    const arr = progettiPerCliente.get(p.clienteId)
    if (arr) arr.push(p); else progettiPerCliente.set(p.clienteId, [p])
  }

  const contrattiAnnoPerCliente = new Map<string, Contratto[]>()
  const appCoperte = new Set<string>()
  // Contratto di riferimento su un altro anno: il più vicino all'anno
  // filtrato, a pari distanza vince quello precedente (è il rinnovo naturale).
  const altroAnno = new Map<string, Contratto>()
  for (const c of contratti) {
    if (c.anno === anno) {
      const arr = contrattiAnnoPerCliente.get(c.clienteId)
      if (arr) arr.push(c); else contrattiAnnoPerCliente.set(c.clienteId, [c])
      for (const a of c.applicazioni) appCoperte.add(a.id)
      continue
    }
    const cur = altroAnno.get(c.clienteId)
    const dist = (x: Contratto) => Math.abs(x.anno - anno) * 2 + (x.anno > anno ? 1 : 0)
    if (!cur || dist(c) < dist(cur)) altroAnno.set(c.clienteId, c)
  }

  const rinnovi: RinnovoMancante[] = []
  const buchi: ClienteConBuchi[] = []
  const mai: MaiCoperto[] = []

  for (const cli of clienti) {
    const suoi = (progettiPerCliente.get(cli.id) ?? []).map((p) => ({ id: p.id, nome: p.nome }))
    const dellAnno = contrattiAnnoPerCliente.get(cli.id)
    if (dellAnno && dellAnno.length > 0) {
      const scoperti = suoi.filter((p) => !appCoperte.has(p.id))
      if (scoperti.length > 0) {
        buchi.push({ clienteId: cli.id, cliente: cli.nome, contrattiAnno: dellAnno, progetti: scoperti })
      }
      continue
    }
    const prec = altroAnno.get(cli.id)
    if (prec) {
      rinnovi.push({
        clienteId: cli.id, cliente: cli.nome, ultimo: prec,
        progetti: prec.applicazioni.map((a) => ({ id: a.id, nome: a.nome })),
      })
      continue
    }
    mai.push({ clienteId: cli.id, cliente: cli.nome, progetti: suoi })
  }

  const perNome = <T extends { cliente: string }>(a: T, b: T) => a.cliente.localeCompare(b.cliente, 'it')
  return { rinnovi: rinnovi.sort(perNome), buchi: buchi.sort(perNome), mai: mai.sort(perNome) }
}

// ─── Campi da compilare ───────────────────────────────────────────────────────
// Importo totale, ordine di vendita e contratto su Drive non sono obbligatori
// al salvataggio (un contratto nasce spesso incompleto), ma senza di loro il
// registro non serve a nulla: niente confronto economico, niente aggancio dei
// consuntivi Zoho, nessun documento raggiungibile. Li segnaliamo in riga per
// indurre a completarli, e li nascondiamo sui contratti chiusi — lì non c'è
// più nulla da rincorrere.

type CampoMancante = 'importo' | 'ordine' | 'drive'

const CAMPO_LABEL: Record<CampoMancante, string> = {
  importo: 'Importo',
  ordine:  'Ordine',
  drive:   'Drive',
}

const CAMPO_TITLE: Record<CampoMancante, string> = {
  importo: 'Importo totale non compilato — senza di esso non c\u2019è confronto economico',
  ordine:  'Ordine di vendita non compilato — l\u2019import Zoho non può agganciare le ore',
  drive:   'Link al contratto su Drive non compilato',
}

function campiMancanti(c: Contratto, isChiuso: boolean): CampoMancante[] {
  if (isChiuso) return []
  const out: CampoMancante[] = []
  if (c.importoTotale === null) out.push('importo')
  if (!c.riferimentoOrdineVendita?.trim()) out.push('ordine')
  if (!c.driveUrl?.trim()) out.push('drive')
  return out
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

// ─── Pannello copertura ───────────────────────────────────────────────────────

function CoperturaPanel({
  anno, copertura, onClona, onNuovo, onCopri,
}: {
  anno: number; copertura: Copertura
  onClona: (c: Contratto) => void
  onNuovo: (clienteId: string, applicazioniIds: string[]) => void
  onCopri: (b: ClienteConBuchi, progettoId: string) => void
}) {
  const { rinnovi, buchi, mai } = copertura
  const daAttenzionare = rinnovi.length + buchi.length
  // Sempre chiuso all'ingresso: avere qualche scoperto è la normalità, non
  // un'emergenza — si apre quando si vuole guardarci dentro.
  const [aperto, setOpen] = useState(false)
  const [maiOpen, setMaiOpen] = useState(false)

  return (
    <section className="ct-cop" id="ct-copertura">
      <button type="button" className="ct-cop-head" aria-expanded={aperto}
        onClick={() => setOpen(!aperto)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" width="14" height="14"
          className={`ct-cop-caret${aperto ? ' ct-cop-caret--open' : ''}`} aria-hidden="true">
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="ct-cop-title">Copertura assistenza {anno}</h2>
        <span className="ct-cop-summary">
          {daAttenzionare === 0
            ? `Nessuna lacuna · ${mai.length} client${mai.length === 1 ? 'e' : 'i'} mai copert${mai.length === 1 ? 'o' : 'i'}`
            : `${rinnovi.length} rinnov${rinnovi.length === 1 ? 'o' : 'i'} mancant${rinnovi.length === 1 ? 'e' : 'i'} · ${buchi.length} con progetti scoperti · ${mai.length} mai copert${mai.length === 1 ? 'o' : 'i'}`}
        </span>
      </button>

      {aperto && (
        <div className="ct-cop-body">
          {/* ── Rinnovi mancanti ── */}
          <div className="ct-cop-group">
            <h3 className="ct-cop-group-title">
              Rinnovi mancanti
              <span className="ct-cop-badge ct-cop-badge--warn">{rinnovi.length}</span>
            </h3>
            <p className="ct-cop-group-sub">Coperti in un altro anno, nulla sul {anno}.</p>
            {rinnovi.length === 0 ? (
              <p className="ct-cop-none">Nessuno — tutti i clienti già in assistenza hanno un contratto sul {anno}.</p>
            ) : (
              <ul className="ct-cop-list">
                {rinnovi.map((r) => (
                  <li key={r.clienteId} className="ct-cop-item">
                    <div className="ct-cop-item-main">
                      <span className="ct-cop-cliente">{r.cliente}</span>
                      <span className="ct-cop-meta">
                        coperto nel {r.ultimo.anno} — {r.ultimo.titolo}
                        {r.progetti.length > 0 && ` · ${r.progetti.map((p) => p.nome).join(', ')}`}
                      </span>
                    </div>
                    <button className="ct-btn ct-btn--ghost ct-btn--sm" type="button"
                      onClick={() => onClona(r.ultimo)}
                      title={`Clona il contratto ${r.ultimo.anno} sul ${anno}`}>
                      Clona sul {anno}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Progetti scoperti di clienti in assistenza ── */}
          <div className="ct-cop-group">
            <h3 className="ct-cop-group-title">
              Progetti scoperti
              <span className="ct-cop-badge ct-cop-badge--warn">{buchi.length}</span>
            </h3>
            <p className="ct-cop-group-sub">
              Il cliente ha un contratto sul {anno}, ma questi suoi progetti non sono tra le applicazioni coperte.
            </p>
            {buchi.length === 0 ? (
              <p className="ct-cop-none">Nessuno — ogni progetto dei clienti in assistenza è coperto.</p>
            ) : (
              <ul className="ct-cop-list">
                {buchi.map((b) => (
                  <li key={b.clienteId} className="ct-cop-item ct-cop-item--col">
                    <div className="ct-cop-item-main">
                      <span className="ct-cop-cliente">{b.cliente}</span>
                      <span className="ct-cop-meta">
                        {b.contrattiAnno.length === 1
                          ? b.contrattiAnno[0].titolo
                          : `${b.contrattiAnno.length} contratti sul ${anno}`}
                      </span>
                    </div>
                    <div className="ct-cop-progetti">
                      {b.progetti.map((p) => (
                        <button key={p.id} type="button" className="ct-cop-prog"
                          onClick={() => onCopri(b, p.id)}
                          title={b.contrattiAnno.length === 1
                            ? `Aggiungi ${p.nome} alle applicazioni di «${b.contrattiAnno[0].titolo}»`
                            : `Crea un contratto ${anno} per ${b.cliente} che copra ${p.nome}`}>
                          {p.nome}
                          <span className="ct-cop-prog-add" aria-hidden="true">+</span>
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Mai coperti (informativo) ── */}
          <div className="ct-cop-group">
            <button type="button" className="ct-cop-subhead" aria-expanded={maiOpen}
              onClick={() => setMaiOpen((v) => !v)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" width="12" height="12"
                className={`ct-cop-caret${maiOpen ? ' ct-cop-caret--open' : ''}`} aria-hidden="true">
                <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h3 className="ct-cop-group-title">
                Mai coperti
                <span className="ct-cop-badge">{mai.length}</span>
              </h3>
              <span className="ct-cop-group-sub">Nessun contratto di assistenza in nessun anno.</span>
            </button>
            {maiOpen && (
              mai.length === 0 ? (
                <p className="ct-cop-none">Nessuno — ogni cliente ha almeno un contratto a registro.</p>
              ) : (
                <ul className="ct-cop-list">
                  {mai.map((m) => (
                    <li key={m.clienteId} className="ct-cop-item">
                      <div className="ct-cop-item-main">
                        <span className="ct-cop-cliente">{m.cliente}</span>
                        <span className="ct-cop-meta">
                          {m.progetti.length === 0
                            ? 'nessun progetto registrato'
                            : `${m.progetti.length} progett${m.progetti.length === 1 ? 'o' : 'i'}: ${m.progetti.map((p) => p.nome).join(', ')}`}
                        </span>
                      </div>
                      <button className="ct-btn ct-btn--ghost ct-btn--sm" type="button"
                        onClick={() => onNuovo(m.clienteId, [])}>
                        Crea contratto
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Modal form ───────────────────────────────────────────────────────────────

interface ModalProps {
  title: string; form: FormData; loading: boolean; apiError: string | null
  clienti: ClienteOption[]; stati: StatoContratto[]
  progetti: ProgettoOption[]
  contrattiRootId?: string
  // Campo su cui atterrare: arriva dalle pill "da compilare" in riga
  focusCampo?: CampoMancante
  onChange: (f: FormData) => void; onSave: () => void; onClose: () => void
}

const CAMPO_INPUT_ID: Record<CampoMancante, string> = {
  importo: 'ct-importo',
  ordine:  'ct-ordine-vendita',
  drive:   'ct-drive',
}

function ContrattoModal({
  title, form, loading, apiError, clienti, stati, progetti,
  contrattiRootId, focusCampo, onChange, onSave, onClose,
}: ModalProps) {
  // Entrando da una pill "da compilare" il campo va portato a fuoco: il DOM
  // del modal esiste solo dopo il mount, da qui l'effect (una volta sola).
  useEffect(() => {
    if (!focusCampo) return
    const el = document.getElementById(CAMPO_INPUT_ID[focusCampo])
    if (!(el instanceof HTMLInputElement)) return
    el.focus()
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusCampo])

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
                onChange={(e) => setCliente(e.target.value)} autoFocus={focusCampo === undefined}>
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
              // Il picker si apre sulla cartella dell'anno del contratto
              // ("Contratti 2027"), non sulla radice: risolta al click, non
              // all'apertura del modal, per non chiedere il consenso Google
              // a chi non sta usando Drive. Se quell'anno non ha ancora una
              // cartella si resta sulla radice, da cui si naviga a mano.
              resolveRoot={contrattiRootId ? async () => {
                const anno = Number(form.anno)
                if (!Number.isInteger(anno)) return { rootId: contrattiRootId }
                const idAnno = await findChildFolderByYear(contrattiRootId, anno).catch(() => null)
                return { rootId: idAnno ?? contrattiRootId }
              } : undefined}
              pickerTitle={`Contratto ${form.anno || ''} — Contratti annuali clienti e prodotti`.replace('  ', ' ')}
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

function ClonaModal({ contratto, annoSuggerito, loading, error, driveAttivo, fase, onConfirm, onClose }: {
  contratto: Contratto; annoSuggerito?: number; loading: boolean; error: string | null
  // false = integrazione Drive non configurata: il flag non ha senso
  driveAttivo: boolean
  fase: ClonaFase | null
  onConfirm: (anno: number, copiaDoc: boolean) => void; onClose: () => void
}) {
  // Di norma il rinnovo è l'anno dopo; dal pannello copertura arriva invece
  // l'anno filtrato, che è quello su cui manca il contratto.
  const [anno, setAnno] = useState(String(
    annoSuggerito !== undefined && annoSuggerito !== contratto.anno ? annoSuggerito : contratto.anno + 1))
  const haDoc = driveAttivo && !!contratto.driveUrl
  const [copiaDoc, setCopiaDoc] = useState(haDoc)
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
          {fase?.step === 'drive' && (
            <p className="ct-busy" role="status">
              <Spinner /> Sto copiando il documento su Google Drive — può richiedere qualche secondo.
            </p>
          )}
          <p className="ct-confirm-text">
            Crea una copia di <strong>{contratto.titolo}</strong> ({contratto.cliente.nome}, {contratto.anno}) su un altro anno di competenza.
          </p>
          <div className="ct-field ct-field--half">
            <label htmlFor="ct-clona-anno" className="ct-label">Anno di competenza</label>
            <input id="ct-clona-anno" className="ct-input" type="number" min={2000} max={2100}
              value={anno} onChange={(e) => setAnno(e.target.value)} autoFocus />
            {annoNum === contratto.anno && <span className="ct-field-error">Scegli un anno diverso da quello del contratto.</span>}
          </div>
          {driveAttivo && (
            <div className="ct-clona-drive">
              <label className={`ct-check${haDoc ? '' : ' ct-check--off'}`}>
                <input type="checkbox" checked={copiaDoc} disabled={!haDoc || loading}
                  onChange={(e) => setCopiaDoc(e.target.checked)} />
                Copia anche il documento su Drive
              </label>
              <span className="ct-hint">
                {haDoc
                  ? `Il documento viene duplicato in «Contratti ${annoValido ? annoNum : '…'}», nella cartella del cliente creata se non c'è già.`
                  : 'Questo contratto non ha un documento collegato: niente da copiare.'}
              </span>
            </div>
          )}
          <p className="ct-confirm-sub">
            Le date vengono spostate sul nuovo anno; applicazioni e importo copiati.
            Stato, fatturato, consuntivato e ordine di vendita ripartono da zero.
          </p>
        </div>
        <div className="ct-modal-footer">
          {/* Durante la copia su Drive resta cliccabile: è la via d'uscita se
              il consenso Google non arriva (il clone è già stato creato). */}
          <button className="ct-btn ct-btn--ghost" type="button" onClick={onClose}
            disabled={loading && fase?.step !== 'drive'}>Annulla</button>
          <button className="ct-btn ct-btn--primary" type="button" disabled={!annoValido || loading}
            onClick={() => onConfirm(annoNum, copiaDoc)}>
            {loading
              ? <><Spinner /> {fase?.label ?? 'Clonazione…'}</>
              : `Clona sul ${annoValido ? annoNum : '…'}`}
          </button>
        </div>
      </div>
    </SectionModal>
  )
}

// ─── Clona massivo ────────────────────────────────────────────────────────────
// Rinnovo di fine anno di più contratti in un colpo solo: stessa semantica
// del clone singolo applicata alla selezione.

function ClonaMassivoModal({ contratti, loading, error, driveAttivo, fase, onConfirm, onClose }: {
  contratti: Contratto[]; loading: boolean; error: string | null
  driveAttivo: boolean
  fase: ClonaFase | null
  onConfirm: (anno: number, copiaDoc: boolean) => void; onClose: () => void
}) {
  // Se la selezione è tutta sullo stesso anno, proponi l'anno successivo
  const anniSel = Array.from(new Set(contratti.map((c) => c.anno)))
  const defaultAnno = anniSel.length === 1 ? anniSel[0] + 1 : Math.max(...anniSel) + 1
  const [anno, setAnno] = useState(String(defaultAnno))
  const conDoc = contratti.filter((c) => !!c.driveUrl).length
  const [copiaDoc, setCopiaDoc] = useState(driveAttivo && conDoc > 0)
  const annoNum = Number(anno)
  const annoValido = Number.isInteger(annoNum) && annoNum >= 2000 && annoNum <= 2100
  // Le righe già sull'anno di destinazione verrebbero saltate dal server
  const daSaltare = contratti.filter((c) => c.anno === annoNum)
  const daClonare = contratti.length - daSaltare.length

  return (
    <SectionModal onClose={onClose} labelledBy="ct-clona-multi-title">
      <div className="ct-modal ct-modal--sm">
        <div className="ct-modal-header">
          <h2 id="ct-clona-multi-title" className="ct-modal-title">
            Clona {contratti.length} contratt{contratti.length === 1 ? 'o' : 'i'}
          </h2>
          <button className="ct-modal-close" onClick={onClose} aria-label="Chiudi" type="button">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="ct-modal-body">
          {error && <p className="ct-field-error ct-field-error--banner" role="alert">{error}</p>}
          {fase?.step === 'drive' && (
            <p className="ct-busy" role="status">
              <Spinner /> {fase.label} — la copia su Google Drive avviene una alla volta e può richiedere qualche minuto.
            </p>
          )}
          <p className="ct-confirm-text">
            Crea una copia {contratti.length === 1 ? 'del' : 'dei'}{' '}
            <strong>{contratti.length} contratt{contratti.length === 1 ? 'o selezionato' : 'i selezionati'}</strong>{' '}
            su un altro anno di competenza.
          </p>
          <ul className="ct-bulk-list">
            {contratti.map((c) => (
              <li key={c.id}>
                <span className="ct-bulk-cliente">{c.cliente.nome}</span>
                <span className="ct-bulk-titolo">{c.titolo}</span>
                <span className="ct-bulk-anno">{c.anno}</span>
              </li>
            ))}
          </ul>
          <div className="ct-field ct-field--half">
            <label htmlFor="ct-clona-multi-anno" className="ct-label">Anno di competenza</label>
            <input id="ct-clona-multi-anno" className="ct-input" type="number" min={2000} max={2100}
              value={anno} onChange={(e) => setAnno(e.target.value)} autoFocus />
          </div>
          {annoValido && daSaltare.length > 0 && (
            <p className="ct-confirm-warn">
              {daSaltare.length} contratt{daSaltare.length === 1 ? 'o è' : 'i sono'} già sul {annoNum} e verr{daSaltare.length === 1 ? 'à' : 'anno'} saltat{daSaltare.length === 1 ? 'o' : 'i'}.
            </p>
          )}
          {driveAttivo && (
            <div className="ct-clona-drive">
              <label className={`ct-check${conDoc === 0 ? ' ct-check--off' : ''}`}>
                <input type="checkbox" checked={copiaDoc} disabled={conDoc === 0 || loading}
                  onChange={(e) => setCopiaDoc(e.target.checked)} />
                Copia anche i documenti su Drive
              </label>
              <span className="ct-hint">
                {conDoc === 0
                  ? 'Nessuno dei contratti selezionati ha un documento collegato.'
                  : `${conDoc} su ${contratti.length} ${conDoc === 1 ? 'ha' : 'hanno'} un documento. `
                    + 'La copia avviene una alla volta e può richiedere qualche minuto.'}
              </span>
            </div>
          )}
          <p className="ct-confirm-sub">
            Per ciascuno: date spostate sul nuovo anno, applicazioni e importo copiati.
            Stato, fatturato, consuntivato e ordine di vendita ripartono da zero.
            I contratti che hanno già un clone sull'anno scelto vengono saltati.
          </p>
        </div>
        <div className="ct-modal-footer">
          {/* Come nel clone singolo: durante la copia su Drive l'uscita resta
              possibile — i contratti sono già stati creati dal server. */}
          <button className="ct-btn ct-btn--ghost" type="button" onClick={onClose}
            disabled={loading && fase?.step !== 'drive'}>Annulla</button>
          <button className="ct-btn ct-btn--primary" type="button" disabled={!annoValido || daClonare === 0 || loading}
            onClick={() => onConfirm(annoNum, copiaDoc)}>
            {loading
              ? <><Spinner /> {fase?.label ?? 'Clonazione…'}</>
              : `Clona ${daClonare} sul ${annoValido ? annoNum : '…'}`}
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
  // Anagrafica completa di PM e Account: le opzioni dei filtri devono
  // elencare tutti i ruoli, non solo quelli già usati sui contratti.
  const [pmUsers, setPmUsers]           = useState<UserRef[]>([])
  const [accountUsers, setAccountUsers] = useState<UserRef[]>([])
  const [progetti, setProgetti]   = useState<ProgettoOption[]>([])
  const [costoMedio, setCostoMedio]   = useState<number | null>(null)
  const [loading, setLoading]     = useState(true)
  const [apiError, setApiError]   = useState<string | null>(null)

  const driveCfg = useDriveConfig(token)

  // Filtri
  const [fAnno, setFAnno]       = useState<number>(ANNO_CORRENTE)
  // Filtri a selezione multipla: lista vuota = nessun filtro (tutti passano)
  const [fStato, setFStato]     = useState<string[]>([])
  const [fTipo, setFTipo]       = useState<string[]>([])
  const [fCliente, setFCliente] = useState<string[]>([])
  const [fPm, setFPm]           = useState<string[]>([])
  const [fAccount, setFAccount] = useState<string[]>([])
  const [fFatt, setFFatt]       = useState<string[]>([])

  // Modale / eliminazione / righe espanse
  const [modal, setModal]       = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing]   = useState<Contratto | null>(null)
  const [form, setForm]         = useState<FormData>(EMPTY_FORM)
  const [focusCampo, setFocusCampo] = useState<CampoMancante | undefined>(undefined)
  const [saving, setSaving]     = useState(false)
  const [formErr, setFormErr]   = useState<string | null>(null)
  const [delTarget, setDelTarget] = useState<Contratto | null>(null)
  const [deleting, setDeleting]   = useState(false)
  const [delErr, setDelErr]       = useState<string | null>(null)
  const [cloneTarget, setCloneTarget] = useState<Contratto | null>(null)
  const [cloning, setCloning]     = useState(false)
  const [cloneErr, setCloneErr]   = useState<string | null>(null)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())

  // Selezione multipla per il clone massivo + esito dell'ultima operazione
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen]     = useState(false)
  const [bulkErr, setBulkErr]       = useState<string | null>(null)
  const [bulkNotice, setBulkNotice] = useState<string | null>(null)
  // Fase mostrata sul bottone durante il clone (la copia Drive è lenta) e
  // link dei documenti copiati, elencati nell'esito.
  const [fase, setFase]         = useState<ClonaFase | null>(null)
  const [docLinks, setDocLinks] = useState<Array<{ nome: string; url: string; esiste: boolean }>>([])

  const fetchAll = useCallback(async () => {
    setLoading(true); setApiError(null)
    try {
      const get = (path: string) => fetch(`${API_URL}${path}`, { headers: authHeaders(token) })
      const [rCon, rStati, rCli, rProg, rCfg, rPm, rAcc] = await Promise.all([
        get('/api/contratti'),
        get('/api/stati-contratto'),
        get('/clienti'),
        get('/progetti?tipo=CLIENTE'),
        get('/api/config/contratti'),
        get('/api/users?role=PM'),
        get('/api/users?role=ACCOUNT'),
      ])
      if (!rCon.ok || !rStati.ok || !rCli.ok || !rProg.ok) throw new Error()
      setContratti(await rCon.json())
      setStati(await rStati.json())
      setClienti(await rCli.json())
      setProgetti(await rProg.json())
      if (rPm.ok) setPmUsers(await rPm.json())
      if (rAcc.ok) setAccountUsers(await rAcc.json())
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

  // L'integrazione Drive vive nel browser: senza le env Vite non c'è token,
  // quindi il flag di copia non ha senso.
  const canDrive = isDrivePickerConfigured()

  const patchDriveContratto = useCallback(async (contrattoId: string, url: string) => {
    const res = await fetch(`${API_URL}/api/contratti/${contrattoId}/drive`, {
      method: 'PATCH', headers: authHeaders(token),
      body: JSON.stringify({ driveUrl: url }),
    })
    if (!res.ok) throw new Error(`Errore ${res.status}`)
  }, [token])

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

  // ── Opzioni dei filtri ──
  const optStati = useMemo<MultiSelectOption[]>(
    () => stati.map((s) => ({ value: s.chiave, label: s.label, colore: s.colore })), [stati])

  const optClienti = useMemo<MultiSelectOption[]>(
    () => clienti.map((c) => ({ value: c.id, label: c.nome })), [clienti])

  // Ordinamento comune delle opzioni "persona"
  const perNome = (a: MultiSelectOption, b: MultiSelectOption) => a.label.localeCompare(b.label, 'it')

  // Opzioni del filtro PM: **tutti** gli utenti con ruolo PM, più eventuali
  // pmRiferimento già sui contratti che non avessero (più) quel ruolo —
  // altrimenti la tendina elencherebbe solo i PM già presenti a filtro vuoto.
  const optPm = useMemo<MultiSelectOption[]>(() => {
    const map = new Map<string, string>()
    for (const u of pmUsers) map.set(u.id, displayUser(u))
    for (const c of contratti) for (const pm of pmsDi(c.applicazioni)) map.set(pm.id, displayUser(pm))
    return Array.from(map, ([value, label]) => ({ value, label })).sort(perNome)
  }, [pmUsers, contratti])

  // Account del cliente per id cliente: il contratto non ha un account
  // proprio, lo eredita dall'anagrafica cliente (come il PM dai progetti).
  const accountPerCliente = useMemo(() => {
    const m = new Map<string, AccountRef>()
    for (const cl of clienti) if (cl.account) m.set(cl.id, cl.account)
    return m
  }, [clienti])

  const optAccount = useMemo<MultiSelectOption[]>(() => {
    const map = new Map<string, string>()
    for (const u of accountUsers) map.set(u.id, displayUser(u))
    for (const a of accountPerCliente.values()) map.set(a.id, displayUser(a))
    return Array.from(map, ([value, label]) => ({ value, label })).sort(perNome)
  }, [accountUsers, accountPerCliente])

  const filtriAttivi = fStato.length + fTipo.length + fCliente.length + fPm.length
    + fAccount.length + fFatt.length

  const azzeraFiltri = () => {
    setFStato([]); setFTipo([]); setFCliente([]); setFPm([]); setFAccount([]); setFFatt([])
  }

  // ── Filtri + raggruppamento per cliente ──
  const filtered = useMemo(() => contratti.filter((c) =>
    c.anno === fAnno &&
    (fStato.length === 0 || fStato.includes(c.stato)) &&
    (fTipo.length === 0 || fTipo.includes(c.tipo)) &&
    (fCliente.length === 0 || fCliente.includes(c.clienteId)) &&
    (fPm.length === 0 || pmsDi(c.applicazioni).some((pm) => fPm.includes(pm.id))) &&
    (fAccount.length === 0 || fAccount.includes(accountPerCliente.get(c.clienteId)?.id ?? '')) &&
    (fFatt.length === 0 || fFatt.includes(c.fatturato ? 'si' : 'no'))
  ), [contratti, fAnno, fStato, fTipo, fCliente, fPm, fAccount, fFatt, accountPerCliente])

  const gruppi = useMemo(() => {
    const map = new Map<string, { nome: string; account: AccountRef | null; contratti: Contratto[] }>()
    for (const c of filtered) {
      if (!map.has(c.clienteId)) {
        map.set(c.clienteId, {
          nome: c.cliente.nome,
          account: accountPerCliente.get(c.clienteId) ?? null,
          contratti: [],
        })
      }
      map.get(c.clienteId)!.contratti.push(c)
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
  }, [filtered, accountPerCliente])

  // Anni della barra: quelli con contratti, più l'anno corrente e **quello
  // selezionato** — così l'anno attivo è sempre visibile anche quando resta
  // senza contratti (ultimo eliminato, o clonato altrove).
  const contrattiPerAnno = useMemo(() => {
    const m = new Map<number, number>()
    for (const c of contratti) m.set(c.anno, (m.get(c.anno) ?? 0) + 1)
    return m
  }, [contratti])

  const anniBarra = useMemo(() => {
    const noti = [...contrattiPerAnno.keys(), ANNO_CORRENTE, fAnno]
    // Timeline continua tra il primo e l'ultimo anno noto: senza buchi le
    // frecce non fanno apparire e sparire pulsanti mentre si scorre.
    let da = Math.min(...noti)
    let a  = Math.max(...noti)
    // Un anno molto vecchio a registro non deve generare una striscia
    // interminabile: oltre il tetto la finestra si centra sull'anno attivo.
    const MAX_ANNI = 24
    if (a - da + 1 > MAX_ANNI) {
      da = fAnno - Math.floor(MAX_ANNI / 2)
      a  = da + MAX_ANNI - 1
    }
    da = Math.max(ANNO_MIN, da); a = Math.min(ANNO_MAX, a)
    const out: number[] = []
    for (let y = da; y <= a; y++) out.push(y)
    return out
  }, [contrattiPerAnno, fAnno])

  // Le frecce si muovono di un anno alla volta, anche su anni senza contratti:
  // è così che si prepara il rinnovo dell'anno prossimo.
  const vaiAnno = (delta: number) =>
    setFAnno((a) => Math.min(ANNO_MAX, Math.max(ANNO_MIN, a + delta)))

  // L'anno attivo resta a vista quando lo si raggiunge con le frecce.
  const barraRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    barraRef.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [fAnno, anniBarra])

  const totaleImporto = filtered.reduce((s, c) => s + (c.importoTotale ?? 0), 0)

  // ── Selezione multipla (clone massivo) ──
  // La selezione conta solo sulle righe visibili: `selectedContratti` è
  // l'intersezione con i filtri correnti, così cambiare filtro o ricaricare
  // non porta con sé righe non più a schermo (senza dover potare lo stato).
  const filteredIds = useMemo(() => filtered.map((c) => c.id), [filtered])

  const selectedContratti = useMemo(
    () => filtered.filter((c) => selected.has(c.id)), [filtered, selected])

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const setSelezione = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })

  const tuttiSelezionati = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id))

  // ── Copertura assistenza sull'anno filtrato ──
  const copertura = useMemo(
    () => calcolaCopertura(clienti, progetti, contratti, fAnno),
    [clienti, progetti, contratti, fAnno])

  // Un solo contratto sull'anno → lo si estende al progetto scoperto;
  // più di uno → non si può indovinare quale, si parte da un contratto nuovo.
  const copriProgetto = (b: ClienteConBuchi, progettoId: string) => {
    if (b.contrattiAnno.length === 1) openEdit(b.contrattiAnno[0], progettoId)
    else openAdd(b.clienteId, [progettoId])
  }

  // ── CRUD handlers ──
  const openAdd = (clienteId = '', applicazioniIds: string[] = []) => {
    setForm({
      ...EMPTY_FORM, anno: String(fAnno), stato: stati[0]?.chiave ?? 'IN_DEFINIZIONE',
      clienteId, applicazioniIds,
    })
    setEditing(null); setFocusCampo(undefined); setFormErr(null); setModal('add')
  }

  // `aggiungiApplicazione` arriva dal pannello copertura: apre il contratto
  // con il progetto scoperto già acceso tra le applicazioni.
  // `focus` arriva dalle pill "da compilare" in riga.
  const openEdit = (c: Contratto, aggiungiApplicazione?: string, focus?: CampoMancante) => {
    setEditing(c)
    setFocusCampo(focus)
    setForm({
      clienteId: c.clienteId, titolo: c.titolo, tipo: c.tipo, anno: String(c.anno), stato: c.stato,
      dataInizio: c.dataInizio?.slice(0, 10) ?? '', dataFine: c.dataFine?.slice(0, 10) ?? '',
      importoTotale: c.importoTotale !== null ? String(c.importoTotale) : '',
      fatturato: c.fatturato,
      riferimentoOrdineVendita: c.riferimentoOrdineVendita ?? '', driveUrl: c.driveUrl ?? '',
      driveFolderId: c.driveFolderId ?? '', note: c.note ?? '',
      applicazioniIds: aggiungiApplicazione
        ? [...new Set([...c.applicazioni.map((a) => a.id), aggiungiApplicazione])]
        : c.applicazioni.map((a) => a.id),
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

  const handleClona = async (anno: number, copiaDoc: boolean) => {
    if (!cloneTarget) return
    const sorgente = cloneTarget
    setCloning(true); setCloneErr(null); setFase({ step: 'clone', label: 'Clonazione…' })
    try {
      const res = await fetch(`${API_URL}/api/contratti/${sorgente.id}/clona`, {
        method: 'POST', headers: authHeaders(token), body: JSON.stringify({ anno }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setCloneErr((data as { error?: string }).error ?? `Errore ${res.status}`); return
      }
      const clone = await res.json() as Contratto

      // Copia del documento: il contratto è già creato, un errore Drive non
      // lo annulla — si segnala e il link resta collegabile a mano.
      let avviso: string | null = null
      const links: typeof docLinks = []
      if (copiaDoc && canDrive) {
        setFase({ step: 'drive', label: 'Copia documento…' })
        const esito = await clonaDocumentoDrive(sorgente, anno, driveCfg?.contrattiId || null)
        if (esito.kind === 'ok' || esito.kind === 'esiste') {
          links.push({ nome: esito.nome, url: esito.url, esiste: esito.kind === 'esiste' })
          await patchDriveContratto(clone.id, esito.url).catch(() => {
            avviso = 'documento copiato, ma non collegato al contratto: collegalo dalla modifica'
          })
        } else if (esito.kind === 'errore') {
          avviso = `documento non copiato: ${esito.motivo}`
        }
      }

      setCloneTarget(null)
      await fetchAll()
      setFAnno(anno) // porta il filtro sull'anno del clone, così si vede subito
      setDocLinks(links)
      setBulkNotice(`Contratto clonato sul ${anno}.${avviso ? ` Attenzione: ${avviso}.` : ''}`)
    } catch { setCloneErr('Errore di rete. Riprova.') }
    finally { setCloning(false); setFase(null) }
  }

  const handleClonaMassivo = async (anno: number, copiaDoc: boolean) => {
    const sorgenti = selectedContratti
    if (sorgenti.length === 0) return
    setCloning(true); setBulkErr(null); setFase({ step: 'clone', label: 'Clonazione…' })
    try {
      const res = await fetch(`${API_URL}/api/contratti/clona-massivo`, {
        method: 'POST', headers: authHeaders(token),
        body: JSON.stringify({ ids: sorgenti.map((c) => c.id), anno }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBulkErr((data as { error?: string }).error ?? `Errore ${res.status}`); return
      }
      const esito = data as {
        creati: Array<{ id: string; sorgenteId: string }>
        saltati: Array<{ titolo: string; cliente: string; motivo: string }>
      }

      // Copia dei documenti: una per contratto, in sequenza (ogni copia sono
      // più chiamate Drive). Il progresso finisce sul bottone perché su molte
      // righe l'attesa è di minuti.
      const links: typeof docLinks = []
      const erroriDoc: string[] = []
      if (copiaDoc && canDrive) {
        const daCopiare = esito.creati
          .map((k) => ({ clone: k, sorgente: sorgenti.find((c) => c.id === k.sorgenteId) }))
          .filter((x): x is { clone: { id: string; sorgenteId: string }; sorgente: Contratto } =>
            x.sorgente !== undefined && !!x.sorgente.driveUrl)
        for (const [i, x] of daCopiare.entries()) {
          setFase({ step: 'drive', label: `Copia documenti… ${i + 1} di ${daCopiare.length}` })
          const e = await clonaDocumentoDrive(x.sorgente, anno, driveCfg?.contrattiId || null)
          if (e.kind === 'ok' || e.kind === 'esiste') {
            links.push({ nome: e.nome, url: e.url, esiste: e.kind === 'esiste' })
            await patchDriveContratto(x.clone.id, e.url).catch(() => {
              erroriDoc.push(`${x.sorgente.cliente.nome}: copiato ma non collegato`)
            })
          } else if (e.kind === 'errore') {
            erroriDoc.push(`${x.sorgente.cliente.nome}: ${e.motivo}`)
          }
        }
      }

      setBulkOpen(false)
      setSelected(new Set())
      await fetchAll()
      setFAnno(anno) // dopo il fetch, così l'anno nuovo è già in barra
      setDocLinks(links)

      const n = esito.creati.length
      const parti = [`${n} contratt${n === 1 ? 'o' : 'i'} clonat${n === 1 ? 'o' : 'i'} sul ${anno}`]
      if (links.length > 0) {
        const nuovi = links.filter((l) => !l.esiste).length
        parti.push(`${nuovi} documento${nuovi === 1 ? '' : 'i'} copiat${nuovi === 1 ? 'o' : 'i'}`
          + (links.length > nuovi ? `, ${links.length - nuovi} già presenti` : ''))
      }
      if (esito.saltati.length > 0) {
        parti.push(`${esito.saltati.length} saltat${esito.saltati.length === 1 ? 'o' : 'i'}: ` +
          esito.saltati.map((x) => `${x.cliente} — ${x.titolo} (${x.motivo})`).join('; '))
      }
      if (erroriDoc.length > 0) parti.push(`documenti non copiati — ${erroriDoc.join('; ')}`)
      setBulkNotice(parti.join('. ') + '.')
    } catch { setBulkErr('Errore di rete. Riprova.') }
    finally { setCloning(false); setFase(null) }
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
        <button className="ct-btn ct-btn--primary" type="button" onClick={() => openAdd()}>
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

      {/* ── Barra anni ── */}
      <div className="ct-yearbar">
        <button type="button" className="ct-year-arrow" onClick={() => vaiAnno(-1)}
          disabled={fAnno <= ANNO_MIN} aria-label={`Vai al ${fAnno - 1}`} title={`Anno precedente (${fAnno - 1})`}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17" aria-hidden="true">
            <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ct-year-strip" ref={barraRef} role="group" aria-label="Anno di competenza">
          {anniBarra.map((a) => {
            const n = contrattiPerAnno.get(a) ?? 0
            return (
              <button key={a} type="button" aria-pressed={a === fAnno}
                className={`ct-year${a === fAnno ? ' ct-year--on' : ''}${a === ANNO_CORRENTE ? ' ct-year--now' : ''}${n === 0 ? ' ct-year--vuoto' : ''}`}
                title={a === ANNO_CORRENTE ? 'Anno in corso' : undefined}
                onClick={() => setFAnno(a)}>
                {a}
                {n > 0 && <span className="ct-year-count">{n}</span>}
              </button>
            )
          })}
        </div>
        <button type="button" className="ct-year-arrow" onClick={() => vaiAnno(1)}
          disabled={fAnno >= ANNO_MAX} aria-label={`Vai al ${fAnno + 1}`} title={`Anno successivo (${fAnno + 1})`}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17" aria-hidden="true">
            <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* ── Copertura: subito sotto la barra anni, dove si vede ── */}
      {!loading && !apiError && (
        <CoperturaPanel anno={fAnno} copertura={copertura}
          onClona={(c) => { setCloneErr(null); setCloneTarget(c) }}
          onNuovo={openAdd}
          onCopri={copriProgetto} />
      )}

      {/* ── Filtri (tutti a selezione multipla) ── */}
      <div className="ct-filters">
        <MultiSelectFilter className="ct-filter" options={optStati} selected={fStato} onChange={setFStato}
          allLabel="Tutti gli stati" itemsLabel="stati" ariaLabel="Filtra per stato" />
        <MultiSelectFilter className="ct-filter" options={optTipi} selected={fTipo} onChange={setFTipo}
          allLabel="Tutti i tipi" itemsLabel="tipi" ariaLabel="Filtra per tipo" />
        <MultiSelectFilter className="ct-filter ct-filter--wide" options={optClienti} selected={fCliente} onChange={setFCliente}
          allLabel="Tutti i clienti" itemsLabel="clienti" ariaLabel="Filtra per cliente" searchable />
        <MultiSelectFilter className="ct-filter" options={optPm} selected={fPm} onChange={setFPm}
          allLabel="Tutti i PM" itemsLabel="PM" ariaLabel="Filtra per PM" searchable />
        <MultiSelectFilter className="ct-filter" options={optAccount} selected={fAccount} onChange={setFAccount}
          allLabel="Tutti gli account" itemsLabel="account" ariaLabel="Filtra per account" searchable />
        <MultiSelectFilter className="ct-filter" options={OPT_FATTURATO} selected={fFatt} onChange={setFFatt}
          allLabel="Fatturato: tutti" itemsLabel="voci" ariaLabel="Filtra per fatturazione" />
        {filtriAttivi > 0 && (
          <button type="button" className="ct-filters-reset" onClick={azzeraFiltri}>
            Azzera filtri
            <span className="ct-filters-reset-n">{filtriAttivi}</span>
          </button>
        )}
      </div>

      {bulkNotice && (
        <div className="ct-notice" role="status">
          <div className="ct-notice-body">
            <span>{bulkNotice}</span>
            {/* I documenti copiati si aprono da qui: aprire tab da codice dopo
                un await non è una user gesture e il browser le blocca. */}
            {docLinks.length > 0 && (
              <ul className="ct-notice-links">
                {docLinks.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer">{l.nome} ↗</a>
                    {l.esiste && <span className="ct-notice-tag">già presente</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="ct-notice-close" type="button" aria-label="Chiudi avviso"
            onClick={() => { setBulkNotice(null); setDocLinks([]) }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Barra azioni sulla selezione ── */}
      {selectedContratti.length > 0 && (
        <div className="ct-selbar" role="region" aria-label="Azioni sui contratti selezionati">
          <strong className="ct-selbar-count">
            {selectedContratti.length} contratt{selectedContratti.length === 1 ? 'o' : 'i'} selezionat{selectedContratti.length === 1 ? 'o' : 'i'}
          </strong>
          <button className="ct-btn ct-btn--ghost ct-btn--sm" type="button" onClick={() => setSelected(new Set())}>
            Deseleziona
          </button>
          <button className="ct-btn ct-btn--primary ct-btn--sm" type="button"
            onClick={() => { setBulkErr(null); setBulkOpen(true) }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="1.5" strokeLinejoin="round" />
              <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Clona su un altro anno
          </button>
        </div>
      )}

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
          <button className="ct-btn ct-btn--primary" type="button" onClick={() => openAdd()}>Aggiungi il primo contratto</button>
        </div>
      ) : (
        <div className="ct-table-wrap">
          <table className="ct-table" aria-label="Elenco contratti">
            <thead>
              <tr>
                <th scope="col" className="ct-th--check">
                  <input type="checkbox" className="ct-row-check"
                    aria-label="Seleziona tutti i contratti filtrati"
                    checked={tuttiSelezionati}
                    ref={(el) => { if (el) el.indeterminate = !tuttiSelezionati && selectedContratti.length > 0 }}
                    onChange={(e) => setSelezione(filteredIds, e.target.checked)} />
                </th>
                <th scope="col" aria-label="Espandi" />
                <th scope="col">Contratto</th>
                <th scope="col">Tipo</th>
                <th scope="col">Periodo</th>
                <th scope="col">Stato</th>
                <th scope="col">PM</th>
                <th scope="col" className="ct-th--num">Importo</th>
                <th scope="col" className="ct-th--fatt">Fatt.</th>
                <th scope="col">Consumato</th>
                <th scope="col" className="ct-th--actions">Azioni</th>
              </tr>
            </thead>
            {gruppi.map((g) => (
              <tbody key={g.nome} className="ct-group">
                <tr className="ct-group-row">
                  <td className="ct-cell-check">
                    <input type="checkbox" className="ct-row-check"
                      aria-label={`Seleziona i contratti di ${g.nome}`}
                      checked={g.contratti.every((c) => selected.has(c.id))}
                      ref={(el) => {
                        if (el) el.indeterminate = g.contratti.some((c) => selected.has(c.id))
                          && !g.contratti.every((c) => selected.has(c.id))
                      }}
                      onChange={(e) => setSelezione(g.contratti.map((c) => c.id), e.target.checked)} />
                  </td>
                  <td colSpan={10}>
                    <span className="ct-group-nome">{g.nome}</span>
                    <span className="ct-group-count">{g.contratti.length} contratt{g.contratti.length === 1 ? 'o' : 'i'}</span>
                    {g.account && (
                      <span className="ct-group-account" title="Account del cliente">
                        Account: {displayUser(g.account)}
                      </span>
                    )}
                  </td>
                </tr>
                {g.contratti.map((c) => {
                  const isOpen = expanded.has(c.id)
                  const scad = scadenzaInfo(c, statoChiuso(c.stato))
                  const consumato = consumatoDi(c)
                  const pms = pmsDi(c.applicazioni)
                  const mancanti = campiMancanti(c, statoChiuso(c.stato))
                  return (
                    <FragmentRow key={c.id}>
                      <tr className={`ct-row${scad ? ' ct-row--warn' : ''}${selected.has(c.id) ? ' ct-row--sel' : ''}`}>
                        <td className="ct-cell-check">
                          <input type="checkbox" className="ct-row-check"
                            aria-label={`Seleziona ${c.titolo}`}
                            checked={selected.has(c.id)}
                            onChange={() => toggleSelect(c.id)} />
                        </td>
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
                            {mancanti.length > 0 && (
                              <div className="ct-todo" role="group"
                                aria-label={`Da compilare su ${c.titolo}: ${mancanti.map((m) => CAMPO_LABEL[m]).join(', ')}`}>
                                <svg className="ct-todo-icon" viewBox="0 0 20 20" fill="currentColor"
                                  width="12" height="12" aria-hidden="true">
                                  <title>Da compilare</title>
                                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                                </svg>
                                {mancanti.map((m) => (
                                  <button key={m} type="button" className="ct-todo-pill"
                                    title={CAMPO_TITLE[m]}
                                    onClick={() => openEdit(c, undefined, m)}>
                                    {CAMPO_LABEL[m]}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`ct-tipo ct-tipo--${c.tipo === 'MANUTENZIONE_AMS' ? 'ams' : 'man'}`}
                            title={TIPO_LABELS[c.tipo]}>
                            {TIPO_LABELS_BREVI[c.tipo]}
                          </span>
                        </td>
                        <td className="ct-cell-text">
                          {c.dataInizio
                            ? (c.dataFine && stessoAnno(c.dataInizio, c.dataFine)
                                ? fmtGiornoMese(c.dataInizio)
                                : fmtData(c.dataInizio))
                            : '—'}
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
                            ? <span className="ct-fatt-badge ct-fatt-badge--si" title="Fatturato">Sì</span>
                            : <span className="ct-fatt-badge" title="Da fatturare">No</span>}
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
                          <td colSpan={11}>
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
          focusCampo={focusCampo}
          onChange={setForm} onSave={handleSave} onClose={() => setModal(null)}
        />
      )}
      {cloneTarget && (
        <ClonaModal contratto={cloneTarget} annoSuggerito={fAnno} loading={cloning} error={cloneErr}
          driveAttivo={canDrive} fase={fase}
          onConfirm={handleClona} onClose={() => setCloneTarget(null)} />
      )}
      {bulkOpen && selectedContratti.length > 0 && (
        <ClonaMassivoModal contratti={selectedContratti} loading={cloning} error={bulkErr}
          driveAttivo={canDrive} fase={fase}
          onConfirm={handleClonaMassivo} onClose={() => setBulkOpen(false)} />
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
