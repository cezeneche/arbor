// A person settles a proposed match (operator only). Confirm or reject; the
// decision is terminal, so a link can be acted on only while it is PENDING. The
// status check and the write are one conditional update: two operators deciding
// the same pair at once cannot both win. This records the decision on the edge
// and never merges or rewrites the entities, so records and the audit chain are
// untouched. A CONFIRMED link is the "same company" signal downstream relies on.

export type LinkDecision = 'confirm' | 'reject'
type LinkStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED'

export interface EntityLinkStore {
  entityLink: {
    updateMany(args: {
      where: { id: string; status: 'PENDING' }
      data: { status: LinkStatus; reviewedById: string; reviewedAt: Date }
    }): Promise<{ count: number }>
    findUnique(args: {
      where: { id: string }
      select: { status: true }
    }): Promise<{ status: LinkStatus } | null>
  }
}

export type DecideResult =
  { ok: true; status: 'CONFIRMED' | 'REJECTED' } | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_REVIEWED' }

export async function decideEntityLink(
  db: EntityLinkStore,
  input: { id: string; action: LinkDecision; userId: string; now?: Date },
): Promise<DecideResult> {
  const status = input.action === 'confirm' ? 'CONFIRMED' : 'REJECTED'
  const { count } = await db.entityLink.updateMany({
    where: { id: input.id, status: 'PENDING' },
    data: { status, reviewedById: input.userId, reviewedAt: input.now ?? new Date() },
  })
  if (count === 1) return { ok: true, status }

  const existing = await db.entityLink.findUnique({ where: { id: input.id }, select: { status: true } })
  return { ok: false, reason: existing ? 'ALREADY_REVIEWED' : 'NOT_FOUND' }
}
