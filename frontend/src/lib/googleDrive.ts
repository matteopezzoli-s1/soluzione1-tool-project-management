// ─── Google Drive Picker ──────────────────────────────────────────────────────
// Wrapper del Google Picker ufficiale: l'utente sceglie un file dal drive
// condiviso configurato (Impostazioni → Google Drive) e l'app salva il link.
// Tutto client-side: niente token lato server, i permessi restano quelli di
// Drive dell'utente. Scope `drive` completo (app interna Workspace, nessuna
// verifica Google): serve per creare il doc dell'analisi di dettaglio nella
// cartella dell'analisi iniziale e per risolvere la cartella dei link
// incollati a mano.
//
// Richiede due env Vite (vedi .env.local):
//   VITE_GOOGLE_CLIENT_ID  — lo stesso OAuth client del login
//   VITE_GOOGLE_API_KEY    — API key del progetto Google Cloud (Picker API)
// Se mancano, isDrivePickerConfigured() è false e le pagine mostrano solo
// l'input manuale (degradazione pulita).

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
const API_KEY   = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? ''

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

export function isDrivePickerConfigured(): boolean {
  return CLIENT_ID !== '' && API_KEY !== ''
}

export interface DrivePickedFile {
  url: string
  fileId: string
  name: string
  // Cartella che contiene il file (se il Picker la espone)
  parentId: string | null
  // true se l'utente ha scelto una cartella (non un file)
  isFolder: boolean
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Nomi delle due cartelle-ancora dentro il Drive Sviluppo: si ricavano da lì
// per nome, così in Impostazioni basta configurare il solo Drive Sviluppo.
export const GESTIONE_FOLDER_NAME = 'Sviluppo - Progetti in gestione'
export const PRODOTTI_FOLDER_NAME = 'Prodotti'

// Cosa è selezionabile nel picker:
//  'file'         → naviga tra le cartelle e sceglie un file (default)
//  'fileOrFolder' → sceglie un file OPPURE una cartella (fase presale requisiti)
//  'folder'       → solo cartelle (collega cartella su clienti/progetti)
export type PickerMode = 'file' | 'fileOrFolder' | 'folder'

export interface OpenDrivePickerOptions {
  // Radice di navigazione: ID di uno shared drive o di una cartella
  rootId?: string
  // Se true l'utente resta vincolato alla cartella rootId (usato dalla fase
  // Stima: il Picker con setParent non offre navigazione verso l'alto)
  locked?: boolean
  // Cosa può selezionare l'utente (default 'file')
  mode?: PickerMode
  // Aggiunge la scheda "Carica" del Picker per caricare file nella rootId
  allowUpload?: boolean
  // DEPRECATO: equivalente a mode:'folder' (mantenuto per i chiamanti esistenti)
  selectFolders?: boolean
  title?: string
}

// ── Caricamento lazy degli script Google (una sola volta) ──────────────────

declare global {
  interface Window {
    gapi?: {
      load: (api: string, cb: () => void) => void
    }
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string
            scope: string
            callback: (resp: { access_token?: string; error?: string }) => void
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void }
        }
      }
      picker: {
        // Tipizzazione minimale delle classi Picker che usiamo
        ViewId: { FOLDERS: unknown }
        DocsView: new (viewId?: unknown) => {
          setIncludeFolders: (v: boolean) => unknown
          setSelectFolderEnabled: (v: boolean) => unknown
          setParent: (id: string) => unknown
          setEnableDrives: (v: boolean) => unknown
        }
        DocsUploadView: new () => {
          setParent: (id: string) => unknown
          setIncludeFolders: (v: boolean) => unknown
        }
        PickerBuilder: new () => {
          addView: (view: unknown) => unknown
          setOAuthToken: (t: string) => unknown
          setDeveloperKey: (k: string) => unknown
          setTitle: (t: string) => unknown
          setCallback: (cb: (data: PickerCallbackData) => void) => unknown
          enableFeature: (f: unknown) => unknown
          setMaxItems: (n: number) => unknown
          build: () => { setVisible: (v: boolean) => void }
        }
        Feature: { SUPPORT_DRIVES: unknown }
        Action: { PICKED: string; CANCEL: string }
        Response: { ACTION: string; DOCUMENTS: string }
        Document: { ID: string; NAME: string; URL: string; PARENT_ID: string; MIME_TYPE: string }
      }
    }
  }
}

interface PickerDocument { [key: string]: string | undefined }
interface PickerCallbackData { [key: string]: unknown }

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Impossibile caricare ${src}`))
    document.head.appendChild(s)
  })
}

let gsiReady: Promise<void> | null = null
function ensureGsiLoaded(): Promise<void> {
  if (!gsiReady) gsiReady = loadScript('https://accounts.google.com/gsi/client')
  return gsiReady
}

let pickerReady: Promise<void> | null = null
function ensurePickerLoaded(): Promise<void> {
  if (!pickerReady) {
    pickerReady = Promise.all([
      ensureGsiLoaded(),
      loadScript('https://apis.google.com/js/api.js').then(
        () => new Promise<void>((resolve) => window.gapi!.load('picker', resolve))
      ),
    ]).then(() => undefined)
  }
  return pickerReady
}

// ── Token OAuth (scope drive.file) ──────────────────────────────────────────
// Il token vive in memoria per la sessione di pagina; Google mostra il popup
// di consenso solo la prima volta per utente/scope.

let cachedToken: { value: string; expiresAt: number } | null = null

function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return Promise.resolve(cachedToken.value)
  }
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'Autorizzazione Drive negata'))
          return
        }
        // Margine di 5 minuti sulla scadenza standard (1h)
        cachedToken = { value: resp.access_token, expiresAt: Date.now() + 55 * 60 * 1000 }
        resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

// ── API pubblica ─────────────────────────────────────────────────────────────
// Apre il picker e risolve con il file scelto (null se l'utente annulla).

export async function openDrivePicker(opts: OpenDrivePickerOptions = {}): Promise<DrivePickedFile | null> {
  if (!isDrivePickerConfigured()) {
    throw new Error('Picker Google Drive non configurato (VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_API_KEY)')
  }
  await ensurePickerLoaded()
  const token = await getAccessToken()
  const g = window.google!

  // selectFolders (deprecato) equivale a mode:'folder'
  const mode: PickerMode = opts.mode ?? (opts.selectFolders ? 'folder' : 'file')

  return new Promise((resolve) => {
    // 'folder' → vista Cartelle (solo cartelle selezionabili).
    // 'fileOrFolder'/'file' → vista Documenti che include le cartelle; in
    // fileOrFolder anche la cartella è selezionabile oltre ai file.
    const view = mode === 'folder' ? new g.picker.DocsView(g.picker.ViewId.FOLDERS) : new g.picker.DocsView()
    view.setIncludeFolders(true)
    view.setSelectFolderEnabled(mode === 'folder' || mode === 'fileOrFolder')
    view.setEnableDrives(true)
    // setParent vincola la vista al contenuto della cartella (nessuna
    // navigazione verso l'alto): con locked=true è il lucchetto della Stima.
    if (opts.rootId) view.setParent(opts.rootId)

    const builder = new g.picker.PickerBuilder()
    builder.addView(view)
    // Scheda "Carica": consente di caricare file direttamente nella cartella
    // di contesto (presale requisiti/stima). Richiede una rootId.
    if (opts.allowUpload && opts.rootId) {
      const upload = new g.picker.DocsUploadView()
      upload.setParent(opts.rootId)
      upload.setIncludeFolders(true)
      builder.addView(upload)
    }
    builder.setOAuthToken(token)
    builder.setDeveloperKey(API_KEY)
    builder.enableFeature(g.picker.Feature.SUPPORT_DRIVES)
    // Con upload abilitato si possono caricare/selezionare più file; in tal
    // caso il "link" salvato è la cartella che li contiene (vedi callback).
    builder.setMaxItems(opts.allowUpload ? 20 : 1)
    if (opts.title) builder.setTitle(opts.title)
    const mapDoc = (doc: PickerDocument): DrivePickedFile => ({
      url: doc[g.picker.Document.URL] ?? '',
      fileId: doc[g.picker.Document.ID] ?? '',
      name: doc[g.picker.Document.NAME] ?? '',
      parentId: doc[g.picker.Document.PARENT_ID] ?? null,
      isFolder: (doc[g.picker.Document.MIME_TYPE] ?? '') === FOLDER_MIME,
    })
    builder.setCallback((data: PickerCallbackData) => {
      const action = data[g.picker.Response.ACTION]
      if (action === g.picker.Action.PICKED) {
        const docs = data[g.picker.Response.DOCUMENTS] as PickerDocument[] | undefined
        if (!docs || docs.length === 0) { resolve(null); return }
        if (docs.length === 1) { resolve(mapDoc(docs[0])); return }
        // Più elementi (upload/selezione multipla): tutti nella stessa cartella
        // → il link è la cartella contenitrice, non il singolo file.
        const parent = docs[0][g.picker.Document.PARENT_ID]
        resolve(parent
          ? { url: driveFolderUrl(parent), fileId: parent, name: '', parentId: null, isFolder: true }
          : mapDoc(docs[0]))
      } else if (action === g.picker.Action.CANCEL) {
        resolve(null)
      }
    })
    builder.build().setVisible(true)
  })
}

// ── Drive API (REST, col token utente) ──────────────────────────────────────

async function driveApiToken(): Promise<string> {
  if (!isDrivePickerConfigured()) {
    throw new Error('Integrazione Google Drive non configurata (VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_API_KEY)')
  }
  await ensureGsiLoaded()
  return getAccessToken()
}

// Crea un Google Doc vuoto nella cartella indicata (shared drive inclusi) e
// ritorna link e id. Usato dal bottone "Crea nuovo doc" della fase Stima.
export async function createDriveDoc(name: string, parentId: string): Promise<{ url: string; fileId: string }> {
  const token = await driveApiToken()
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.document',
      parents: [parentId],
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(data.error?.message ?? `Errore Drive ${res.status}`)
  }
  const { id } = await res.json() as { id: string }
  return { url: `https://docs.google.com/document/d/${id}/edit`, fileId: id }
}

// Cartella che contiene un file Drive (null se non determinabile). Usata per
// aprire il picker della Stima nella cartella giusta anche quando l'analisi
// iniziale è stata incollata a mano.
export async function getParentFolderId(fileId: string): Promise<string | null> {
  const token = await driveApiToken()
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=parents`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return null
  const data = await res.json() as { parents?: string[] }
  return data.parents?.[0] ?? null
}

// ── Creazione cartelle (binding per ID sui clienti/progetti) ────────────────
// Il tool crea SOLO cartelle nuove: mai rinomine, spostamenti o cancellazioni
// di contenuti esistenti su Drive.

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

// Cartella genitore corrente di una cartella/file (null se non determinabile).
async function getParents(fileId: string): Promise<string[]> {
  const token = await driveApiToken()
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=parents`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return []
  const data = await res.json() as { parents?: string[] }
  return data.parents ?? []
}

// Sposta una cartella sotto un nuovo genitore (mantiene lo STESSO id, quindi il
// binding driveFolderId resta valido). Rimuove tutti i genitori attuali. Usata
// dall'archiviazione (sposta il progetto sotto "Progetti chiusi").
export async function moveDriveFolder(folderId: string, newParentId: string): Promise<void> {
  const token = await driveApiToken()
  const current = await getParents(folderId)
  if (current.length === 1 && current[0] === newParentId) return // già lì
  const params = new URLSearchParams({ supportsAllDrives: 'true', addParents: newParentId, fields: 'id,parents' })
  if (current.length) params.set('removeParents', current.join(','))
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${params.toString()}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(data.error?.message ?? `Errore Drive ${res.status}`)
  }
}

// Trova una sottocartella per nome dentro parentId, creandola se non esiste.
export async function ensureChildFolder(parentId: string, name: string): Promise<string> {
  const existing = await findChildFolderByName(parentId, name)
  if (existing) return existing
  const { folderId } = await createDriveFolder(name, parentId)
  return folderId
}

// Crea una cartella (shared drive inclusi) e ritorna id + link.
export async function createDriveFolder(name: string, parentId: string): Promise<{ folderId: string; url: string }> {
  const token = await driveApiToken()
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(data.error?.message ?? `Errore Drive ${res.status}`)
  }
  const { id } = await res.json() as { id: string }
  return { folderId: id, url: driveFolderUrl(id) }
}

// Nodo del template alberatura (stessa forma di /api/config/drive-tree):
// il nodo con `analisi: true` è la cartella "Analisi dei Requisiti" salvata
// come radice del picker presale/roadmap.
export interface DriveTreeNode {
  name: string
  analisi?: boolean
  children?: DriveTreeNode[]
}

// Crea ricorsivamente l'alberatura del template dentro parentId e ritorna
// l'ID del nodo marcato `analisi: true` (null se il template non lo prevede).
// Creazione sequenziale: mantiene l'ordine e resta sotto i rate limit Drive.
export async function createFolderTree(nodes: DriveTreeNode[], parentId: string): Promise<{ analisiFolderId: string | null }> {
  let analisiFolderId: string | null = null
  for (const node of nodes) {
    const { folderId } = await createDriveFolder(node.name, parentId)
    if (node.analisi && analisiFolderId === null) analisiFolderId = folderId
    if (node.children?.length) {
      const nested = await createFolderTree(node.children, folderId)
      if (analisiFolderId === null) analisiFolderId = nested.analisiFolderId
    }
  }
  return { analisiFolderId }
}

// Cerca una sottocartella per nome esatto dentro parentId (null se assente).
// Usata quando si collega una cartella progetto esistente: risolve la
// "Analisi dei Requisiti" senza chiederla all'utente.
export async function findChildFolderByName(parentId: string, name: string): Promise<string | null> {
  const token = await driveApiToken()
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const params = new URLSearchParams({
    q,
    fields: 'files(id)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    pageSize: '1',
  })
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = await res.json() as { files?: Array<{ id: string }> }
  return data.files?.[0]?.id ?? null
}

// Cerca una cartella per nome esatto in TUTTO uno shared drive (null se assente
// o ambigua). Usata per ricavare le ancore "Sviluppo - Progetti in gestione" e
// "Prodotti" dal Drive Sviluppo, senza doverle configurare a mano.
export async function findFolderInDriveByName(driveId: string, name: string): Promise<string | null> {
  const token = await driveApiToken()
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const params = new URLSearchParams({
    q,
    fields: 'files(id)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'drive',
    driveId,
    pageSize: '2',
  })
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = await res.json() as { files?: Array<{ id: string }> }
  // Solo se univoca: evita match ambigui su nomi ripetuti.
  return data.files?.length === 1 ? data.files[0].id : null
}

// Come sopra ma tollerante a spazi/varianti: cerca per "name contains" e
// confronta il nome TRIMMATO (es. la cartella "Sviluppo - Progetti chiusi " ha
// uno spazio finale su Drive). Usata per le ancore Progetti chiusi / Prodotti
// dismessi dell'archiviazione.
export async function findFolderByTrimmedName(driveId: string, trimmedName: string): Promise<string | null> {
  const token = await driveApiToken()
  const q = `name contains '${trimmedName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'drive',
    driveId,
    pageSize: '50',
  })
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = await res.json() as { files?: Array<{ id: string; name: string }> }
  const match = (data.files ?? []).find(f => (f.name ?? '').trim() === trimmedName)
  return match?.id ?? null
}

// Estrae l'ID cartella da un link Drive a cartella/shared drive (per i link
// incollati a mano in "Collega cartella esistente").
export function extractDriveFolderId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/(?:folders|shared-drives)\/([\w-]{10,})/)
  return m?.[1] ?? null
}

// Estrae l'ID file da un link Drive/Docs (documenti, fogli, presentazioni,
// file generici). null se il link non è riconoscibile.
export function extractDriveFileId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/(?:d|file\/d)\/([\w-]{10,})/) ?? url.match(/[?&]id=([\w-]{10,})/)
  return m?.[1] ?? null
}

// Link http(s) valido? Stessa regola del backend: i valori storici non
// conformi vengono mostrati come "link non valido" invece che come anchor.
export function isValidHttpUrl(value: string | null | undefined): boolean {
  return !!value && /^https?:\/\/\S+$/i.test(value.trim())
}
