import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'

interface ParsedShape {
  parsed?: { domain?: string | null; fields?: string[]; periodStart?: string | null; periodEnd?: string | null }
  missingFields?: string[]
  reason?: string
}

export default async function InboundRequestsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const startOfMonth = new Date()
  startOfMonth.setUTCDate(1)
  startOfMonth.setUTCHours(0, 0, 0, 0)

  const [entity, answeredThisMonth, needsData, recentAnswered] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { uploadEmailToken: true } }),
    prisma.inboundRequest.count({ where: { entityId, status: 'ANSWERED', answeredAt: { gte: startOfMonth } } }),
    prisma.inboundRequest.findMany({ where: { entityId, status: 'NEEDS_DATA' }, orderBy: { createdAt: 'desc' } }),
    prisma.inboundRequest.findMany({ where: { entityId, status: 'ANSWERED' }, orderBy: { answeredAt: 'desc' }, take: 5 }),
  ])

  const requestsEmail = entity?.uploadEmailToken ? `requests-${entity.uploadEmailToken}@arbor.io` : null

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[3] }}>
        <Link href="/requests" style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, textDecoration: 'none' }}>
          ← Requests
        </Link>
      </div>
      <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
        Email requests
      </h1>
      <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 ${spacing[4]}`, maxWidth: '640px' }}>
        When a customer emails a data request to your Arbor address, we read it and answer it straight from your
        certified records. You only need to look here when something is missing.
      </p>

      {/* Answered-this-month headline */}
      <div style={{ display: 'flex', gap: spacing[2], marginBottom: spacing[4] }}>
        <div style={{ flex: 1, padding: spacing[3], backgroundColor: colours.greenBg, border: `1px solid ${colours.green}`, borderRadius: '8px' }}>
          <div style={{ fontSize: typography.sizes.hero, fontWeight: typography.weights.light, color: colours.green, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {answeredThisMonth}
          </div>
          <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: '6px' }}>
            request{answeredThisMonth === 1 ? '' : 's'} answered automatically this month
          </div>
        </div>
        <div style={{ flex: 1, padding: spacing[3], backgroundColor: needsData.length > 0 ? colours.amberBg : colours.surface, border: `1px solid ${needsData.length > 0 ? colours.amber : colours.border}`, borderRadius: '8px' }}>
          <div style={{ fontSize: typography.sizes.hero, fontWeight: typography.weights.light, color: needsData.length > 0 ? colours.amber : colours.textTertiary, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {needsData.length}
          </div>
          <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: '6px' }}>
            need{needsData.length === 1 ? 's' : ''} data you haven&apos;t uploaded yet
          </div>
        </div>
      </div>

      {requestsEmail && (
        <div style={{ marginBottom: spacing[4], padding: spacing[2], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
          <p style={{ margin: 0, fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wide, textTransform: 'uppercase' }}>
            Your requests address
          </p>
          <p style={{ margin: '6px 0 0', fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textPrimary, fontFamily: 'monospace' }}>
            {requestsEmail}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary }}>
            Give this to customers, or forward their requests here.
          </p>
        </div>
      )}

      {/* Needs data */}
      {needsData.length > 0 && (
        <div style={{ marginBottom: spacing[4] }}>
          <h2 style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            Needs your attention
          </h2>
          <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {needsData.map((r, i) => {
              const pf = (r.parsedFields ?? {}) as ParsedShape
              const missing = pf.missingFields ?? []
              return (
                <div key={r.id} style={{ padding: `${spacing[2]} ${spacing[3]}`, borderBottom: i < needsData.length - 1 ? `1px solid ${colours.border}` : 'none', backgroundColor: colours.amberBg }}>
                  <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                    {r.fromEmail ?? 'A customer'} asked for data {pf.parsed?.domain ? `(${pf.parsed.domain.replace(/_/g, ' ').toLowerCase()})` : ''}
                  </div>
                  <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, marginTop: '4px' }}>
                    {missing.length > 0
                      ? `Missing: ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')}. Upload a document covering this to answer it.`
                      : pf.reason === 'could_not_parse'
                        ? "We couldn't tell exactly what was being asked — open the email and respond manually."
                        : 'Some requested data is not in your records yet.'}
                  </div>
                  <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, marginTop: '6px' }}>
                    {new Date(r.createdAt).toLocaleDateString('en-GB')}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recently answered */}
      {recentAnswered.length > 0 && (
        <div>
          <h2 style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            Recently answered for you
          </h2>
          <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {recentAnswered.map((r, i) => {
              const pf = (r.parsedFields ?? {}) as ParsedShape
              return (
                <div key={r.id} style={{ padding: `${spacing[2]} ${spacing[3]}`, borderBottom: i < recentAnswered.length - 1 ? `1px solid ${colours.border}` : 'none', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary }}>
                    {r.fromEmail ?? 'A customer'} {pf.parsed?.domain ? `· ${pf.parsed.domain.replace(/_/g, ' ').toLowerCase()}` : ''}
                  </span>
                  <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.green }}>
                    Answered {r.answeredAt ? new Date(r.answeredAt).toLocaleDateString('en-GB') : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {needsData.length === 0 && recentAnswered.length === 0 && (
        <div style={{ padding: spacing[6], textAlign: 'center', backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
          <p style={{ margin: 0, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
            No email requests yet. When one arrives, we&apos;ll answer it from your records and show it here.
          </p>
        </div>
      )}
    </div>
  )
}
