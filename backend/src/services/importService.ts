import { parse } from 'csv-parse/sync'
import type { PrismaClient } from '@prisma/client'

// ── Types ──────────────────────────────────────────────────────

interface ParsedRow {
  cliente:              string
  progetto:             string
  attivita:             string
  nomeAccount:          string | null
  cognomeAccount:       string
  emailAccountRaw:      string
  emailAccount:         string | null
  nomePM:               string | null
  cognomePM:            string
  emailPMRaw:           string
  emailPM:              string | null
  stimaGiornate:        number | null
  consuntivateGiornate: number | null
  ordineGO:             string | null
  stato:                string | null
  dataInizio:           Date | null
  dataDeadline:         Date | null
  note:                 string | null
}

interface CountPair { created: number; updated: number }

export interface ImportResult {
  clienti:  CountPair
  account:  CountPair
  pm:       CountPair
  progetti: CountPair
  attivita: CountPair
  errors:   Array<{ row: number; field: string; message: string }>
}

// ── Helpers ────────────────────────────────────────────────────

const normalize = (s: unknown): string =>
  typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : ''

const normalizeEmail = (s: unknown): string | null => {
  const v = normalize(s).toLowerCase()
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
}

const parseFloatIT = (s: unknown): number | null => {
  if (typeof s !== 'string' || !s.trim()) return null
  const n = parseFloat(s.replace(/"/g, '').replace(',', '.'))
  return isNaN(n) || n < 0 ? null : n
}

const parseDate = (s: unknown): Date | null => {
  if (typeof s !== 'string' || !s.trim()) return null
  const dmY = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (dmY) return new Date(`${dmY[3]}-${dmY[2]}-${dmY[1]}`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s)
  return null
}

// Converts CSV stato label ("In corso") to chiave format ("IN_CORSO")
const statoToChiave = (s: string): string =>
  s.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')

// ── CSV parser ─────────────────────────────────────────────────

export function parseCSV(buffer: Buffer): ParsedRow[] {
  const records = parse(buffer, {
    from_line: 2,          // skip blank first row
    columns: true,         // row 2 becomes headers
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, unknown>[]

  return records.map((r) => {
    const emailAccountRaw = normalize(r['Mail account'])
    const emailPMRaw      = normalize(r['Mail PM'])
    const statoRaw        = normalize(r['STATO'])
    return {
      cliente:              normalize(r['CLIENTE']),
      progetto:             normalize(r['PROGETTO']),
      attivita:             normalize(r['ATTIVITA']),
      nomeAccount:          normalize(r['Nome Account']) || null,
      cognomeAccount:       normalize(r['Cognome Account']),
      emailAccountRaw,
      emailAccount:         normalizeEmail(r['Mail account']),
      nomePM:               normalize(r['Nome PM']) || null,
      cognomePM:            normalize(r['Cognome PM']),
      emailPMRaw,
      emailPM:              normalizeEmail(r['Mail PM']),
      stimaGiornate:        parseFloatIT(r['Stima giornate']),
      consuntivateGiornate: parseFloatIT(r['Consuntivate giornate']),
      ordineGO:             normalize(r['Ordine GO']) || null,
      stato:                statoRaw ? statoToChiave(statoRaw) : null,
      dataInizio:           parseDate(r['INIZIO']),
      dataDeadline:         parseDate(r['DEADLINE']),
      note:                 normalize(r['Note']) || null,
    }
  })
}

// ── Import ─────────────────────────────────────────────────────

export async function importCSV(buffer: Buffer, prisma: PrismaClient): Promise<ImportResult> {
  const rows = parseCSV(buffer)
  const result: ImportResult = {
    clienti:  { created: 0, updated: 0 },
    account:  { created: 0, updated: 0 },
    pm:       { created: 0, updated: 0 },
    progetti: { created: 0, updated: 0 },
    attivita: { created: 0, updated: 0 },
    errors:   [],
  }

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i]
    const rowNum = i + 3 // row 1 = blank, row 2 = headers, row 3+ = data

    // ── Validazione ────────────────────────────────────────────
    if (!row.cliente) {
      result.errors.push({ row: rowNum, field: 'CLIENTE', message: 'CLIENTE obbligatorio' })
      continue
    }
    if (!row.progetto) {
      result.errors.push({ row: rowNum, field: 'PROGETTO', message: 'PROGETTO obbligatorio' })
      continue
    }
    if (row.emailAccountRaw && !row.emailAccount) {
      result.errors.push({ row: rowNum, field: 'Mail account', message: `Email account non valida: "${row.emailAccountRaw}"` })
      continue
    }
    if (row.emailPMRaw && !row.emailPM) {
      result.errors.push({ row: rowNum, field: 'Mail PM', message: `Email PM non valida: "${row.emailPMRaw}"` })
      continue
    }

    try {
      // ── 1. Cliente ─────────────────────────────────────────
      let cliente = await prisma.cliente.findFirst({
        where: { nome: { equals: row.cliente, mode: 'insensitive' } },
      })
      if (!cliente) {
        cliente = await prisma.cliente.create({ data: { nome: row.cliente } })
        result.clienti.created++
      }

      // ── 2. Account (User con ruolo ACCOUNT) ─────────────────
      let account: { id: string } | null = null
      if (row.cognomeAccount) {
        if (row.emailAccount) {
          const existing = await prisma.user.findFirst({ where: { email: row.emailAccount } })
          if (existing) {
            await prisma.user.update({
              where: { id: existing.id },
              data: {
                firstName: row.nomeAccount,
                lastName: row.cognomeAccount,
                roles: existing.roles.includes('ACCOUNT') ? undefined : { push: 'ACCOUNT' },
              },
            })
            account = existing
            result.account.updated++
          } else {
            account = await prisma.user.create({
              data: { firstName: row.nomeAccount, lastName: row.cognomeAccount, email: row.emailAccount, roles: ['ACCOUNT'] },
            })
            result.account.created++
          }
        } else {
          // no email — find by name
          const existing = await prisma.user.findFirst({
            where: { lastName: row.cognomeAccount, firstName: row.nomeAccount },
          })
          if (existing) {
            account = existing
            if (!existing.roles.includes('ACCOUNT')) {
              await prisma.user.update({ where: { id: existing.id }, data: { roles: { push: 'ACCOUNT' } } })
            }
          } else {
            account = await prisma.user.create({
              data: { firstName: row.nomeAccount, lastName: row.cognomeAccount, roles: ['ACCOUNT'] },
            })
            result.account.created++
          }
        }
      }

      // ── 3. PM (User con ruolo PM) ───────────────────────────
      let pm: { id: string } | null = null
      if (row.cognomePM) {
        if (row.emailPM) {
          const existing = await prisma.user.findFirst({ where: { email: row.emailPM } })
          if (existing) {
            await prisma.user.update({
              where: { id: existing.id },
              data: {
                firstName: row.nomePM,
                lastName: row.cognomePM,
                roles: existing.roles.includes('PM') ? undefined : { push: 'PM' },
              },
            })
            pm = existing
            result.pm.updated++
          } else {
            pm = await prisma.user.create({
              data: { firstName: row.nomePM, lastName: row.cognomePM, email: row.emailPM, roles: ['PM'] },
            })
            result.pm.created++
          }
        } else {
          const existing = await prisma.user.findFirst({
            where: { lastName: row.cognomePM, firstName: row.nomePM },
          })
          if (existing) {
            pm = existing
            if (!existing.roles.includes('PM')) {
              await prisma.user.update({ where: { id: existing.id }, data: { roles: { push: 'PM' } } })
            }
          } else {
            pm = await prisma.user.create({
              data: { firstName: row.nomePM, lastName: row.cognomePM, roles: ['PM'] },
            })
            result.pm.created++
          }
        }
      }

      // ── 4. Progetto ────────────────────────────────────────
      let progetto = await prisma.progetto.findFirst({
        where: { nome: row.progetto, clienteId: cliente.id },
      })
      if (!progetto) {
        progetto = await prisma.progetto.create({
          data: { nome: row.progetto, clienteId: cliente.id },
        })
        result.progetti.created++
      } else {
        result.progetti.updated++
      }

      // ── 5. Attività ────────────────────────────────────────
      if (row.attivita) {
        const existing = await prisma.attivita.findFirst({
          where: { attivita: row.attivita, cliente: row.cliente, progetto: row.progetto },
        })
        if (existing) {
          await prisma.attivita.update({
            where: { id: existing.id },
            data: {
              accountId:                account?.id ?? undefined,
              giornateVendute:          row.stimaGiornate ?? undefined,
              giornateConsuntivate:     row.consuntivateGiornate ?? undefined,
              riferimentoOrdineVendita: row.ordineGO ?? undefined,
              stato:                    row.stato ?? undefined,
              inizio:                   row.dataInizio ?? undefined,
              deadline:                 row.dataDeadline ?? undefined,
              note:                     row.note ?? undefined,
            },
          })
          if (pm) {
            await prisma.attivitaPM.upsert({
              where: { attivitaId_pmId: { attivitaId: existing.id, pmId: pm.id } },
              update: {},
              create: { attivitaId: existing.id, pmId: pm.id },
            })
          }
          result.attivita.updated++
        } else {
          await prisma.attivita.create({
            data: {
              cliente:                  row.cliente,
              progetto:                 row.progetto,
              attivita:                 row.attivita,
              accountId:                account?.id ?? null,
              giornateVendute:          row.stimaGiornate,
              giornateConsuntivate:     row.consuntivateGiornate,
              riferimentoOrdineVendita: row.ordineGO,
              stato:                    row.stato ?? 'DA_INIZIARE',
              inizio:                   row.dataInizio,
              deadline:                 row.dataDeadline,
              note:                     row.note,
              pms:                      pm ? { create: [{ pmId: pm.id }] } : undefined,
            },
          })
          result.attivita.created++
        }
      }
    } catch (err) {
      result.errors.push({ row: rowNum, field: '', message: `Errore interno: ${String(err)}` })
    }
  }

  return result
}
