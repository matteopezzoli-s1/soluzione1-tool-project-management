import 'dotenv/config'
import { createPrismaClient } from '../src/lib/prisma'
import type { UserRole } from '@prisma/client'

const prisma = createPrismaClient(process.env.DATABASE_URL ?? '')

async function main() {
  console.log('Seeding...')

  const user1Data = {
    email: 'alice@test.com', name: 'Alice',
    firstName: 'Alice', lastName: 'Seed', roles: ['PM', 'BOARD'] as UserRole[],
  }
  const user1 = await prisma.user.upsert({
    where: { googleId: 'seed-user-1' },
    update: user1Data,
    create: { googleId: 'seed-user-1', ...user1Data },
  })

  const user2Data = {
    email: 'bob@test.com', name: 'Bob',
    firstName: 'Bob', lastName: 'Seed', roles: ['ACCOUNT', 'DEVHUB'] as UserRole[],
  }
  const user2 = await prisma.user.upsert({
    where: { googleId: 'seed-user-2' },
    update: user2Data,
    create: { googleId: 'seed-user-2', ...user2Data },
  })

  const project = await prisma.project.upsert({
    where: { id: 'seed-project-1' },
    update: {},
    create: {
      id: 'seed-project-1',
      name: 'Progetto Demo',
      description: 'Progetto di test',
      ownerId: user1.id,
      members: {
        create: [
          { userId: user1.id, role: 'OWNER' },
          { userId: user2.id, role: 'EDITOR' },
        ],
      },
    },
  })

  const today = new Date()
  const d = (n: number) => { const r = new Date(today); r.setDate(r.getDate() + n); return r }

  await prisma.task.createMany({
    skipDuplicates: true,
    data: [
      { id: 'task-1', title: 'Setup infrastruttura', status: 'DONE',        priority: 'HIGH',   startDate: d(-14), endDate: d(-7),  progress: 100, projectId: project.id, creatorId: user1.id },
      { id: 'task-2', title: 'Design database',      status: 'DONE',        priority: 'HIGH',   startDate: d(-10), endDate: d(-5),  progress: 100, projectId: project.id, creatorId: user1.id, assigneeId: user2.id },
      { id: 'task-3', title: 'Backend API',          status: 'IN_PROGRESS', priority: 'HIGH',   startDate: d(-3),  endDate: d(7),   progress: 40,  projectId: project.id, creatorId: user1.id },
      { id: 'task-4', title: 'Frontend UI',          status: 'IN_PROGRESS', priority: 'MEDIUM', startDate: d(0),   endDate: d(10),  progress: 20,  projectId: project.id, creatorId: user2.id, assigneeId: user2.id },
      { id: 'task-5', title: 'Test e Deploy',        status: 'TODO',        priority: 'MEDIUM', startDate: d(8),   endDate: d(14),  progress: 0,   projectId: project.id, creatorId: user1.id },
    ],
  })

  // ── Stati Presale (colonne del Kanban Presale) ──────────────────
  // isPresale=true li rende colonne della board; escludiDaConteggio=true
  // evita che le giornate proposte in trattativa inquinino i totali.
  const statiPresale = [
    { chiave: 'PRESALE_APERTURA',     label: 'Analisi iniziale',    colore: '#3B82F6', ordine: 1 },
    { chiave: 'PRESALE_PRESA_CARICO', label: 'Presa in carico',     colore: '#0D9488', ordine: 2 },
    { chiave: 'PRESALE_STIMA',        label: 'Stima',               colore: '#8B5CF6', ordine: 3 },
    { chiave: 'PRESALE_GIORNATE',     label: 'Trattativa con cliente', colore: '#F59E0B', ordine: 4 },
  ]
  for (const s of statiPresale) {
    const data = { label: s.label, colore: s.colore, ordine: s.ordine, isPresale: true, escludiDaConteggio: true }
    await prisma.statoAttivitaConfig.upsert({
      where: { chiave: s.chiave },
      update: data,
      create: { chiave: s.chiave, ...data },
    })
  }

  console.log('Seed completato:', { user1: user1.email, user2: user2.email, project: project.name, statiPresale: statiPresale.length })
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
