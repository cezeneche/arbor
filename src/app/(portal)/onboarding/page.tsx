import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { colours, typography, spacing } from '@/lib/design-system'

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const sp = await searchParams
  const customerName = sp.from ?? null

  return (
    <div
      style={{
        maxWidth: '560px',
        margin: '0 auto',
        paddingTop: spacing[6],
      }}
    >
      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[6],
        }}
      >
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.textTertiary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            margin: `0 0 ${spacing[3]}`,
          }}
        >
          Welcome to Arbor
        </p>

        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: `0 0 ${spacing[2]}`,
            letterSpacing: typography.tracking.tight,
          }}
        >
          {customerName
            ? `${customerName} needs some data from you`
            : 'Arbor organises your business documents'}
        </h1>

        <p
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `0 0 ${spacing[4]}`,
            lineHeight: '1.6',
          }}
        >
          {customerName
            ? `${customerName} has asked for emissions data related to your supplies. Arbor helps you respond using documents you already have.`
            : 'Arbor organises your business documents so you can answer customer data requests quickly and accurately. Your customers may ask you for this data — having it ready means you can respond in minutes instead of days.'}
        </p>

        <div
          style={{
            backgroundColor: colours.background,
            borderRadius: '6px',
            padding: spacing[3],
            marginBottom: spacing[4],
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              margin: `0 0 ${spacing[2]}`,
            }}
          >
            Here is what you will do
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              { n: '1', text: 'Upload the documents you already have — invoices, energy bills, delivery notes, production records.' },
              { n: '2', text: 'Arbor reads them and stores the information. You confirm anything it is not sure about.' },
              { n: '3', text: 'Share your data when a customer asks. It will already be there.' },
            ].map(step => (
              <div key={step.n} style={{ display: 'flex', gap: spacing[2], alignItems: 'flex-start' }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: colours.navy,
                    color: colours.surface,
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {step.n}
                </span>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    margin: 0,
                    lineHeight: '1.5',
                    paddingTop: '3px',
                  }}
                >
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="/upload"
          style={{
            display: 'block',
            padding: '14px 24px',
            backgroundColor: colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            borderRadius: '4px',
            textDecoration: 'none',
            textAlign: 'center',
            letterSpacing: typography.tracking.wide,
          }}
        >
          Upload your first document
        </Link>

        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.light,
            color: colours.textTertiary,
            textAlign: 'center',
            margin: `${spacing[2]} 0 0`,
          }}
        >
          No sustainability knowledge required.
        </p>
      </div>
    </div>
  )
}
