import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requirePageOperator } from '@/lib/page-auth'
import { getSessionUser } from '@/lib/session'
import { decideEntityLink } from '@/lib/entity-resolution/decide'
import { describeMatch, type MatchIdentity } from '@/lib/entity-resolution/match-view'
import { colours, controls, spacing, textStyles, typography } from '@/lib/design-system'

export const metadata: Metadata = { title: 'Matches | Arbor' }

// Proposed company matches from the weekly resolution job. Each pair may span
// two customers' organisations, which is why only operators see this page.
// Deciding records the verdict on the link; the companies and their records are
// never merged or changed.

async function decide(formData: FormData) {
  'use server'
  const session = await requirePageOperator()
  const id = formData.get('id')
  const action = formData.get('action')
  if (typeof id !== 'string' || !id || (action !== 'confirm' && action !== 'reject')) {
    throw new Error('Invalid match decision')
  }
  // Already decided by someone else: the reload shows it gone, which is the answer.
  await decideEntityLink(prisma, { id, action, userId: getSessionUser(session).id as string })
  revalidatePath('/admin/matches')
}

function Company({ entity }: { entity: MatchIdentity }) {
  const details = [entity.registrationNumber, entity.country, entity.sector].filter(Boolean).join(' · ')
  return (
    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
      <p style={textStyles.rowTitle}>{entity.legalName}</p>
      <p style={{ ...textStyles.caption, margin: `${spacing[1]} 0 0` }}>{details || 'No other details'}</p>
    </div>
  )
}

export default async function MatchesPage() {
  await requirePageOperator()
  const identity = { select: { legalName: true, registrationNumber: true, country: true, sector: true } }
  const links = await prisma.entityLink.findMany({
    where: { status: 'PENDING' },
    orderBy: { similarity: 'desc' },
    take: 200,
    select: {
      id: true,
      similarity: true,
      method: true,
      createdAt: true,
      entityA: identity,
      entityB: identity,
    },
  })

  return (
    <div style={{ width: '100%', color: colours.textPrimary }}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>Matches</h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          {links.length === 0
            ? 'No proposed matches to check. The matching job runs every Monday.'
            : `${links.length} pair${links.length === 1 ? '' : 's'} of companies that may be the same. Confirming one counts them as one company in benchmarks; nothing is merged.`}
        </p>
      </div>
      <div style={{ display: 'grid', gap: spacing[2] }}>
        {links.map(link => {
          const view = describeMatch(link)
          return (
            <article
              key={link.id}
              style={{
                background: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '6px',
                padding: spacing[3],
                overflowWrap: 'anywhere',
                display: 'flex',
                flexDirection: 'column',
                gap: spacing[2],
              }}
            >
              <div style={{ display: 'flex', gap: spacing[3], flexWrap: 'wrap' }}>
                <Company entity={link.entityA} />
                <Company entity={link.entityB} />
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  lineHeight: typography.lineHeight.body,
                }}
              >
                Names {view.percent}% alike
                {view.agreements.length > 0 && ` · ${view.agreements.join(' · ')}`}
                {view.conflicts.length > 0 && (
                  <span style={{ color: colours.red }}> · {view.conflicts.join(' · ')}</span>
                )}
              </p>
              <span style={{ ...textStyles.caption, color: colours.textTertiary }}>
                Proposed {link.createdAt.toLocaleDateString('en-GB', { timeZone: 'Europe/London' })} ·{' '}
                {link.method}
              </span>
              <form
                action={decide}
                style={{
                  display: 'flex',
                  gap: spacing[2],
                  flexWrap: 'wrap',
                  borderTop: `1px solid ${colours.border}`,
                  paddingTop: spacing[2],
                }}
              >
                <input type="hidden" name="id" value={link.id} />
                <button type="submit" name="action" value="confirm" style={controls.primaryButton}>
                  Same company
                </button>
                <button type="submit" name="action" value="reject" style={controls.secondaryButton}>
                  Different companies
                </button>
              </form>
            </article>
          )
        })}
      </div>
    </div>
  )
}
