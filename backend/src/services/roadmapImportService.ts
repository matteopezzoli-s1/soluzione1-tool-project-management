import { parse } from 'csv-parse/sync'
import type { PrismaClient } from '@prisma/client'

// ── Types ──────────────────────────────────────────────────────

interface ParsedRow {
  prodotto:     string
  anno:         number | null
  annoLabel:    string | null   // valore non numerico (es. "PRESALE", "IDEE FUTURE") — diventa un tag
  quarter:      string | null
  dataDeadline: Date | null
  titolo:       string
  stato:        string | null   // etichetta grezza, es. "In corso"
  analisiUrl:   string | null
  stimaGg:      number | null
}

interface CountPair { created: number; updated: number }

export interface RoadmapImportResult {
  prodotti:     CountPair
  stati:        CountPair
  tag:          CountPair
  roadmapItems: CountPair
  errors:       Array<{ row: number; field: string; message: string }>
}

// ── Helpers ────────────────────────────────────────────────────

const normalize = (s: unknown): string =>
  typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : ''

const parseDate = (s: unknown): Date | null => {
  if (typeof s !== 'string' || !s.trim()) return null
  const dmY = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (dmY) return new Date(`${dmY[3]}-${dmY[2]}-${dmY[1]}`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s)
  return null
}

const parseAnno = (raw: unknown): { anno: number | null; annoLabel: string | null } => {
  const v = normalize(raw)
  if (!v || v === '-') return { anno: null, annoLabel: null }
  if (/^\d{4}$/.test(v)) return { anno: parseInt(v, 10), annoLabel: null }
  return { anno: null, annoLabel: v }
}

const parseQuarter = (raw: unknown): string | null => {
  const v = normalize(raw).toUpperCase()
  return /^Q[1-4]$/.test(v) ? v : null
}

const parseStimaGg = (raw: unknown): number | null => {
  const v = normalize(raw)
  return /^\d+(\.\d+)?$/.test(v) ? parseFloat(v) : null
}

const parseAnalisiUrl = (raw: unknown): string | null => {
  const v = normalize(raw)
  return /^https?:\/\//i.test(v) ? v : null
}

// Converte l'etichetta stato CSV ("In corso") nella chiave ("IN_CORSO")
const statoToChiave = (s: string): string =>
  s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') || 'DA_FARE'

const PALETTE = ['#0D9488', '#7C3AED', '#DB2777', '#EA580C', '#2563EB', '#16A34A', '#CA8A04', '#DC2626']

// ── CSV parser ─────────────────────────────────────────────────

export function parseRoadmapCSV(buffer: Buffer): ParsedRow[] {
  const records = parse(buffer, {
    from_line: 2,          // riga 1 vuota, riga 2 = header
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, unknown>[]

  return records.map((r) => {
    const { anno, annoLabel } = parseAnno(r['ANNO'])
    return {
      prodotto:     normalize(r['Prodotto']),
      anno,
      annoLabel,
      quarter:      parseQuarter(r['Q?']),
      dataDeadline: parseDate(r['Data deadline (Prod)']),
      titolo:       normalize(r['Titolo']),
      stato:        normalize(r['Stato']) || null,
      analisiUrl:   parseAnalisiUrl(r['Analisi']),
      stimaGg:      parseStimaGg(r['Stima gg']),
    }
  })
}

// ── Import ─────────────────────────────────────────────────────
//
// Ogni riga del CSV diventa una nuova RoadmapItem — nessun upsert/dedup su
// titolo, perché la fonte contiene volutamente titoli ripetuti (backlog con
// più iniziative identiche). Prodotti, stati e tag mancanti vengono creati
// al volo. Un ANNO non numerico (es. "PRESALE", "IDEE FUTURE") non può
// essere salvato nel campo anno (Int obbligatorio): l'attività viene
// importata sotto l'anno corrente e taggata con il valore originale, così
// resta filtrabile e distinguibile senza dover rendere anno opzionale.

export async function importRoadmapCSV(buffer: Buffer, prisma: PrismaClient): Promise<RoadmapImportResult> {
  const rows = parseRoadmapCSV(buffer)
  const result: RoadmapImportResult = {
    prodotti:     { created: 0, updated: 0 },
    stati:        { created: 0, updated: 0 },
    tag:          { created: 0, updated: 0 },
    roadmapItems: { created: 0, updated: 0 },
    errors:       [],
  }

  const prodottoCache = new Map<string, { id: string }>()
  const statoCache     = new Map<string, { chiave: string }>()
  const tagCache        = new Map<string, { id: string }>()
  const ordineCounters  = new Map<string, number>()

  let paletteIdx = await prisma.progetto.count({ where: { tipo: 'PRODOTTO' } })
  let statiCount  = await prisma.statoRoadmapConfig.count()
  let tagCount    = await prisma.roadmapTag.count()
  const currentYear = new Date().getFullYear()

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i]
    const rowNum = i + 3 // riga 1 vuota, riga 2 header, riga 3+ dati

    if (!row.prodotto) {
      result.errors.push({ row: rowNum, field: 'Prodotto', message: 'Prodotto obbligatorio' })
      continue
    }
    if (!row.titolo) {
      result.errors.push({ row: rowNum, field: 'Titolo', message: 'Titolo obbligatorio' })
      continue
    }

    try {
      // ── 1. Prodotto ──────────────────────────────────────────
      const prodKey = row.prodotto.toLowerCase()
      let prodotto = prodottoCache.get(prodKey)
      if (!prodotto) {
        const existing = await prisma.progetto.findFirst({
          where: { tipo: 'PRODOTTO', nome: { equals: row.prodotto, mode: 'insensitive' } },
        })
        if (existing) {
          prodotto = existing
        } else {
          prodotto = await prisma.progetto.create({
            data: { tipo: 'PRODOTTO', nome: row.prodotto, colore: PALETTE[paletteIdx % PALETTE.length] },
          })
          paletteIdx++
          result.prodotti.created++
        }
        prodottoCache.set(prodKey, prodotto)
      }

      // ── 2. Stato ──────────────────────────────────────────────
      const statoChiave = row.stato ? statoToChiave(row.stato) : 'DA_FARE'
      let stato = statoCache.get(statoChiave)
      if (!stato) {
        const existing = await prisma.statoRoadmapConfig.findUnique({ where: { chiave: statoChiave } })
        if (existing) {
          stato = existing
        } else {
          statiCount++
          stato = await prisma.statoRoadmapConfig.create({
            data: { chiave: statoChiave, label: row.stato?.trim() || 'Da fare', colore: PALETTE[statiCount % PALETTE.length], ordine: statiCount },
          })
          result.stati.created++
        }
        statoCache.set(statoChiave, stato)
      }

      // ── 3. Tag automatico per ANNO non numerico ─────────────
      const tagIds: string[] = []
      if (row.annoLabel) {
        const tagKey = row.annoLabel.toLowerCase()
        let tag = tagCache.get(tagKey)
        if (!tag) {
          const existing = await prisma.roadmapTag.findFirst({ where: { label: { equals: row.annoLabel, mode: 'insensitive' } } })
          if (existing) {
            tag = existing
          } else {
            tagCount++
            tag = await prisma.roadmapTag.create({
              data: { label: row.annoLabel, colore: PALETTE[(tagCount + 3) % PALETTE.length], ordine: tagCount },
            })
            result.tag.created++
          }
          tagCache.set(tagKey, tag)
        }
        tagIds.push(tag.id)
      }

      // ── 4. Priorità (ordine), scoped a prodotto+anno+quarter ─
      const anno = row.anno ?? currentYear
      const quarter = row.quarter
      const groupKey = `${prodotto.id}|${anno}|${quarter ?? ''}`
      let nextOrdine = ordineCounters.get(groupKey)
      if (nextOrdine === undefined) {
        nextOrdine = await prisma.roadmapItem.count({ where: { progettoId: prodotto.id, anno, quarter } })
      }
      ordineCounters.set(groupKey, nextOrdine + 1)

      // ── 5. RoadmapItem ────────────────────────────────────────
      await prisma.roadmapItem.create({
        data: {
          progettoId:   prodotto.id,
          anno,
          quarter,
          dataDeadline: row.dataDeadline,
          titolo:       row.titolo,
          stato:        statoChiave,
          analisiUrl:   row.analisiUrl,
          stimaGg:      row.stimaGg,
          ordine:       nextOrdine,
          tags: tagIds.length > 0 ? { create: tagIds.map(tagId => ({ tagId })) } : undefined,
        },
      })
      result.roadmapItems.created++
    } catch (err) {
      result.errors.push({ row: rowNum, field: '', message: `Errore interno: ${String(err)}` })
    }
  }

  return result
}
