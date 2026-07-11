/// <reference types="node" />
// Cancella i Project (Gantt) di cui l'utente indicato è owner, con cascade su
// Task/ProjectMember/Milestone/ActivityLog collegati (stesso comportamento che
// avrebbe la cancellazione dell'utente stesso, vedi projects.owner_id ON DELETE CASCADE).
// Dry-run di default: mostra cosa verrebbe cancellato senza toccare nulla.
// Aggiungi --confirm per eseguire davvero la cancellazione.
//
// Uso:
//   DATABASE_URL="<connection string prod>" npx ts-node src/scripts/delete-owned-gantt-projects.ts alice@test.com
//   DATABASE_URL="<connection string prod>" npx ts-node src/scripts/delete-owned-gantt-projects.ts alice@test.com --confirm
import 'dotenv/config'
import { createPrismaClient } from '../lib/prisma'

const prisma = createPrismaClient(process.env.DATABASE_URL ?? '')

async function resolveUser(idOrEmail: string) {
  return prisma.user.findFirst({
    where: { OR: [{ id: idOrEmail }, { email: idOrEmail }] },
    select: { id: true, firstName: true, lastName: true, name: true, email: true },
  })
}

async function main() {
  const args = process.argv.slice(2)
  const confirm = args.includes('--confirm')
  const targets = args.filter(a => a !== '--confirm')

  if (targets.length === 0) {
    console.error('Uso: ts-node src/scripts/delete-owned-gantt-projects.ts <email-o-id> [altri...] [--confirm]')
    process.exit(1)
  }

  for (const target of targets) {
    const user = await resolveUser(target)
    if (!user) {
      console.log(`\n=== "${target}" → utente non trovato ===`)
      continue
    }
    const label = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || user.email || user.id
    console.log(`\n=== ${label} (id: ${user.id}) ===`)

    const owned = await prisma.project.findMany({
      where: { ownerId: user.id },
      select: { id: true, name: true, _count: { select: { tasks: true, members: true } } },
    })

    if (owned.length === 0) {
      console.log('Nessun progetto di proprietà — nulla da cancellare per questo utente.')
      continue
    }

    for (const p of owned) {
      console.log(`  [${p.id}] "${p.name}" — ${p._count.tasks} task, ${p._count.members} membri`)
    }

    if (!confirm) {
      console.log('  (dry-run: nessuna modifica applicata — rilancia con --confirm per cancellare davvero)')
      continue
    }

    for (const p of owned) {
      await prisma.project.delete({ where: { id: p.id } })
      console.log(`  ✔ cancellato progetto [${p.id}] "${p.name}"`)
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
