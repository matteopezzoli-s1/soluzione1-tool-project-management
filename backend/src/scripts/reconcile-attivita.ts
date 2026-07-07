/// <reference types="node" />
import 'dotenv/config'
import { createPrismaClient } from '../lib/prisma'

const prisma = createPrismaClient(process.env.DATABASE_URL ?? '')

function normalize(s: string) {
  return s.trim().toLowerCase()
}

async function main() {
  const [attivita, clienti, progetti] = await Promise.all([
    prisma.attivita.findMany(),
    prisma.cliente.findMany({ select: { id: true, nome: true, accountId: true } }),
    prisma.progetto.findMany({ select: { id: true, nome: true, clienteId: true } }),
  ])

  // Build lookup maps
  const clienteMap = new Map(clienti.map(c => [normalize(c.nome), c] as [string, typeof c]))

  // progetto map: key = "clienteId:::nomeNorm" → id, fallback ":::nomeNorm"
  const progettoByClient = new Map<string, string>()
  const progettoByName   = new Map<string, string>()
  for (const p of progetti) {
    const nNorm = normalize(p.nome)
    progettoByName.set(nNorm, p.id)
    if (p.clienteId) progettoByClient.set(`${p.clienteId}:::${nNorm}`, p.id)
  }

  let updated = 0, skipped = 0

  for (const att of attivita) {
    const cliente = clienteMap.get(normalize(att.cliente))
    const cId = cliente?.id ?? att.clienteId ?? null

    const pNorm = normalize(att.progetto)
    const progettoId =
      att.progettoId ??
      (cId ? progettoByClient.get(`${cId}:::${pNorm}`) : undefined) ??
      progettoByName.get(pNorm) ??
      null

    const accountId = cliente?.accountId ?? att.accountId ?? null

    const alreadyOk =
      att.clienteId  === cId &&
      att.progettoId === progettoId &&
      att.accountId  === accountId

    if (alreadyOk) { skipped++; continue }

    await prisma.attivita.update({
      where: { id: att.id },
      data: {
        ...(cId        !== att.clienteId  ? { clienteId:  cId        } : {}),
        ...(progettoId !== att.progettoId ? { progettoId: progettoId } : {}),
        ...(accountId  !== att.accountId  ? { accountId:  accountId  } : {}),
      },
    })

    updated++
  }

  console.log(`Riconciliazione completata:`)
  console.log(`  Attività aggiornate: ${updated}`)
  console.log(`  Già collegate (skip): ${skipped}`)
  console.log(`  Totale attività: ${attivita.length}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
