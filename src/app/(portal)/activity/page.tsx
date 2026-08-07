import { redirect } from 'next/navigation'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { BackLink } from '@/components/BackLink'
import { Pagination, PAGE_SIZE } from '@/components/Pagination'

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Record created',
  CREATED_VIA_SUBMISSION_LINK: 'Record created via submission link',
  SUPERSEDED: 'Record superseded',
  CORRECTED: 'Record corrected',
  TIER_UPGRADED: 'Trust tier upgraded',
  CHAIN_VERIFIED: 'Audit chain verified',
}

function eventColour(eventType: string): string {
  if (eventType.startsWith('CREATED')) return colours.green
  if (eventType === 'SUPERSEDED' || eventType === 'CORRECTED') return colours.amber
  if (eventType === 'TIER_UPGRADED') return colours.navy
  return colours.textTertiary
}

function relativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = getSessionUser(session).entityId as string
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1', 10))

  const [auditEntries, total] = await Promise.all([
    prisma.auditEntry.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEntry.count({ where: { entityId } }),
  ])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const recordIds = [...new Set(auditEntries.map(e => e.recordId))]
  const records = await prisma.dataRecord.findMany({
    where: { id: { in: recordIds } },
    select: {
      id: true, domain: true, fieldName: true, trustTier: true,
      isActive: true, periodStart: true, periodEnd: true,
    },
  })
  const recordMap = new Map(records.map(r => [r.id, r]))

  // Group this page's entries by date
  const dateKeys: string[] = []
  const seen = new Set<string>()
  for (const e of auditEntries) {
    const k = new Date(e.createdAt).toDateString()
    if (!seen.has(k)) { seen.add(k); dateKeys.push(k) }
  }

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
      <BackLink current="Activity" />
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>
          Activity
        </h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          Full history of document submissions, extractions, and data record changes.
        </p>
      </div>

      {total === 0 ? (
        <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', padding: spacing[5], textAlign: 'center' }}>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0 }}>
            No activity yet. Upload your first document to get started.
          </p>
        </div>
      ) : (
        <>
          <div>
            {dateKeys.map(dateKey => {
              const dayEntries = auditEntries.filter(e => new Date(e.createdAt).toDateString() === dateKey)
              const label = relativeTime(new Date(dateKey))

              return (
                <div key={dateKey} style={{ marginBottom: spacing[4] }}>
                  <p style={sectionLabel}>{label}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', backgroundColor: colours.border, borderRadius: '8px', overflow: 'hidden' }}>
                    {dayEntries.map(entry => {
                      const record = recordMap.get(entry.recordId)
                      const payload = entry.payload as Record<string, unknown>
                      const eventLabel = EVENT_LABELS[entry.eventType] ?? entry.eventType.replace(/_/g, ' ').toLowerCase()
                      const colour = eventColour(entry.eventType)
                      const domainLabel = record ? (DOMAIN_LABELS[record.domain] ?? record.domain) : null
                      const fieldLabel = record ? record.fieldName.replace(/_/g, ' ') : null
                      const periodLabel = record
                        ? [
                            new Date(record.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
                            new Date(record.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
                          ].join(' – ')
                        : null

                      return (
                        <div
                          key={entry.id}
                          style={{
                            backgroundColor: colours.surface,
                            padding: `12px ${spacing[2]}`,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: spacing[2],
                          }}
                        >
                          <div
                            style={{
                              flexShrink: 0,
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: colour,
                              marginTop: '6px',
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] }}>
                              <div>
                                <p style={textStyles.rowTitle}>
                                  {eventLabel}
                                </p>
                                {record && (
                                  <p style={{ ...textStyles.caption, margin: '2px 0 0' }}>
                                    {domainLabel}
                                    {fieldLabel ? ` · ${fieldLabel}` : ''}
                                    {periodLabel ? ` · ${periodLabel}` : ''}
                                    {!record.isActive && (
                                      <span style={{ color: colours.amber, marginLeft: '6px' }}>(superseded)</span>
                                    )}
                                  </p>
                                )}
                                {!record && (payload.domain as string | undefined) && (
                                  <p style={{ ...textStyles.caption, margin: '2px 0 0' }}>
                                    {DOMAIN_LABELS[payload.domain as string] ?? String(payload.domain as string)}
                                    {(payload.fieldName as string | undefined) ? ` · ${String(payload.fieldName as string).replace(/_/g, ' ')}` : ''}
                                  </p>
                                )}
                              </div>
                              <p style={{ flexShrink: 0, fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0, whiteSpace: 'nowrap' }}>
                                {new Date(entry.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0', fontFamily: 'monospace' }}>
                              {entry.hash.substring(0, 16)}…
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            buildUrl={(p) => p > 1 ? `/activity?page=${p}` : '/activity'}
          />

          <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, textAlign: 'center', marginTop: spacing[2] }}>
            {total.toLocaleString()} events total · Every event is part of an unbroken cryptographic audit chain
          </p>
        </>
      )}
    </div>
  )
}
