import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, trustTierConfig } from '@/lib/design-system'
import { getTemplate } from '@/lib/questionnaires/templates'
import { toPrefillRecords } from '@/lib/questionnaires/load'
import { prefillQuestionnaire } from '@/lib/questionnaires/prefill'
import type { PrefilledAnswer } from '@/lib/questionnaires/types'
import { PrefillExport } from '@/components/PrefillExport'

function PlainTierChip({ tier }: { tier: 'A' | 'B' | 'C' }) {
  const c = trustTierConfig[tier]
  return (
    <span
      title={c.description}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.medium,
        letterSpacing: typography.tracking.wide,
        color: c.colour,
        backgroundColor: c.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {c.label}
    </span>
  )
}

export default async function QuestionnaireDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ template: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = (session.user as Record<string, unknown>).entityId as string

  const { template: templateId } = await params
  const template = getTemplate(templateId)
  if (!template || template.status !== 'available') notFound()

  const sp = await searchParams
  const periodStart = sp.periodStart && !isNaN(Date.parse(sp.periodStart)) ? new Date(sp.periodStart) : undefined
  const periodEnd = sp.periodEnd && !isNaN(Date.parse(sp.periodEnd)) ? new Date(sp.periodEnd) : undefined

  const stored = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
      ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
    },
    select: {
      id: true, domain: true, fieldName: true, value: true, unit: true,
      trustTier: true, periodStart: true, periodEnd: true,
    },
  })

  const answers = prefillQuestionnaire(template, toPrefillRecords(template, stored))
  const answered = answers.filter((a) => a.status === 'answered').length
  const gaps = answers.length - answered

  // Group answers in template order by section.
  const sections: { name: string; answers: PrefilledAnswer[] }[] = []
  for (const a of answers) {
    const name = a.section ?? 'Other'
    let group = sections.find((s) => s.name === name)
    if (!group) {
      group = { name, answers: [] }
      sections.push(group)
    }
    group.answers.push(a)
  }

  return (
    <div style={{ maxWidth: '880px' }}>
      <Link
        href="/questionnaires"
        style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none' }}
      >
        ← All questionnaires
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3], margin: `${spacing[2]} 0 ${spacing[3]}` }}>
        <div>
          <h1 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0, letterSpacing: typography.tracking.tight }}>
            {template.name}
          </h1>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
            {answered} of {answers.length} answered from your records{gaps > 0 ? ` · ${gaps} still need data` : ''}
          </p>
        </div>
        <PrefillExport templateId={template.id} answers={answers} />
      </div>

      {/* Period filter — inline, no modal. */}
      <form
        method="get"
        style={{ display: 'flex', alignItems: 'flex-end', gap: spacing[2], marginBottom: spacing[3], padding: spacing[2], backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}
      >
        <label style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
          <div style={{ marginBottom: '4px' }}>From</div>
          <input type="date" name="periodStart" defaultValue={sp.periodStart ?? ''} style={inputStyle} />
        </label>
        <label style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>
          <div style={{ marginBottom: '4px' }}>To</div>
          <input type="date" name="periodEnd" defaultValue={sp.periodEnd ?? ''} style={inputStyle} />
        </label>
        <button
          type="submit"
          style={{ padding: '8px 18px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Apply period
        </button>
        {(periodStart || periodEnd) && (
          <Link href={`/questionnaires/${template.id}`} style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, textDecoration: 'none' }}>
            Clear
          </Link>
        )}
      </form>

      {sections.map((section) => (
        <div key={section.name} style={{ marginBottom: spacing[3] }}>
          <h2 style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.textTertiary, letterSpacing: typography.tracking.wider, textTransform: 'uppercase', margin: `0 0 ${spacing[1]}` }}>
            {section.name}
          </h2>
          <div style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {section.answers.map((a, i) => {
              const isGap = a.status === 'gap'
              return (
                <div
                  key={a.questionId}
                  style={{
                    padding: `${spacing[2]} ${spacing[3]}`,
                    borderBottom: i < section.answers.length - 1 ? `1px solid ${colours.border}` : 'none',
                    backgroundColor: isGap ? colours.amberBg : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[3], alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                        {a.questionText}
                      </p>
                      {a.note && (
                        <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '4px 0 0' }}>
                          {a.note}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isGap ? (
                        <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.amber }}>
                          No data yet
                        </span>
                      ) : a.mode === 'collection' ? (
                        <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                          {a.contributingCount} record{a.contributingCount === 1 ? '' : 's'} attached
                        </span>
                      ) : (
                        <span style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                          {a.value!.toLocaleString('en-GB', { maximumFractionDigits: 2 })} {a.unit}
                        </span>
                      )}
                      <div style={{ marginTop: '6px' }}>
                        {a.trustTier ? <PlainTierChip tier={a.trustTier} /> : null}
                      </div>
                    </div>
                  </div>
                  {isGap && (
                    <Link
                      href="/upload"
                      style={{ display: 'inline-block', marginTop: spacing[1], fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.navy, textDecoration: 'none' }}
                    >
                      Upload a document to answer this →
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const inputStyle = {
  padding: '7px 10px',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  backgroundColor: colours.surface,
} as const
