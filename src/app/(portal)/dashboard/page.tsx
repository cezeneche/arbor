import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { DomainGrid } from '@/components/DomainGrid'
import type { DomainStat } from '@/components/DomainGrid'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const [domainGroups, totalRecords, tierACount, pendingRequests, recentDocuments] =
    await Promise.all([
      prisma.dataRecord.groupBy({
        by: ['domain', 'trustTier'],
        where: { entityId, isActive: true },
        _count: { id: true },
      }),
      prisma.dataRecord.count({ where: { entityId, isActive: true } }),
      prisma.dataRecord.count({ where: { entityId, isActive: true, trustTier: 'A' } }),
      prisma.dataRequest.findMany({
        where: { supplierEntityId: entityId, status: 'PENDING' },
        include: { buyerEntity: { select: { legalName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.document.findMany({
        where: { entityId },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        include: {
          extractionJobs: {
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        },
      }),
    ])

  const readinessScore = totalRecords > 0 ? Math.round((tierACount / totalRecords) * 100) : 0
  const readinessLevel =
    readinessScore >= 75 ? 'HIGH' : readinessScore >= 40 ? 'MEDIUM' : 'LOW'

  const readinessColour =
    readinessLevel === 'HIGH'
      ? colours.green
      : readinessLevel === 'MEDIUM'
        ? colours.amber
        : colours.red

  const periodStats = await prisma.dataRecord.groupBy({
    by: ['domain'],
    where: { entityId, isActive: true },
    _min: { periodStart: true },
    _max: { periodEnd: true },
  })

  const domainStats: DomainStat[] = [
    'ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS',
    'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE',
  ].map(domain => {
    const tierGroups = domainGroups.filter(g => g.domain === domain)
    const periodGroup = periodStats.find(p => p.domain === domain)
    return {
      domain,
      totalRecords: tierGroups.reduce((s, g) => s + g._count.id, 0),
      tierA: tierGroups.find(g => g.trustTier === 'A')?._count.id ?? 0,
      tierB: tierGroups.find(g => g.trustTier === 'B')?._count.id ?? 0,
      tierC: tierGroups.find(g => g.trustTier === 'C')?._count.id ?? 0,
      periodStart: periodGroup?._min.periodStart?.toISOString() ?? null,
      periodEnd: periodGroup?._max.periodEnd?.toISOString() ?? null,
    }
  })

  const sectionLabel = {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    margin: `0 0 ${spacing[2]}`,
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: spacing[5],
        }}
      >
        <div>
          <h1
            style={{
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              margin: 0,
              letterSpacing: typography.tracking.tight,
            }}
          >
            Dashboard
          </h1>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            {totalRecords} active records across all domains
          </p>
        </div>
        <Link
          href="/upload"
          style={{
            padding: '12px 24px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            borderRadius: '4px',
            textDecoration: 'none',
            letterSpacing: typography.tracking.wide,
            display: 'inline-block',
          }}
        >
          Upload documents
        </Link>
      </div>

      <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[5] }}>
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            padding: spacing[3],
            flex: 1,
          }}
        >
          <p style={sectionLabel}>Readiness score</p>
          <p
            style={{
              fontSize: '36px',
              fontWeight: typography.weights.medium,
              color: readinessColour,
              margin: 0,
              letterSpacing: typography.tracking.tight,
            }}
          >
            {readinessScore}%
          </p>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            {readinessLevel} — {tierACount} of {totalRecords} records at Tier A
          </p>
        </div>
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            padding: spacing[3],
            flex: 1,
          }}
        >
          <p style={sectionLabel}>Outstanding requests</p>
          <p
            style={{
              fontSize: '36px',
              fontWeight: typography.weights.medium,
              color: pendingRequests.length > 0 ? colours.amber : colours.textPrimary,
              margin: 0,
              letterSpacing: typography.tracking.tight,
            }}
          >
            {pendingRequests.length}
          </p>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            {pendingRequests.length === 0 ? 'No pending data requests' : 'awaiting your response'}
          </p>
        </div>
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '6px',
            padding: spacing[3],
            flex: 1,
          }}
        >
          <p style={sectionLabel}>Total records</p>
          <p
            style={{
              fontSize: '36px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              margin: 0,
              letterSpacing: typography.tracking.tight,
            }}
          >
            {totalRecords}
          </p>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `${spacing[1]} 0 0`,
            }}
          >
            across 8 operational domains
          </p>
        </div>
      </div>

      <section style={{ marginBottom: spacing[5] }}>
        <p style={sectionLabel}>Domain coverage</p>
        <DomainGrid stats={domainStats} />
      </section>

      {pendingRequests.length > 0 && (
        <section style={{ marginBottom: spacing[5] }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] }}>
            <p style={{ ...sectionLabel, margin: 0 }}>Pending requests</p>
            <Link
              href="/requests"
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
              }}
            >
              View all
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pendingRequests.map(req => (
              <div
                key={req.id}
                style={{
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '6px',
                  padding: spacing[2],
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: typography.sizes.base,
                      fontWeight: typography.weights.medium,
                      color: colours.textPrimary,
                      margin: 0,
                    }}
                  >
                    {req.buyerEntity.legalName}
                  </p>
                  <p
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                      margin: `2px 0 0`,
                    }}
                  >
                    {req.domain} · {new Date(req.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    {' – '}
                    {new Date(req.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    {req.deadline && ` · Due ${new Date(req.deadline).toLocaleDateString('en-GB')}`}
                  </p>
                </div>
                <Link
                  href="/requests"
                  style={{
                    padding: '8px 16px',
                    backgroundColor: colours.navy,
                    color: colours.surface,
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.medium,
                    borderRadius: '4px',
                    textDecoration: 'none',
                  }}
                >
                  Respond
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {recentDocuments.length > 0 && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] }}>
            <p style={{ ...sectionLabel, margin: 0 }}>Recent documents</p>
            <Link
              href="/records"
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.navy,
                textDecoration: 'none',
              }}
            >
              View records
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recentDocuments.map(doc => {
              const job = doc.extractionJobs[0]
              const statusColour =
                doc.status === 'ACCEPTED' ? colours.green :
                doc.status === 'REVIEW_REQUIRED' ? colours.amber :
                doc.status === 'REJECTED' ? colours.red :
                colours.textTertiary
              return (
                <div
                  key={doc.id}
                  style={{
                    backgroundColor: colours.surface,
                    border: `1px solid ${colours.border}`,
                    borderRadius: '6px',
                    padding: spacing[2],
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <p
                      style={{
                        fontSize: typography.sizes.base,
                        fontWeight: typography.weights.medium,
                        color: colours.textPrimary,
                        margin: 0,
                      }}
                    >
                      {doc.fileName}
                    </p>
                    <p
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        margin: '2px 0 0',
                      }}
                    >
                      {doc.documentType.replace(/_/g, ' ')} · {new Date(doc.submittedAt).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                    <span
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: statusColour,
                        textTransform: 'uppercase',
                        letterSpacing: typography.tracking.wide,
                      }}
                    >
                      {doc.status.replace(/_/g, ' ')}
                    </span>
                    {doc.status === 'REVIEW_REQUIRED' && (
                      <Link
                        href={`/upload/${doc.id}/review`}
                        style={{
                          padding: '6px 14px',
                          backgroundColor: colours.navy,
                          color: colours.surface,
                          fontSize: typography.sizes.sm,
                          fontWeight: typography.weights.medium,
                          borderRadius: '4px',
                          textDecoration: 'none',
                        }}
                      >
                        Review
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
