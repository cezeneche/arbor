import Link from 'next/link'
import { getSessionUser } from '@/lib/session'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { shareState } from '@/lib/shares/share-status'
import { categoriseRequests } from '@/lib/layer3/requests-overview'
import { RequestSectionList } from '@/components/RequestSectionList'

// Unified Requests landing. The supplier sees one idea - "someone wants my data,
// and here's what I've given" - instead of four separate destinations. Rows route
// into the focused screens (/requests/data, /inbound-requests, /shares) where the
// actual respond / manage actions live.
export default async function RequestsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = getSessionUser(session).entityId as string

  const [dataRequests, inboundRequests, sharedExports] = await Promise.all([
    prisma.dataRequest.findMany({
      where: { OR: [{ buyerEntityId: entityId }, { supplierEntityId: entityId }] },
      include: { buyerEntity: { select: { legalName: true } }, supplierEntity: { select: { legalName: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.inboundRequest.findMany({ where: { entityId }, orderBy: { createdAt: 'desc' } }),
    prisma.sharedExport.findMany({ where: { entityId }, orderBy: { createdAt: 'desc' } }),
  ])

  const { waiting, shared, sent } = categoriseRequests({
    dataRequests: dataRequests.map(r => ({
      id: r.id,
      status: r.status,
      direction: r.buyerEntityId === entityId ? 'outgoing' : 'incoming',
      counterpartyName: r.buyerEntityId === entityId ? r.supplierEntity.legalName : r.buyerEntity.legalName,
      domain: r.domain,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      deadline: r.deadline?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    inboundRequests: inboundRequests.map(r => ({
      id: r.id,
      status: r.status,
      fromEmail: r.fromEmail,
      createdAt: r.createdAt.toISOString(),
      answeredAt: r.answeredAt?.toISOString() ?? null,
    })),
    sharedExports: sharedExports.map(s => ({
      id: s.id,
      domain: s.domain,
      state: shareState(s),
      createdAt: s.createdAt.toISOString(),
    })),
  })

  return (
    <div style={{ width: '100%' }}>
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
          {waiting.length > 0
            ? `${waiting.length} waiting on you`
            : 'Nothing waiting on you'}
          {' · '}{shared.length} shared
        </p>
      </div>

      <RequestSectionList
        title="Waiting on you"
        items={waiting}
        emptyText="You're all caught up, nothing to respond to."
        accent
      />

      <div style={{ height: '1px', backgroundColor: colours.border, margin: `0 0 ${spacing[5]}` }} />

      <RequestSectionList
        title="What you've shared"
        items={shared}
        emptyText="You haven't shared any data yet."
      />

      {sent.length > 0 && (
        <RequestSectionList
          title="Requests you've sent"
          items={sent}
          emptyText="You haven't asked any suppliers for data."
        />
      )}

      {/* Questionnaires have no per-entity "open" state - they're a catalogue you
          complete on demand - so they're an entry point, not a waiting task. */}
      <div style={{ borderTop: `1px solid ${colours.border}`, paddingTop: spacing[3] }}>
        <Link
          href="/questionnaires"
          style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.navy, textDecoration: 'none' }}
        >
          Complete a questionnaire →
        </Link>
        <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: '4px 0 0' }}>
          Answer a buyer&apos;s questionnaire from the data you already hold.
        </p>
      </div>
    </div>
  )
}
