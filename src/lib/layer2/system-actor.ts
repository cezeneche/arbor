// Layer 2 — System actor helper.
// API key ingest writes are attributed to a per-entity SYSTEM user rather than
// a human admin, so audit trails correctly distinguish machine from human actions.
import { prisma } from '@/lib/prisma'

export async function getSystemUser(entityId: string): Promise<{ id: string }> {
  // upsert is atomic: no race condition between the existence check and creation.
  return prisma.user.upsert({
    where: { email: `system+${entityId}@arbor.internal` },
    create: {
      entityId,
      name: 'System Integration',
      email: `system+${entityId}@arbor.internal`,
      role: 'SYSTEM',
    },
    update: {},
    select: { id: true },
  })
}
