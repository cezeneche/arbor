import { getSessionUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { spacing, textStyles } from '@/lib/design-system'
import { BackLink } from '@/components/BackLink'
import { RequestsList } from '@/components/RequestsList'

// The data-request depth (respond, generate share link, pagination) lives here.
// The unified /requests landing routes into it; this keeps the interaction intact.
export default async function DataRequestsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = getSessionUser(session).entityId as string

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
    <div style={{ width: '100%' }}>
      <BackLink current="Data requests" />
      <div style={{ margin: `0 0 ${spacing[5]}` }}>
        <h1
          style={textStyles.pageTitle}
        >
          Data requests
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          {incoming.length} incoming · {outgoing.length} sent
        </p>
      </div>

      <RequestsList incoming={serialisedIncoming} outgoing={serialisedOutgoing} />
    </div>
  )
}
