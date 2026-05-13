import { useState, useRef, useCallback, useEffect } from 'react'
import type { DragEvent } from 'react'
import './ImportCSVModal.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

const EXPECTED_COLS = [
  'CLIENTE', 'PROGETTO', 'ATTIVITA',
  'Nome Account', 'Cognome Account', 'Mail account',
  'Nome PM', 'Cognome PM', 'Mail PM',
  'Stima giornate', 'Consuntivate giornate',
  'Ordine GO', 'STATO', 'INIZIO', 'DEADLINE', 'Note',
]

// ── Types ──────────────────────────────────────────────────────

interface CountPair { created: number; updated: number }
export interface ImportResult {
  clienti:  CountPair
  account:  CountPair
  pm:       CountPair
  progetti: CountPair
  attivita: CountPair
  errors:   Array<{ row: number; field: string; message: string }>
}

interface PreviewRow {
  cliente:    string
  progetto:   string
  attivita:   string
  account:    string
  pm:         string
  stato:      string
  hasWarning: boolean
}

export interface ImportCSVModalProps {
  token:              string
  onClose:            () => void
  onImportComplete?:  (result: ImportResult) => void
}

type Step = 'select' | 'preview' | 'result'

// ── Simple browser CSV tokenizer ───────────────────────────────

function tokenizeCSV(text: string): string[][] {
  const result: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQ  = false

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i]
    const next = text[i + 1]
    if (ch === '"') {
      if (inQ && next === '"') { cell += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      row.push(cell.trim()); cell = ''
    } else if (ch === '\r' && next === '\n' && !inQ) {
      i++; row.push(cell.trim()); cell = ''; result.push(row); row = []
    } else if (ch === '\n' && !inQ) {
      row.push(cell.trim()); cell = ''; result.push(row); row = []
    } else {
      cell += ch
    }
  }
  if (cell || row.length > 0) { row.push(cell.trim()); result.push(row) }
  return result
}

function parsePreview(text: string): {
  headers: string[]
  rows: PreviewRow[]
  totalRows: number
  missingCols: string[]
} {
  const all = tokenizeCSV(text).filter(r => r.some(c => c))
  // row[0] = blank/empty, row[1] = headers
  const headers: string[]   = all[1] ?? []
  const dataRows: string[][] = all.slice(2)

  const colIdx = (name: string) => headers.findIndex(h => h.trim() === name)
  const missing = EXPECTED_COLS.filter(c => colIdx(c) < 0)

  const toVal  = (r: string[], name: string) => (r[colIdx(name)] ?? '').trim()

  const rows: PreviewRow[] = dataRows.slice(0, 10).map(r => {
    const cliente  = toVal(r, 'CLIENTE')
    const progetto = toVal(r, 'PROGETTO')
    const account  = [toVal(r, 'Nome Account'), toVal(r, 'Cognome Account')].filter(Boolean).join(' ')
    const pm       = [toVal(r, 'Nome PM'), toVal(r, 'Cognome PM')].filter(Boolean).join(' ')
    return {
      cliente,
      progetto,
      attivita:   toVal(r, 'ATTIVITA'),
      account,
      pm,
      stato:      toVal(r, 'STATO'),
      hasWarning: !cliente || !progetto,
    }
  })

  return { headers, rows, totalRows: dataRows.length, missingCols: missing }
}

// ── Sub-components ─────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="csv-spinner" viewBox="0 0 24 24" fill="none" width="28" height="28" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4" strokeLinecap="round" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48" aria-hidden="true">
      <path d="M32 32l-8-8-8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 24v16" strokeLinecap="round" />
      <path d="M40.7 29.7A16 16 0 1 0 12 20h-2A10 10 0 0 0 10 40h28a8 8 0 0 0 2.7-10.3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CountCard({ label, count, type }: { label: string; count: number; type: 'created' | 'updated' | 'error' }) {
  return (
    <div className={`csv-count-card csv-count-card--${type}`}>
      <span className="csv-count-num">{count}</span>
      <span className="csv-count-label">{label}</span>
    </div>
  )
}

interface EntityRowProps {
  label: string
  created: number
  updated: number
}
function EntityRow({ label, created, updated }: EntityRowProps) {
  if (created === 0 && updated === 0) return null
  return (
    <div className="csv-entity-row">
      <span className="csv-entity-label">{label}</span>
      <div className="csv-entity-counts">
        {created > 0 && <span className="csv-pill csv-pill--created">{created} creati</span>}
        {updated > 0 && <span className="csv-pill csv-pill--updated">{updated} aggiornati</span>}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────

export default function ImportCSVModal({ token, onClose, onImportComplete }: ImportCSVModalProps) {
  const [step,          setStep]          = useState<Step>('select')
  const [file,          setFile]          = useState<File | null>(null)
  const [isDragging,    setIsDragging]    = useState(false)
  const [previewRows,   setPreviewRows]   = useState<PreviewRow[]>([])
  const [totalRows,     setTotalRows]     = useState(0)
  const [missingCols,   setMissingCols]   = useState<string[]>([])
  const [loading,       setLoading]       = useState(false)
  const [importResult,  setImportResult]  = useState<ImportResult | null>(null)
  const [importError,   setImportError]   = useState<string | null>(null)
  const [showAllErrors, setShowAllErrors] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Close on Escape
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const processFile = useCallback((f: File) => {
    setFile(f)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { rows, totalRows: total, missingCols: missing } = parsePreview(text)
      setPreviewRows(rows)
      setTotalRows(total)
      setMissingCols(missing)
      setStep('preview')
    }
    reader.readAsText(f, 'UTF-8')
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) processFile(f)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.csv')) processFile(f)
  }

  const handleDragOver  = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true)  }
  const handleDragLeave = ()                               => setIsDragging(false)

  const handleConfirm = async () => {
    if (!file) return
    setLoading(true)
    setImportError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`${API_URL}/api/import/csv`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      const data = await res.json()
      if (!res.ok) {
        setImportError((data as { error?: string }).error ?? `Errore ${res.status}`)
        setLoading(false)
        return
      }
      const result = (data as { result: ImportResult }).result
      setImportResult(result)
      setStep('result')
      onImportComplete?.(result)
    } catch {
      setImportError('Errore di rete. Controlla la connessione e riprova.')
    } finally {
      setLoading(false)
    }
  }

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !loading) onClose()
  }

  const warningRows = previewRows.filter(r => r.hasWarning).length
  const errorCount  = importResult?.errors.length ?? 0
  const visibleErrors = showAllErrors
    ? (importResult?.errors ?? [])
    : (importResult?.errors ?? []).slice(0, 5)

  // ── Render ──────────────────────────────────────────────────

  return (
    <div
      className="csv-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-modal-title"
      onClick={handleOverlayClick}
    >
      <div className="csv-modal">

        {/* Header */}
        <div className="csv-modal-header">
          <div className="csv-modal-title-wrap">
            {step === 'select'  && <span className="csv-step-badge">1/3</span>}
            {step === 'preview' && <span className="csv-step-badge">2/3</span>}
            {step === 'result'  && <span className="csv-step-badge">3/3</span>}
            <h2 id="csv-modal-title" className="csv-modal-title">
              {step === 'select'  && 'Importa CSV'}
              {step === 'preview' && 'Anteprima file'}
              {step === 'result'  && 'Importazione completata'}
            </h2>
          </div>
          {!loading && (
            <button className="csv-close" type="button" onClick={onClose} aria-label="Chiudi">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* ── Step 1: Selezione file ── */}
        {step === 'select' && (
          <div className="csv-modal-body">
            <div
              className={`csv-dropzone${isDragging ? ' csv-dropzone--active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Carica file CSV"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
            >
              <div className="csv-dropzone-icon">
                <IconUpload />
              </div>
              <p className="csv-dropzone-title">
                Trascina qui il file CSV<br />
                <span className="csv-dropzone-sub">oppure clicca per selezionare</span>
              </p>
              <span className="csv-dropzone-hint">Solo file .csv · max 10 MB</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="csv-file-input"
              onChange={handleFileInput}
              aria-hidden="true"
            />
            <div className="csv-format-hint">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
              </svg>
              <span>Il CSV deve avere una riga vuota iniziale, seguita dagli header nella riga 2</span>
            </div>
          </div>
        )}

        {/* ── Step 2: Anteprima ── */}
        {step === 'preview' && (
          <div className="csv-modal-body csv-modal-body--preview">
            <div className="csv-preview-meta">
              <div className="csv-meta-pills">
                <span className="csv-meta-pill">
                  <strong>{totalRows}</strong> righe trovate
                </span>
                {warningRows > 0 && (
                  <span className="csv-meta-pill csv-meta-pill--warn">
                    <strong>{warningRows}</strong> con dati mancanti
                  </span>
                )}
              </div>
              {missingCols.length > 0 && (
                <div className="csv-missing-cols" role="alert">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
                    <path d="M8 2L14 14H2L8 2z" strokeLinejoin="round" />
                    <path d="M8 7v3M8 11.5v.5" strokeLinecap="round" />
                  </svg>
                  Colonne mancanti: <strong>{missingCols.join(', ')}</strong>
                </div>
              )}
              {file && (
                <p className="csv-filename">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13" aria-hidden="true">
                    <path d="M4 2h6l3 3v9H4V2z" strokeLinejoin="round" />
                    <path d="M10 2v3h3" strokeLinejoin="round" />
                  </svg>
                  {file.name} <span className="csv-filesize">({(file.size / 1024).toFixed(0)} KB)</span>
                </p>
              )}
            </div>

            <div className="csv-table-wrap">
              <table className="csv-table" aria-label="Anteprima dati">
                <thead>
                  <tr>
                    <th className="csv-th">Cliente</th>
                    <th className="csv-th">Progetto</th>
                    <th className="csv-th">Attività</th>
                    <th className="csv-th">Account</th>
                    <th className="csv-th">PM</th>
                    <th className="csv-th">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i} className={`csv-tr${r.hasWarning ? ' csv-tr--warn' : ''}`}>
                      <td className="csv-td">{r.cliente || <span className="csv-empty">—</span>}</td>
                      <td className="csv-td">{r.progetto || <span className="csv-empty">—</span>}</td>
                      <td className="csv-td">{r.attivita || <span className="csv-empty">—</span>}</td>
                      <td className="csv-td">{r.account  || <span className="csv-empty">—</span>}</td>
                      <td className="csv-td">{r.pm       || <span className="csv-empty">—</span>}</td>
                      <td className="csv-td">{r.stato    || <span className="csv-empty">—</span>}</td>
                    </tr>
                  ))}
                  {totalRows > 10 && (
                    <tr className="csv-tr-more">
                      <td colSpan={6} className="csv-td csv-td--more">
                        … e altre {totalRows - 10} righe
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {importError && (
              <p className="csv-error-banner" role="alert">{importError}</p>
            )}
          </div>
        )}

        {/* ── Step 3: Risultato ── */}
        {step === 'result' && importResult && (
          <div className="csv-modal-body">
            <div className="csv-result-summary">
              <div className="csv-count-grid">
                <CountCard
                  label="create"
                  count={
                    importResult.clienti.created + importResult.account.created +
                    importResult.pm.created + importResult.progetti.created + importResult.attivita.created
                  }
                  type="created"
                />
                <CountCard
                  label="aggiornate"
                  count={
                    importResult.clienti.updated + importResult.account.updated +
                    importResult.pm.updated + importResult.progetti.updated + importResult.attivita.updated
                  }
                  type="updated"
                />
                {errorCount > 0 && (
                  <CountCard label="errori" count={errorCount} type="error" />
                )}
              </div>
            </div>

            <div className="csv-entities">
              <EntityRow label="Clienti"   created={importResult.clienti.created}  updated={importResult.clienti.updated}  />
              <EntityRow label="Account"   created={importResult.account.created}  updated={importResult.account.updated}  />
              <EntityRow label="PM"        created={importResult.pm.created}       updated={importResult.pm.updated}       />
              <EntityRow label="Progetti"  created={importResult.progetti.created} updated={importResult.progetti.updated} />
              <EntityRow label="Attività"  created={importResult.attivita.created} updated={importResult.attivita.updated} />
            </div>

            {errorCount > 0 && (
              <div className="csv-errors-section">
                <h3 className="csv-errors-title">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 5v3.5M8 10.5v.5" strokeLinecap="round" />
                  </svg>
                  {errorCount} {errorCount === 1 ? 'riga ignorata' : 'righe ignorate'}
                </h3>
                <ul className="csv-error-list">
                  {visibleErrors.map((e, i) => (
                    <li key={i} className="csv-error-item">
                      <span className="csv-error-row">Riga {e.row}</span>
                      {e.field && <span className="csv-error-field">{e.field}</span>}
                      <span className="csv-error-msg">{e.message}</span>
                    </li>
                  ))}
                </ul>
                {errorCount > 5 && (
                  <button
                    type="button"
                    className="csv-show-more"
                    onClick={() => setShowAllErrors(v => !v)}
                  >
                    {showAllErrors ? 'Mostra meno' : `Mostra tutti i ${errorCount} errori`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="csv-modal-footer">
          {step === 'select' && (
            <button type="button" className="csv-btn csv-btn--ghost" onClick={onClose}>
              Annulla
            </button>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                className="csv-btn csv-btn--ghost"
                onClick={() => { setStep('select'); setFile(null) }}
                disabled={loading}
              >
                Indietro
              </button>
              <button
                type="button"
                className="csv-btn csv-btn--primary"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading
                  ? <><Spinner /> Importazione in corso…</>
                  : <>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
                        <path d="M2 8l5 5 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Conferma e importa
                    </>
                }
              </button>
            </>
          )}

          {step === 'result' && (
            <>
              <button
                type="button"
                className="csv-btn csv-btn--ghost"
                onClick={() => { setStep('select'); setFile(null); setImportResult(null) }}
              >
                Importa un altro file
              </button>
              <button type="button" className="csv-btn csv-btn--primary" onClick={onClose}>
                Chiudi
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
