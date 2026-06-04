import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { colours, typography, spacing } from '@/lib/design-system'

const reports = [
  {
    href: '/reports/scope3',
    title: 'Scope 3 inventory',
    description: 'All fifteen GHG Protocol Scope 3 categories with tier breakdown, coverage report, and gap-close pathway.',
    regulatory: 'GHG Protocol Scope 3 Standard',
  },
  {
    href: '/reports/gri',
    title: 'GRI 305 disclosure',
    description: 'GRI 305-1 (Scope 1), 305-2 (Scope 2), and 305-3 (Scope 3) emissions from certified records.',
    regulatory: 'GRI 305: Emissions 2016',
  },
  {
    href: '/reports/cdp',
    title: 'CDP Climate',
    description: 'CDP Climate Change questionnaire Section C6 pre-filled with verified emissions data and data quality flags.',
    regulatory: 'CDP Climate Change 2024',
  },
  {
    href: '/reports/csrd',
    title: 'CSRD / ESRS E1',
    description: 'Climate change disclosures aligned to European Sustainability Reporting Standard E1.',
    regulatory: 'EU 2023/2772 ESRS E1',
  },
  {
    href: '/reports/audit',
    title: 'Audit package',
    description: 'Structured data package for third-party verifiers: records, source documents, cross-validation results, and audit chain.',
    regulatory: 'Bureau Veritas / SGS / Lloyd\'s Register compatible',
  },
]

export default async function ReportsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div>
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Reports
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Generate regulatory submissions and disclosures from your certified data records.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3] }}>
        {reports.map(report => (
          <div
            key={report.href}
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '8px',
              padding: spacing[4],
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: spacing[3],
            }}
          >
            <div>
              <p
                style={{
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.medium,
                  color: colours.textTertiary,
                  letterSpacing: typography.tracking.wider,
                  textTransform: 'uppercase',
                  margin: `0 0 ${spacing[1]}`,
                }}
              >
                {report.regulatory}
              </p>
              <h2
                style={{
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.medium,
                  color: colours.textPrimary,
                  margin: `0 0 ${spacing[1]}`,
                  letterSpacing: typography.tracking.tight,
                }}
              >
                {report.title}
              </h2>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  margin: 0,
                  lineHeight: '1.5',
                }}
              >
                {report.description}
              </p>
            </div>
            <Link
              href={report.href}
              style={{
                display: 'block',
                padding: '10px 16px',
                backgroundColor: colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                borderRadius: '4px',
                textDecoration: 'none',
                textAlign: 'center',
                letterSpacing: typography.tracking.wide,
              }}
            >
              Open
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
