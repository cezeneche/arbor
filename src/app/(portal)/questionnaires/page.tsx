import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { colours, typography, spacing } from '@/lib/design-system'
import { listTemplates } from '@/lib/questionnaires/templates'

export default async function QuestionnairesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const templates = listTemplates()

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[3] }}>
        <Link href="/requests" style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, textDecoration: 'none' }}>
          ← Requests
        </Link>
      </div>
      <h1
        style={{
          fontSize: typography.sizes.lg,
          fontWeight: typography.weights.medium,
          color: colours.textPrimary,
          margin: 0,
          letterSpacing: typography.tracking.tight,
        }}
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
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    margin: `6px 0 0`,
                  }}
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
