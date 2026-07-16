import { useState, useEffect, useRef, useCallback } from 'react'
import { SectionModal } from './SectionModal'
import './ZohoImportModal.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZohoSelectedProject {
  id: string
  name: string
}

interface PreviewRow {
  attivitaId: string
  cliente: string
  progetto: string
  attivita: string
  codice: string
  ore: number
  attuale: number | null
  nuovo: number
}

interface ZohoImportModalProps {
  token: string
  projects: ZohoSelectedProject[]
  onClose: () => void
}

type Phase = 'fetch' | 'preview' | 'done' | 'error'

const fmt = (n: number | null): string =>
  n === null ? '—' : n.toLocaleString('it-IT', { maximumFractionDigits: 2 })

// ─── ZohoImportModal ─────────────────────────────────────────────────────────
// Scarica i consuntivi da Zoho un progetto per volta (rate limit), somma le
// ore per codice GO-ORDV su tutti i progetti selezionati, poi mostra la diff
// attuale/nuovo come l'import CSV manuale. La conferma riusa
// PATCH /api/attivita/bulk-consuntivato.

export function ZohoImportModal({ token, projects, onClose }: ZohoImportModalProps) {
  const [phase,        setPhase]        = useState<Phase>('fetch')
  const [progress,     setProgress]     = useState({ done: 0, name: '' })
  const [rows,         setRows]         = useState<PreviewRow[]>([])
  const [notFound,     setNotFound]     = useState<string[]>([])
  const [fetchWarns,   setFetchWarns]   = useState<string[]>([])
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set())
  const [importing,    setImporting]    = useState(false)
  const [err,          setErr]          = useState<string | null>(null)
  const [updatedCount, setUpdatedCount] = useState(0)
  const cancelledRef = useRef(false)
  const startedRef   = useRef(false)

  const handleClose = useCallback(() => {
    cancelledRef.current = true
    onClose()
  }, [onClose])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function run() {
      const merged = new Map<string, number>() // codice GO-ORDV → ore totali
      const warns: string[] = []

      for (let i = 0; i < projects.length; i++) {
        if (cancelledRef.current) return
        const p = projects[i]
        setProgress({ done: i, name: p.name })
        try {
          const res = await fetch(`${API_URL}/api/zoho/consuntivi/${p.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            warns.push(`${p.name}: ${(data as { error?: string }).error ?? `errore ${res.status}`}`)
            continue
          }
          const data = (await res.json()) as { codes: Array<{ code: string; ore: number }> }
          for (const { code, ore } of data.codes) {
            merged.set(code, (merged.get(code) ?? 0) + ore)
          }
        } catch {
          warns.push(`${p.name}: errore di rete`)
        }
      }
      if (cancelledRef.current) return
      setProgress({ done: projects.length, name: '' })
      setFetchWarns(warns)

      if (warns.length === projects.length && projects.length > 0) {
        setErr('Nessun progetto scaricato: controlla la configurazione Zoho e riprova.')
        setPhase('error')
        return
      }

      try {
        const res = await fetch(`${API_URL}/api/zoho/import/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            codes: [...merged].map(([code, ore]) => ({ code, ore: Math.round(ore * 100) / 100 })),
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? `Errore ${res.status}`)
        }
        const data = (await res.json()) as { matched: PreviewRow[]; notFound: string[] }
        if (cancelledRef.current) return
        setRows(data.matched)
        setNotFound(data.notFound)
        setSelectedIds(new Set(data.matched.map((r) => r.attivitaId)))
        setPhase('preview')
      } catch (e) {
        if (cancelledRef.current) return
        setErr(e instanceof Error ? e.message : 'Errore durante il calcolo della diff.')
        setPhase('error')
      }
    }
    run()
  }, [projects, token])

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(rows.map((r) => r.attivitaId)) : new Set())
  }

  async function handleImport() {
    const updates = rows
      .filter((r) => selectedIds.has(r.attivitaId))
      .map((r) => ({ id: r.attivitaId, giornateConsuntivate: r.nuovo }))
    if (updates.length === 0) return
    setImporting(true)
    setErr(null)
    try {
      const res = await fetch(`${API_URL}/api/attivita/bulk-consuntivato`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return
      }
      setUpdatedCount(updates.length)
      setPhase('done')
    } catch {
      setErr('Errore di rete. Riprova.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <SectionModal onClose={handleClose} labelledBy="zi-title">
      <div className="zi-modal">
        <div className="zi-header">
          <h2 id="zi-title" className="zi-title">Importa consuntivi da Zoho Projects</h2>
          <button className="zi-close" type="button" onClick={handleClose} aria-label="Chiudi">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Fase 1: download da Zoho ── */}
        {phase === 'fetch' && (
          <div className="zi-body">
            <div className="zi-progress-wrap">
              <div className="zi-progress-bar" role="progressbar"
                aria-valuemin={0} aria-valuemax={projects.length} aria-valuenow={progress.done}>
                <div
                  className="zi-progress-fill"
                  style={{ width: `${projects.length ? (progress.done / projects.length) * 100 : 0}%` }}
                />
              </div>
              <p className="zi-progress-label">
                {progress.done}/{projects.length} progetti
                {progress.name && <> — <strong>{progress.name}</strong></>}
              </p>
              <p className="zi-progress-hint">
                Lettura timelog e milestone da Zoho Projects: può richiedere qualche minuto
                a seconda dello storico dei progetti selezionati.
              </p>
            </div>
          </div>
        )}

        {/* ── Fase errore ── */}
        {phase === 'error' && (
          <div className="zi-body">
            <p className="zi-error" role="alert">{err}</p>
            {fetchWarns.length > 0 && (
              <ul className="zi-warn-list">
                {fetchWarns.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* ── Fase 2: preview con diff ── */}
        {phase === 'preview' && (
          <div className="zi-body">
            <p className="zi-summary">
              <strong>{rows.length}</strong> attività con corrispondenza
              {notFound.length > 0 && <> · <strong>{notFound.length}</strong> codici non trovati</>}
            </p>

            {fetchWarns.length > 0 && (
              <div className="zi-warn-box" role="alert">
                <span className="zi-warn-title">Progetti non scaricati (esclusi dal totale):</span>
                <ul className="zi-warn-list">
                  {fetchWarns.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {rows.length > 0 ? (
              <>
                <div className="zi-table-hd">
                  <span className="zi-section-title">Attività da aggiornare</span>
                  <label className="zi-select-all">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.attivitaId))}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                    Seleziona tutti
                  </label>
                </div>
                <div className="zi-table-wrap">
                  <table className="zi-table">
                    <thead>
                      <tr>
                        <th className="zi-th zi-th--chk"></th>
                        <th className="zi-th">Cliente</th>
                        <th className="zi-th">Progetto</th>
                        <th className="zi-th zi-th--wide">Attività</th>
                        <th className="zi-th">Codice GO</th>
                        <th className="zi-th zi-th--num">Attuale (gg)</th>
                        <th className="zi-th zi-th--num">Nuovo (gg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const checked = selectedIds.has(r.attivitaId)
                        const curr    = r.attuale ?? 0
                        const isUp    = r.nuovo > curr
                        const isDown  = r.nuovo < curr
                        return (
                          <tr
                            key={r.attivitaId}
                            className={`zi-row${!checked ? ' zi-row--dim' : ''}`}
                            onClick={() => toggleOne(r.attivitaId)}
                          >
                            <td className="zi-td zi-td--chk">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleOne(r.attivitaId)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="zi-td zi-td--trunc">{r.cliente}</td>
                            <td className="zi-td zi-td--trunc">{r.progetto}</td>
                            <td className="zi-td">{r.attivita}</td>
                            <td className="zi-td zi-td--code">{r.codice}</td>
                            <td className="zi-td zi-td--num">{fmt(r.attuale)}</td>
                            <td className={`zi-td zi-td--num${isUp ? ' zi-td--up' : isDown ? ' zi-td--down' : ''}`}>
                              {fmt(r.nuovo)}{isUp ? ' ↑' : isDown ? ' ↓' : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="zi-empty">
                Nessuna attività corrisponde ai codici GO-ORDV trovati nei progetti selezionati.
              </p>
            )}

            {notFound.length > 0 && (
              <div className="zi-notfound">
                <span className="zi-section-title">Codici non trovati nell'applicazione</span>
                <ul className="zi-notfound-list">
                  {notFound.map((code) => <li key={code}>{code}</li>)}
                </ul>
              </div>
            )}

            {err && <p className="zi-error" role="alert">{err}</p>}
          </div>
        )}

        {/* ── Fase 3: esito ── */}
        {phase === 'done' && (
          <div className="zi-body">
            <div className="zi-done">
              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" width="40" height="40" aria-hidden="true">
                <circle cx="24" cy="24" r="20" />
                <path d="M15 24l6 6 12-12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="zi-done-msg">
                <strong>{updatedCount}</strong> {updatedCount === 1 ? 'attività aggiornata' : 'attività aggiornate'}
              </p>
            </div>
          </div>
        )}

        <div className="zi-footer">
          {phase === 'preview' ? (
            <>
              <button className="zi-btn zi-btn--ghost" type="button" onClick={handleClose} disabled={importing}>
                Annulla
              </button>
              <button
                className="zi-btn zi-btn--primary"
                type="button"
                disabled={selectedIds.size === 0 || importing}
                onClick={handleImport}
              >
                {importing ? 'Importazione…' : `Importa ${selectedIds.size} attività`}
              </button>
            </>
          ) : (
            <button className="zi-btn zi-btn--ghost" type="button" onClick={handleClose}>
              Chiudi
            </button>
          )}
        </div>
      </div>
    </SectionModal>
  )
}
