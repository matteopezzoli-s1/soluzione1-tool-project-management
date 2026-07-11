/// <reference types="node" />
// Script di sola lettura: mostra tutti i riferimenti Gantt (Project/Task/ProjectMember)
// che bloccano la cancellazione di uno o più utenti (stesso check di DELETE /api/users/:id).
//
// Uso:
//   DATABASE_URL="<connection string prod>" npx ts-node src/scripts/inspect-user-gantt-refs.ts alice@test.com bob@test.com
//   (oppure passa gli id utente invece delle email)
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
  const targets = process.argv.slice(2)
  if (targets.length === 0) {
    console.error('Uso: ts-node src/scripts/inspect-user-gantt-refs.ts <email-o-id> [altri...]')
    process.exit(1)
  }

  for (const target of targets) {
    const user = await resolveUser(target)
    if (!user) {
      console.log(`\n=== "${target}" → utente non trovato ===`)
      continue
    }
    const label = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || user.email || user.id
    console.log(`\n=== ${label} (id: ${user.id}, email: ${user.email ?? '—'}) ===`)

    const [owned, created, assigned, memberships] = await Promise.all([
      prisma.project.findMany({
        where: { ownerId: user.id },
        select: { id: true, name: true, status: true, createdAt: true, _count: { select: { tasks: true, members: true } } },
      }),
      prisma.task.findMany({
        where: { creatorId: user.id },
        select: { id: true, title: true, status: true, projectId: true, project: { select: { name: true, ownerId: true } } },
      }),
      prisma.task.findMany({
        where: { assigneeId: user.id },
        select: { id: true, title: true, status: true, projectId: true, project: { select: { name: true, ownerId: true } } },
      }),
      prisma.projectMember.findMany({
        where: { userId: user.id },
        select: { id: true, role: true, project: { select: { id: true, name: true, ownerId: true } } },
      }),
    ])

    console.log(`Progetti di proprietà: ${owned.length}`)
    for (const p of owned) {
      console.log(`  - [${p.id}] "${p.name}" (${p.status}) — ${p._count.tasks} task, ${p._count.members} membri — creato ${p.createdAt.toISOString()}`)
    }

    console.log(`Task creati: ${created.length}`)
    for (const t of created) {
      console.log(`  - [${t.id}] "${t.title}" (${t.status}) — progetto "${t.project.name}" (owner: ${t.project.ownerId})`)
    }

    console.log(`Task assegnati: ${assigned.length}`)
    for (const t of assigned) {
      console.log(`  - [${t.id}] "${t.title}" (${t.status}) — progetto "${t.project.name}" (owner: ${t.project.ownerId})`)
    }

    console.log(`Membership progetti: ${memberships.length}`)
    for (const m of memberships) {
      console.log(`  - [${m.project.id}] "${m.project.name}" (owner: ${m.project.ownerId}) — ruolo ${m.role}`)
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
