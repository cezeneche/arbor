import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/session'
import { colours, spacing, textStyles, borders, typography } from '@/lib/design-system'
import { BackLink } from '@/components/BackLink'
import { summariseStewardWorkload, type WorkloadFlag } from '@/lib/layer3/steward-workload'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { StewardEditor } from './StewardEditor'
import type { DataDomain } from '@/lib/constants'

// Who looks after which kind of data.
//
// The store has always recorded who entered a figure. This records who owns it
// being right — and the workload panel makes an unowned queue impossible to miss,
// because "nobody's job" is the failure this screen exists to prevent.

export default async function StewardsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const user = getSessionUser(session)
  const entityId = user.entityId as string
  const canEdit = user.role === 'ADMIN'

  const [stewards, members, flags] = await Promise.all([
    prisma.domainSteward.findMany({
      where: { entityId },
      select: { domain: true, userId: true, user: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { entityId, isActive: true, role: { notIn: ['SYSTEM'] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
    prisma.validationFlag.findMany({
      where: { resolvedAt: null, dataRecord: { entityId } },
      select: {
        id: true,
        severity: true,
        assigneeId: true,
        dueAt: true,
        resolvedAt: true,
        escalatedAt: true,
        assignee: { select: { name: true } },
        dataRecord: { select: { domain: true } },
      },
    }),
  ])

  const workloadFlags: WorkloadFlag[] = flags.map(f => ({
    id: f.id,
    severity: f.severity,
    assigneeId: f.assigneeId,
    assigneeName: f.assignee?.name ?? null,
    domain: f.dataRecord.domain as DataDomain,
    dueAt: f.dueAt,
    resolvedAt: f.resolvedAt,
    escalatedAt: f.escalatedAt,
  }))

  const stewardByDomain = new Map(stewards.map(s => [s.domain as string, s]))
  const coverage = Object.keys(DOMAIN_LABELS).map(domain => {
    const s = stewardByDomain.get(domain)
    return {
      domain,
      domainLabel: DOMAIN_LABELS[domain],
      stewardUserId: s?.userId ?? null,
      stewardName: s?.user.name ?? null,
      openFlags: workloadFlags.filter(f => f.domain === domain).length,
    }
  })

  const workload = summariseStewardWorkload(workloadFlags, new Date())
  const gaps = coverage.filter(c => !c.stewardUserId && c.openFlags > 0)

  const sectionStyle = {
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: borders.radius.lg,
    padding: spacing[3],
  }

  return (
    <div style={{ width: '100%' }}>
      <BackLink current="Who looks after what" />
      <div style={{ marginBottom: spacing[4] }}>
        <h1 style={textStyles.pageTitle}>Who looks after what</h1>
        <p style={{ ...textStyles.pageSubtitle, marginTop: spacing[1] }}>
          Name one person for each kind of data. When something needs checking, it goes to them by
          name instead of sitting in a list nobody owns.
        </p>
      </div>

      {gaps.length > 0 && (
        <div
          style={{
            backgroundColor: colours.amberBg,
            border: `1px solid ${colours.amber}`,
            borderRadius: borders.radius.lg,
            padding: spacing[2],
            marginBottom: spacing[3],
          }}
        >
          <p style={{ ...textStyles.rowTitle, color: colours.amber }}>
            {gaps.length === 1
              ? `${gaps[0].domainLabel} has things to check and nobody looking after it`
              : `${gaps.length} kinds of data have things to check and nobody looking after them`}
          </p>
          <p style={{ ...textStyles.caption, marginTop: '2px' }}>
            Until someone is named, these go to whoever administers the account.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
        <div style={sectionStyle}>
          <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>Data owners</p>
          <p style={{ ...textStyles.sectionSubtitle, marginBottom: spacing[2] }}>
            {canEdit
              ? 'Changes save as you make them.'
              : 'Only an administrator can change these.'}
          </p>
          <StewardEditor coverage={coverage} members={members} canEdit={canEdit} />
        </div>

        {workload.length > 0 && (
          <div style={sectionStyle}>
            <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>
              What is outstanding
            </p>
            <p style={{ ...textStyles.sectionSubtitle, marginBottom: spacing[2] }}>
              Open items by owner. Anything past its date is shown first.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {workload.map(row => (
                <div
                  key={row.assigneeId ?? 'unassigned'}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: spacing[2],
                    paddingTop: '10px',
                    borderTop: `1px solid ${colours.border}`,
                  }}
                >
                  <div>
                    <p
                      style={{
                        ...textStyles.rowTitle,
                        color: row.assigneeId === null ? colours.amber : colours.textPrimary,
                      }}
                    >
                      {row.assigneeName}
                    </p>
                    <p style={{ ...textStyles.caption, marginTop: '2px' }}>
                      {row.domains.map(d => DOMAIN_LABELS[d] ?? d).join(', ')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: spacing[2], alignItems: 'baseline' }}>
                    <span style={{ ...textStyles.value, fontWeight: typography.weights.medium }}>
                      {row.open} open
                    </span>
                    {row.overdue > 0 && (
                      <span
                        style={{
                          ...textStyles.caption,
                          color: colours.red,
                          fontWeight: typography.weights.medium,
                        }}
                      >
                        {row.overdue} past due
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p
        style={{
          ...textStyles.caption,
          color: colours.textTertiary,
          marginTop: spacing[3],
          lineHeight: typography.lineHeight.body,
        }}
      >
        Urgent items are due within three days, everything else within two weeks, and notes carry no
        deadline at all. Nothing here changes your stored data — it only decides who is asked to look
        at it.
      </p>
    </div>
  )
}
