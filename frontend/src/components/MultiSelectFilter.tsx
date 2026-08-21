import { useState, useRef, useEffect, useMemo } from 'react'
import './MultiSelectFilter.css'

// ─── MultiSelectFilter ────────────────────────────────────────────────────────
// Filtro a selezione multipla: bottone + pannello con checkbox. Sostituisce
// la <select> a valore singolo dove serve incrociare più valori.
//
// Convenzione: **selezione vuota = nessun filtro** (tutti i valori passano).
// Chi consuma il valore fa `sel.length === 0 || sel.includes(x)`, così non
// serve un'opzione "Tutti" fittizia nell'elenco.

export interface MultiSelectOption {
  value: string
  label: string
  // Pallino colorato a sinistra (es. colore dello stato)
  colore?: string
}

interface MultiSelectFilterProps {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  // Etichetta a selezione vuota, es. "Tutti gli stati"
  allLabel: string
  // Nome plurale per il riassunto "3 stati"
  itemsLabel: string
  ariaLabel: string
  // Campo di ricerca nel pannello: per elenchi lunghi (clienti, PM)
  searchable?: boolean
  className?: string
}

export function MultiSelectFilter({
  options, selected, onChange, allLabel, itemsLabel, ariaLabel,
  searchable, className,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  // Il pannello si allinea a destra se a sinistra sborderebbe dalla finestra
  const [allineaDx, setAllineaDx] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  // Chiusura su click fuori e su Escape: il pannello è un popover, non un
  // modal, quindi non intrappola il focus e va chiuso dai bordi.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const apri = () => {
    if (open) { setOpen(false); return }
    // Misura prima di aprire: il pannello è più largo del bottone e sugli
    // ultimi filtri della barra uscirebbe dallo schermo.
    const r = btnRef.current?.getBoundingClientRect()
    setAllineaDx(r ? r.left + MSF_PANEL_W > window.innerWidth - 16 : false)
    setQuery('')
    setOpen(true)
  }

  const toggle = (value: string) =>
    onChange(selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value])

  // Solo le opzioni ancora esistenti contano per l'etichetta: un valore
  // selezionato e poi sparito (stato eliminato, cliente rimosso) non deve
  // far leggere "2 stati" quando a schermo se ne vede uno.
  const scelte = useMemo(
    () => options.filter((o) => selected.includes(o.value)), [options, selected])

  const etichetta = scelte.length === 0
    ? allLabel
    : scelte.length === 1 ? scelte[0].label : `${scelte.length} ${itemsLabel}`

  const visibili = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === '' ? options : options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  return (
    <div className={`msf${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button ref={btnRef} type="button"
        className={`msf-btn${scelte.length > 0 ? ' msf-btn--on' : ''}`}
        aria-label={ariaLabel} aria-expanded={open} aria-haspopup="true"
        onClick={apri}>
        <span className="msf-btn-label">{etichetta}</span>
        {scelte.length > 1 && <span className="msf-badge">{scelte.length}</span>}
        <svg className="msf-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.5" width="14" height="14" aria-hidden="true">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={`msf-panel${allineaDx ? ' msf-panel--dx' : ''}`}
          role="group" aria-label={ariaLabel}>
          {searchable && (
            <input className="msf-search" type="search" value={query} autoFocus
              placeholder="Cerca…" aria-label={`Cerca in ${ariaLabel}`}
              onChange={(e) => setQuery(e.target.value)} />
          )}
          <div className="msf-list">
            {visibili.length === 0 ? (
              <p className="msf-vuoto">Nessun risultato.</p>
            ) : visibili.map((o) => (
              <label key={o.value} className="msf-opt">
                <input type="checkbox" checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)} />
                {o.colore && (
                  <span className="msf-dot" style={{ background: o.colore }} aria-hidden="true" />
                )}
                <span className="msf-opt-label">{o.label}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button type="button" className="msf-clear" onClick={() => onChange([])}>
              Deseleziona tutto
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Larghezza del pannello, tenuta in sync con .msf-panel nel CSS: serve a
// decidere l'allineamento prima che il pannello esista nel DOM.
const MSF_PANEL_W = 240
