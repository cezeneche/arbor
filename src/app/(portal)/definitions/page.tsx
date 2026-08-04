import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSessionUser } from '@/lib/session'
import { colours, spacing, textStyles, borders, typography } from '@/lib/design-system'
import { loadDefinitionsOverview } from '@/lib/layer3/definitions-overview'
import { DefinitionsList } from './DefinitionsList'

// The agreed meaning of every figure this company shares.
//
// One primary action: answer the wordings a customer has put to you. Everything
// else on the page is reading. SME suppliers see plain English only; buyers get
// the field name, version and stored unit alongside it (PRD §7, §18).

export default async function DefinitionsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const entityId = getSessionUser(session).entityId as string

  const [entity, overview] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { entityType: true } }),
    loadDefinitionsOverview(entityId),
  ])
  if (!entity) redirect('/login')

  const isBuyer = entity.entityType === 'BUYER'

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[4] }}>
        <h1 style={textStyles.pageTitle}>What your figures mean</h1>
        <p style={{ ...textStyles.pageSubtitle, marginTop: spacing[1] }}>
          Every number you share carries a plain English statement of what it counts and what it
          leaves out. Where a customer has agreed that wording, the agreement travels with the data
          too.
        </p>
      </div>

      {overview.awaitingYou > 0 && (
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
            {overview.awaitingYou === 1
              ? 'One wording is waiting for you to agree it'
              : `${overview.awaitingYou} wordings are waiting for you to agree them`}
          </p>
          <p style={{ ...textStyles.caption, marginTop: '2px' }}>
            Read what it says. If it matches how you record that figure, agree it — your customer
            then knows your number and theirs are counted the same way.
          </p>
        </div>
      )}

      {overview.definitions.length === 0 ? (
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: borders.radius.lg,
            padding: spacing[4],
            textAlign: 'center',
          }}
        >
          <p style={textStyles.sectionTitle}>Nothing to show yet</p>
          <p style={{ ...textStyles.caption, marginTop: spacing[1] }}>
            Wordings appear here once your first records are stored.
          </p>
        </div>
      ) : (
        <DefinitionsList
          definitions={overview.definitions}
          counterparties={overview.counterparties}
          showTechnicalDetail={isBuyer}
        />
      )}

      <p
        style={{
          ...textStyles.caption,
          color: colours.textTertiary,
          marginTop: spacing[3],
          lineHeight: typography.lineHeight.body,
        }}
      >
        Wordings are versioned. Anything you have already shared keeps the wording it was stored
        under, even after the wording changes — nothing you sent in the past is altered by a
        change made today.
      </p>
    </div>
  )
}
