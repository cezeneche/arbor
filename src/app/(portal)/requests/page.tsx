import Link from 'next/link'
import { getSessionUser } from '@/lib/session'
import { requirePageSession } from '@/lib/page-auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { shareState } from '@/lib/shares/share-status'
import { categoriseRequests } from '@/lib/layer3/requests-overview'
import { RequestSectionList } from '@/components/RequestSectionList'
import { RequestDataPrompt } from '@/components/RequestDataPrompt'
import { REQUEST_VIEWS, resolveRequestView, type RequestView } from '@/lib/requests/request-views'

// Unified Requests landing. The supplier sees one idea - "someone wants my data,
// and here's what I've given" - instead of four separate destinations. Rows route
// into the focused screens (/requests/data, /inbound-requests, /shares) where the
// actual respond / manage actions live.
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const session = await requirePageSession()
  const { view: rawView } = await searchParams
  const view: RequestView = resolveRequestView(rawView)

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
          style={textStyles.pageTitle}
        >
          Requests
        </h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          {REQUEST_VIEWS.find(v => v.id === view)?.description}
        </p>
      </div>

      {/* Views of one section, not tabs — the same quiet toggle Records and CBAM
          use, so the product has one navigation pattern rather than two. */}
      <div
        style={{
          display: 'flex',
          gap: spacing[3],
          marginBottom: spacing[4],
          paddingBottom: spacing[2],
          borderBottom: `1px solid ${colours.border}`,
        }}
      >
        {REQUEST_VIEWS.map(v => (
          <Link
            key={v.id}
            href={v.id === 'waiting' ? '/requests' : `/requests?view=${v.id}`}
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: view === v.id ? typography.weights.medium : typography.weights.light,
              color: view === v.id ? colours.textPrimary : colours.textSecondary,
              textDecoration: 'none',
            }}
          >
            {v.label}
          </Link>
        ))}
      </div>

      {view === 'waiting' && (
        <RequestSectionList
          items={waiting}
          emptyText="You're all caught up, nothing to respond to."
          accent
        />
      )}

      {view === 'shared' && (
        <RequestSectionList
          items={shared}
          emptyText="You haven't shared any data yet."
        />
      )}

      {/* Asking, and what has already been asked. The list is context for the
          action above it rather than a destination of its own. */}
      {view === 'request' && (
        <>
          <RequestDataPrompt />
          <div style={{ height: spacing[5] }} />
          <RequestSectionList
            title="Requests you've sent"
            items={sent}
            emptyText="You haven't asked any suppliers for data."
            matrix
            divider
          />
        </>
      )}

      {view === 'questionnaires' && (
        <div>
          <p style={{ ...textStyles.sectionSubtitle, margin: `0 0 ${spacing[3]}` }}>
            Answer a buyer&apos;s questionnaire from the data you already hold. Nothing is
            sent until you have reviewed every answer.
          </p>
          <Link
            href="/questionnaires"
            style={{
              display: 'inline-block',
              padding: `${spacing[2]} ${spacing[4]}`,
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: '#FFFFFF',
              backgroundColor: colours.navy,
              borderRadius: '4px',
              textDecoration: 'none',
            }}
          >
            Browse questionnaires
          </Link>
        </div>
      )}

    </div>
  )
}
