import { prisma } from '../src/lib/prisma'

async function main() {
  console.log('Seeding...')

  const user1 = await prisma.user.upsert({
    where: { googleId: 'seed-user-1' },
    update: {},
    create: { googleId: 'seed-user-1', email: 'alice@test.com', name: 'Alice' },
  })

  const user2 = await prisma.user.upsert({
    where: { googleId: 'seed-user-2' },
    update: {},
    create: { googleId: 'seed-user-2', email: 'bob@test.com', name: 'Bob' },
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

  console.log('Seed completato:', { user1: user1.email, user2: user2.email, project: project.name })
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
