import Link from 'next/link'
import { requirePageSession } from '@/lib/page-auth'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { BackLink } from '@/components/BackLink'
import { listTemplates } from '@/lib/questionnaires/templates'

export default async function QuestionnairesPage() {
  await requirePageSession()

  const templates = listTemplates()

  return (
    <div style={{ width: '100%' }}>
      <BackLink current="Questionnaires" />
      <h1
        style={textStyles.pageTitle}
      >
        Questionnaires
      </h1>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `${spacing[1]} 0 ${spacing[4]}`,
          maxWidth: '640px',
        }}
      >
        Pick a questionnaire and Arbor fills in the answers from the documents you have already uploaded -
        so you answer the question once. Each answer shows where it came from and how trustworthy it is.
      </p>

      <div style={{ display: 'grid', gap: spacing[2], width: '100%' }}>
        {templates.map((t) => {
          const available = t.status === 'available'
          const card = (
            <div
              style={{
                padding: spacing[3],
                backgroundColor: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: spacing[3],
                opacity: available ? 1 : 0.6,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1] }}>
                  <span
                    style={{
                      fontSize: typography.sizes.base,
                      fontWeight: typography.weights.medium,
                      color: colours.textPrimary,
                    }}
                  >
                    {t.name}
                  </span>
                  {!available && (
                    <span
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.medium,
                        color: colours.textTertiary,
                        backgroundColor: colours.background,
                        border: `1px solid ${colours.border}`,
                        borderRadius: '4px',
                        padding: '2px 8px',
                        letterSpacing: typography.tracking.wide,
                        textTransform: 'uppercase',
                      }}
                    >
                      Coming soon
                    </span>
                  )}
                </div>
                <p
                  style={{ ...textStyles.sectionSubtitle, margin: `6px 0 0` }}
                >
                  {t.description}
                </p>
              </div>
              {available && (
                <span
                  style={{
                    flexShrink: 0,
                    padding: '10px 20px',
                    backgroundColor: colours.navy,
                    color: colours.surface,
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.medium,
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Fill it in →
                </span>
              )}
            </div>
          )

          return available ? (
            <Link key={t.id} href={`/questionnaires/${t.id}`} style={{ textDecoration: 'none' }}>
              {card}
            </Link>
          ) : (
            <div key={t.id}>{card}</div>
          )
        })}
      </div>
    </div>
  )
}
