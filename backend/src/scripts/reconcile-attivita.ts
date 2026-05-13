/// <reference types="node" />
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function normalize(s: string) {
  return s.trim().toLowerCase()
}

async function main() {
  const [attivita, clienti, progetti, pms] = await Promise.all([
    prisma.attivita.findMany({ include: { pms: true } }),
    prisma.cliente.findMany({ select: { id: true, nome: true, accountId: true } }),
    prisma.progetto.findMany({ select: { id: true, nome: true, clienteId: true } }),
    prisma.projectManager.findMany(),
  ])

  // Build lookup maps
  const clienteMap = new Map(clienti.map(c => [normalize(c.nome), c] as [string, typeof c]))

  const pmMap = new Map<string, typeof pms[0]>()
  for (const p of pms) {
    const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ')
    pmMap.set(normalize(fullName), p)
  }

  // progetto map: key = "clienteId:::nomeNorm" → id, fallback ":::nomeNorm"
  const progettoByClient = new Map<string, string>()
  const progettoByName   = new Map<string, string>()
  for (const p of progetti) {
    const nNorm = normalize(p.nome)
    progettoByName.set(nNorm, p.id)
    if (p.clienteId) progettoByClient.set(`${p.clienteId}:::${nNorm}`, p.id)
  }

  let updated = 0, skipped = 0, pmLinked = 0

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

    // PM: parse comma-separated names, match to registry
    const existingPmIds = new Set(att.pms.map(p => p.pmId))
    const pmNames = att.projectManager
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const matchedPmIds = pmNames
      .map(name => pmMap.get(normalize(name))?.id)
      .filter((id): id is string => !!id)

    const needsPmUpdate =
      existingPmIds.size === 0 && matchedPmIds.length > 0

    const alreadyOk =
      att.clienteId  === cId &&
      att.progettoId === progettoId &&
      att.accountId  === accountId &&
      !needsPmUpdate

    if (alreadyOk) { skipped++; continue }

    await prisma.attivita.update({
      where: { id: att.id },
      data: {
        ...(cId        !== att.clienteId  ? { clienteId:  cId        } : {}),
        ...(progettoId !== att.progettoId ? { progettoId: progettoId } : {}),
        ...(accountId  !== att.accountId  ? { accountId:  accountId  } : {}),
        ...(needsPmUpdate ? {
          pms: { deleteMany: {}, create: matchedPmIds.map(pmId => ({ pmId })) },
        } : {}),
      },
    })

    if (needsPmUpdate) pmLinked += matchedPmIds.length
    updated++
  }

  console.log(`Riconciliazione completata:`)
  console.log(`  Attività aggiornate: ${updated}`)
  console.log(`  Già collegate (skip): ${skipped}`)
  console.log(`  PM collegati: ${pmLinked}`)
  console.log(`  Totale attività: ${attivita.length}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
