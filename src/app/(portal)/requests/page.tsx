import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { RequestsList } from '@/components/RequestsList'

export default async function RequestsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const allRequests = await prisma.dataRequest.findMany({
    where: {
      OR: [{ buyerEntityId: entityId }, { supplierEntityId: entityId }],
    },
    include: {
      buyerEntity: { select: { legalName: true } },
      supplierEntity: { select: { legalName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const incoming = allRequests.filter(r => r.supplierEntityId === entityId && r.buyerEntityId !== entityId)
  const outgoing = allRequests.filter(r => r.buyerEntityId === entityId)

  const serialised = allRequests.map(r => ({
    ...r,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    deadline: r.deadline?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    requiredFields: r.requiredFields as string[],
  }))

  const serialisedIncoming = serialised.filter(r => r.supplierEntityId === entityId && r.buyerEntityId !== entityId)
  const serialisedOutgoing = serialised.filter(r => r.buyerEntityId === entityId)

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Requests
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          {incoming.length} incoming · {outgoing.length} sent
        </p>
      </div>

      <RequestsList incoming={serialisedIncoming} outgoing={serialisedOutgoing} />
    </div>
  )
}
