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
}

export interface OpenDrivePickerOptions {
  // Radice di navigazione: ID di uno shared drive o di una cartella
  rootId?: string
  // Se true l'utente resta vincolato alla cartella rootId (usato dalla fase
  // Stima: il Picker con setParent non offre navigazione verso l'alto)
  locked?: boolean
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
        DocsView: new (viewId?: unknown) => {
          setIncludeFolders: (v: boolean) => unknown
          setSelectFolderEnabled: (v: boolean) => unknown
          setParent: (id: string) => unknown
          setEnableDrives: (v: boolean) => unknown
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
        Document: { ID: string; NAME: string; URL: string; PARENT_ID: string }
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

  return new Promise((resolve) => {
    const view = new g.picker.DocsView()
    view.setIncludeFolders(true)
    view.setSelectFolderEnabled(false)
    view.setEnableDrives(true)
    // setParent vincola la vista al contenuto della cartella (nessuna
    // navigazione verso l'alto): con locked=true è il lucchetto della Stima.
    if (opts.rootId) view.setParent(opts.rootId)

    const builder = new g.picker.PickerBuilder()
    builder.addView(view)
    builder.setOAuthToken(token)
    builder.setDeveloperKey(API_KEY)
    builder.enableFeature(g.picker.Feature.SUPPORT_DRIVES)
    builder.setMaxItems(1)
    if (opts.title) builder.setTitle(opts.title)
    builder.setCallback((data: PickerCallbackData) => {
      const action = data[g.picker.Response.ACTION]
      if (action === g.picker.Action.PICKED) {
        const docs = data[g.picker.Response.DOCUMENTS] as PickerDocument[] | undefined
        const doc = docs?.[0]
        if (!doc) { resolve(null); return }
        resolve({
          url: doc[g.picker.Document.URL] ?? '',
          fileId: doc[g.picker.Document.ID] ?? '',
          name: doc[g.picker.Document.NAME] ?? '',
          parentId: doc[g.picker.Document.PARENT_ID] ?? null,
        })
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
