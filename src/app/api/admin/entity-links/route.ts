import { requireAdmin } from '@/lib/auth-helpers'
import { ok } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// the entity-resolution review queue (ADMIN). Lists PENDING
// candidate links (proposed "same real-world entity" edges) with both entities'
// identity detail and the scorer's similarity, highest-confidence first, so a
// human can confirm or reject. Read-only; resolution is cross-tenant platform
// work, hence admin-scoped. Nothing here mutates the entities.
export async function GET() {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const links = await prisma.entityLink.findMany({
    where: { status: 'PENDING' },
    orderBy: { similarity: 'desc' },
    take: 200,
    include: {
      entityA: { select: { id: true, legalName: true, registrationNumber: true, country: true, sector: true } },
      entityB: { select: { id: true, legalName: true, registrationNumber: true, country: true, sector: true } },
    },
  })

  return ok({
    count: links.length,
    candidates: links.map(l => ({
      id: l.id,
      similarity: l.similarity,
      suggestedDecision: l.suggestedDecision,
      relation: l.relation,
      method: l.method,
      createdAt: l.createdAt.toISOString(),
      entityA: l.entityA,
      entityB: l.entityB,
    })),
  })
}
