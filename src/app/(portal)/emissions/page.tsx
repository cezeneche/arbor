import Link from 'next/link'
import { requirePageSession } from '@/lib/page-auth'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

// The parent Emissions section. Built from day one with a single child, so
// Sustainability (scopes 1–3) slots in later without a URL migration and without
// rearranging the nav in front of users who have already learned it.

export default async function EmissionsPage() {
  await requirePageSession()

  const modules = [
    {
      href: '/emissions/cbam',
      name: 'CBAM',
      description:
        'Carbon Border Adjustment Mechanism. Import declarations, embedded emissions and carbon price relief.',
      available: true,
    },
    {
      href: null,
      name: 'Sustainability',
      description: 'Scopes 1–3 reporting, built on the same certified records.',
      available: false,
    },
  ]

  return (
    <div>
      <h1 style={textStyles.pageTitle}>Emissions</h1>
      <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 ${spacing[5]}` }}>
        Reporting built on the operational data you have already certified.
      </p>

      <div style={{ display: 'grid', gap: spacing[2], maxWidth: '640px' }}>
        {modules.map(module => {
          const body = (
            <div
              style={{
                border: `1px solid ${colours.border}`,
                borderRadius: '6px',
                padding: spacing[3],
                backgroundColor: module.available ? colours.surface : 'transparent',
                opacity: module.available ? 1 : 0.55,
              }}
            >
              <div
                style={{
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.medium,
                  color: colours.textPrimary,
                  marginBottom: '4px',
                }}
              >
                {module.name}
                {!module.available && (
                  <span
                    style={{
                      marginLeft: spacing[1],
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.light,
                      color: colours.textSecondary,
                    }}
                  >
                    Not yet available
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                }}
              >
                {module.description}
              </div>
            </div>
          )

          return module.href ? (
            <Link key={module.name} href={module.href} style={{ textDecoration: 'none' }}>
              {body}
            </Link>
          ) : (
            <div key={module.name}>{body}</div>
          )
        })}
      </div>
    </div>
  )
}
