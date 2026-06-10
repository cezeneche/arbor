// Layer 2 — System actor helper.
// API key ingest writes are attributed to a per-entity SYSTEM user rather than
// a human admin, so audit trails correctly distinguish machine from human actions.
import { prisma } from '@/lib/prisma'

export async function getSystemUser(entityId: string): Promise<{ id: string }> {
  const existing = await prisma.user.findFirst({
    where: { entityId, role: 'SYSTEM' },
    select: { id: true },
  })
  if (existing) return existing

  return prisma.user.create({
    data: {
      entityId,
      name: 'System Integration',
      email: `system+${entityId}@arbor.internal`,
      role: 'SYSTEM',
    },
    select: { id: true },
  })
}
