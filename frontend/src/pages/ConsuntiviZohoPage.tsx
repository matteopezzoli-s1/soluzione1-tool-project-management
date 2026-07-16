import { useState, useEffect, useCallback, useMemo } from 'react'
import { ZohoImportModal, type ZohoSelectedProject } from '../components/ZohoImportModal'
import './ConsuntiviZohoPage.css'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

// ─── Consuntivi Zoho ──────────────────────────────────────────────────────────
// Pagina di primo livello (ruoli Board, PM, Account — gating anche lato API):
// selezione dei progetti Zoho Projects da cui importare le consuntivazioni
// (persistita in app_config) + import con preview diff. Sostituisce l'export
// CSV manuale del timesheet: stessa logica di matching sui codici GO-ORDV nel
// nome milestone, stessa conferma via bulk-consuntivato.

interface ZohoProjectRow {
  id: string
  name: string
  selected: boolean
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}
function authHeadersJson(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

interface ConsuntiviZohoPageProps { token: string }

export default function ConsuntiviZohoPage({ token }: ConsuntiviZohoPageProps) {
  const [projects,   setProjects]   = useState<ZohoProjectRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [pageErr,    setPageErr]    = useState<string | null>(null)
  const [okMsg,      setOkMsg]      = useState<string | null>(null)
  const [filter,     setFilter]     = useState('')
  const [saving,     setSaving]     = useState(false)
  const [dirty,      setDirty]      = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const fetchProjects = useCallback(async () => {
    setLoading(true); setPageErr(null)
    try {
      const res = await fetch(`${API_URL}/api/zoho/projects`, { headers: authHeaders(token) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Errore ${res.status}`)
      }
      const data = (await res.json()) as { projects: ZohoProjectRow[] }
      setProjects(data.projects)
      setDirty(false)
    } catch (e) {
      setPageErr(e instanceof Error ? e.message : 'Impossibile caricare i progetti da Zoho.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { queueMicrotask(() => { fetchProjects() }) }, [fetchProjects])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects
  }, [projects, filter])

  const selectedCount = projects.filter(p => p.selected).length

  const toggle = (id: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p))
    setDirty(true); setOkMsg(null)
  }

  const toggleAllVisible = (checked: boolean) => {
    const visibleIds = new Set(visible.map(p => p.id))
    setProjects(prev => prev.map(p => visibleIds.has(p.id) ? { ...p, selected: checked } : p))
    setDirty(true); setOkMsg(null)
  }

  const saveSelection = async (): Promise<boolean> => {
    setSaving(true); setPageErr(null)
    try {
      const res = await fetch(`${API_URL}/api/zoho/selection`, {
        method: 'PUT',
        headers: authHeadersJson(token),
        body: JSON.stringify({ selectedIds: projects.filter(p => p.selected).map(p => p.id) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPageErr((data as { error?: string }).error ?? `Errore ${res.status}`)
        return false
      }
      setDirty(false)
      setOkMsg('Selezione salvata.')
      return true
    } catch {
      setPageErr('Errore di rete. Riprova.')
      return false
    } finally {
      setSaving(false)
    }
  }

  // L'import lavora sempre sulla selezione visibile: se ci sono modifiche
  // non salvate le persiste prima di aprire il modal.
  const handleImport = async () => {
    if (dirty && !(await saveSelection())) return
    setOkMsg(null)
    setImportOpen(true)
  }

  const selectedProjects: ZohoSelectedProject[] = projects
    .filter(p => p.selected)
    .map(p => ({ id: p.id, name: p.name }))

  return (
    <div className="cz-page">
      <div className="cz-topbar">
        <h1 className="cz-title">Consuntivi Zoho</h1>
        <p className="cz-subtitle">Importa le giornate consuntivate da Zoho Projects nelle attività</p>
      </div>

      {loading ? (
        <div className="cz-skeleton-list">{[...Array(6)].map((_, i) => <div key={i} className="cz-skeleton" />)}</div>
      ) : (
        <div className="cz-content">
          <div className="cz-actionbar">
            <p className="cz-count">
              {projects.length} progetti attivi su Zoho Projects · <strong>{selectedCount}</strong> selezionati per l'import
            </p>
            <div className="cz-actions">
              <button className="cz-btn cz-btn--ghost" type="button" onClick={saveSelection}
                disabled={saving || !dirty}>
                {saving ? 'Salvataggio…' : 'Salva selezione'}
              </button>
              <button className="cz-btn cz-btn--primary" type="button" onClick={handleImport}
                disabled={saving || selectedCount === 0}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" width="15" height="15" aria-hidden="true">
                  <path d="M10 3v10M6 9l4 4 4-4M4 17h12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Importa consuntivazioni
              </button>
            </div>
          </div>

          {pageErr && <p className="cz-page-error" role="alert">{pageErr}</p>}
          {okMsg && <p className="cz-ok-banner" role="status">{okMsg}</p>}

          {projects.length > 0 && (
            <>
              <div className="cz-toolbar">
                <input
                  className="cz-search"
                  type="search"
                  placeholder="Cerca progetto…"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  aria-label="Cerca progetto Zoho"
                />
                <label className="cz-select-all">
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && visible.every(p => p.selected)}
                    onChange={e => toggleAllVisible(e.target.checked)}
                  />
                  Seleziona {filter.trim() ? 'i risultati' : 'tutti'}
                </label>
              </div>

              <div className="cz-table-wrap">
                <table className="cz-table" aria-label="Progetti Zoho">
                  <thead>
                    <tr>
                      <th scope="col" className="cz-th cz-th--chk"></th>
                      <th scope="col" className="cz-th">Progetto Zoho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(p => (
                      <tr key={p.id} className="cz-row" onClick={() => toggle(p.id)}>
                        <td className="cz-cell cz-cell--chk">
                          <input
                            type="checkbox"
                            checked={p.selected}
                            onChange={() => toggle(p.id)}
                            onClick={e => e.stopPropagation()}
                            aria-label={`Seleziona ${p.name}`}
                          />
                        </td>
                        <td className="cz-cell">{p.name}</td>
                      </tr>
                    ))}
                    {visible.length === 0 && (
                      <tr><td className="cz-cell" colSpan={2}>Nessun progetto corrisponde alla ricerca.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {importOpen && (
        <ZohoImportModal
          token={token}
          projects={selectedProjects}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  )
}
