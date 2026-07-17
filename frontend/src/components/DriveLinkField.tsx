import { useState } from 'react'
import { isDrivePickerConfigured, openDrivePicker, type DrivePickedFile } from '../lib/googleDrive'
import './DriveLinkField.css'

// ─── DriveLinkField ───────────────────────────────────────────────────────────
// Campo link "dual-mode": URL digitato a mano oppure scelto dal Google Picker
// aperto sulla radice indicata (drive condiviso configurato in Impostazioni).
// Il bottone Drive compare solo se il picker è configurato (env Vite) e la
// radice è disponibile; altrimenti resta il solo input manuale.

interface DriveLinkFieldProps {
  id: string
  value: string
  onChange: (url: string) => void
  // Metadati del file scelto via picker (fileId, cartella): usati dal presale
  // per memorizzare la cartella dell'analisi
  onPicked?: (file: DrivePickedFile) => void
  // Radice del picker: ID di shared drive o cartella. Assente → solo input.
  rootId?: string
  // true = navigazione vincolata alla cartella rootId (fase Stima)
  locked?: boolean
  // Risoluzione asincrona della radice al momento del click (es. Stima:
  // ricava la cartella dell'analisi da un link incollato a mano). Se torna
  // null si usano rootId/locked statici.
  resolveRoot?: () => Promise<{ rootId?: string; locked?: boolean } | null>
  pickerTitle?: string
  placeholder?: string
  inputClassName?: string
}

export function DriveLinkField({
  id, value, onChange, onPicked, rootId, locked, resolveRoot, pickerTitle, placeholder, inputClassName,
}: DriveLinkFieldProps) {
  const [picking, setPicking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pickerAvailable = isDrivePickerConfigured() && (!!rootId || !!resolveRoot)

  const handlePick = async () => {
    setPicking(true); setErr(null)
    try {
      let effRootId = rootId
      let effLocked = locked
      if (resolveRoot) {
        const r = await resolveRoot().catch(() => null)
        if (r) {
          effRootId = r.rootId ?? rootId
          effLocked = r.locked ?? locked
        }
      }
      const file = await openDrivePicker({ rootId: effRootId, locked: effLocked, title: pickerTitle })
      if (file) {
        onChange(file.url)
        onPicked?.(file)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Errore nell\'apertura del picker Drive.')
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="dlf">
      <div className="dlf-row">
        <input
          id={id}
          className={inputClassName ?? 'dlf-input'}
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? 'https://drive.google.com/…'}
        />
        {pickerAvailable && (
          <button
            className="dlf-btn"
            type="button"
            onClick={handlePick}
            disabled={picking}
            title={locked ? 'Scegli il file dalla cartella dell\'analisi' : 'Scegli il file da Google Drive'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15" aria-hidden="true">
              <path d="M8 3h8l6 10-4 7H6l-4-7L8 3z" strokeLinejoin="round" />
              <path d="M8 3l6 10M16 3l-6 10h12M2 13h12l-4 7" strokeLinejoin="round" />
            </svg>
            {picking ? 'Apertura…' : 'Scegli da Drive'}
          </button>
        )}
      </div>
      {err && <span className="dlf-err" role="alert">{err}</span>}
    </div>
  )
}

