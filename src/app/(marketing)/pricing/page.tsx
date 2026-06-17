import Link from 'next/link'
import { colours, typography } from '@/lib/design-system'

const container = {
  maxWidth: '1140px',
  margin: '0 auto',
  padding: '0 40px',
}

interface Plan {
  name: string
  price: string
  period: string
  description: string
  features: string[]
  highlighted?: boolean
  cta: string
}

const supplierPlans: Plan[] = [
  {
    name: 'Starter',
    price: 'Free',
    period: '',
    description: 'Respond to data requests from buyers. No uploading, no certified records.',
    features: [
      'Respond to buyer data requests',
      'Up to 5 manual declarations',
      'Standard trust tier labels',
      'arbor data portal access',
    ],
    cta: 'Get started free',
  },
  {
    name: 'Micro',
    price: '£29',
    period: '/month',
    description: 'For small manufacturers beginning to build a certified data record.',
    features: [
      'Up to 500 active records',
      '10 document uploads per month',
      'AI extraction and review',
      'HMAC audit chain',
      'Buyer data request handling',
      'Email notifications',
    ],
    cta: 'Get started',
  },
  {
    name: 'Small',
    price: '£79',
    period: '/month',
    description: 'For growing businesses with regular document submission workflows.',
    features: [
      'Up to 2,500 active records',
      '50 document uploads per month',
      'AI extraction and review',
      'HMAC audit chain',
      'Sector benchmark access',
      'API read access',
      'Buyer data request handling',
      'Priority email support',
    ],
    highlighted: true,
    cta: 'Get started',
  },
  {
    name: 'Growth',
    price: '£149',
    period: '/month',
    description: 'For established manufacturers with high-volume data obligations.',
    features: [
      'Up to 10,000 active records',
      'Unlimited document uploads',
      'AI extraction and review',
      'HMAC audit chain',
      'Sector benchmark access',
      'Full API access',
      'Bulk export (CSV, JSON)',
      'Buyer data request handling',
      'Dedicated onboarding',
    ],
    cta: 'Get started',
  },
]

const buyerPlans: Plan[] = [
  {
    name: 'Standard',
    price: '£299',
    period: '/month',
    description: 'For procurement teams beginning to collect certified supplier data.',
    features: [
      'Connect up to 10 supplier entities',
      'Structured data request tools',
      'Certified record access',
      'Basic query and filter',
      'CSV export',
      'API read access',
    ],
    cta: 'Get started',
  },
  {
    name: 'Business',
    price: '£699',
    period: '/month',
    description: 'For supply chain teams managing mid-size supplier portfolios.',
    features: [
      'Connect up to 50 supplier entities',
      'Structured data request tools',
      'Certified record access',
      'Advanced cross-supplier query',
      'CSV and JSON export',
      'Full API access',
      'Trust tier filtering',
      'Priority support',
    ],
    highlighted: true,
    cta: 'Get started',
  },
  {
    name: 'Enterprise',
    price: '£1,499',
    period: '/month',
    description: 'For large buyers with extensive supply chains and compliance requirements.',
    features: [
      'Unlimited supplier entities',
      'Structured data request tools',
      'Certified record access',
      'Advanced cross-supplier query',
      'All export formats',
      'Full API access with higher rate limits',
      'Data Processing Agreement included',
      'SLA and uptime guarantee',
      'Dedicated customer success',
      'Custom integration support',
    ],
    cta: 'Contact us',
  },
]

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      style={{
        backgroundColor: plan.highlighted ? colours.navy : colours.surface,
        border: `1px solid ${plan.highlighted ? colours.navy : colours.border}`,
        borderRadius: '6px',
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ marginBottom: '24px' }}>
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: plan.highlighted ? 'rgba(255,255,255,0.5)' : colours.textTertiary,
            letterSpacing: '0.14em',
            textTransform: 'uppercase' as const,
            margin: '0 0 8px',
          }}
        >
          {plan.name}
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
          <span
            style={{
              fontSize: '32px',
              fontWeight: typography.weights.medium,
              color: plan.highlighted ? '#FFFFFF' : colours.textPrimary,
              letterSpacing: typography.tracking.tight,
              lineHeight: 1,
            }}
          >
            {plan.price}
          </span>
          {plan.period && (
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: plan.highlighted ? 'rgba(255,255,255,0.5)' : colours.textTertiary,
              }}
            >
              {plan.period}
            </span>
          )}
        </div>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: plan.highlighted ? 'rgba(255,255,255,0.6)' : colours.textSecondary,
            lineHeight: '1.5',
            margin: 0,
          }}
        >
          {plan.description}
        </p>
      </div>

      <div style={{ flex: 1, marginBottom: '28px' }}>
        {plan.features.map(feature => (
          <div
            key={feature}
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              marginBottom: '8px',
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                backgroundColor: plan.highlighted ? 'rgba(255,255,255,0.4)' : colours.navy,
                marginTop: '6px',
              }}
            />
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: plan.highlighted ? 'rgba(255,255,255,0.65)' : colours.textSecondary,
                lineHeight: '1.4',
              }}
            >
              {feature}
            </span>
          </div>
        ))}
      </div>

      {plan.cta === 'Contact us' ? (
        <a
          href="mailto:hello@arbor.io"
          style={{
            display: 'block',
            textAlign: 'center' as const,
            padding: '11px 20px',
            backgroundColor: plan.highlighted ? colours.surface : colours.navy,
            color: plan.highlighted ? colours.navy : colours.surface,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            textDecoration: 'none',
            borderRadius: '4px',
            letterSpacing: typography.tracking.normal,
          }}
        >
          {plan.cta}
        </a>
      ) : (
        <Link
          href="/signup"
          style={{
            display: 'block',
            textAlign: 'center' as const,
            padding: '11px 20px',
            backgroundColor: plan.highlighted ? colours.surface : colours.navy,
            color: plan.highlighted ? colours.navy : colours.surface,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
            textDecoration: 'none',
            borderRadius: '4px',
            letterSpacing: typography.tracking.normal,
          }}
        >
          {plan.cta}
        </Link>
      )}
    </div>
  )
}

export default function PricingPage() {
  return (
    <div>
      {/* Header */}
      <section
        style={{
          backgroundColor: colours.surface,
          borderBottom: `1px solid ${colours.border}`,
          padding: '72px 0 56px',
        }}
      >
        <div style={container}>
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: '0.18em',
              textTransform: 'uppercase' as const,
              display: 'block',
              marginBottom: '16px',
            }}
          >
            Pricing
          </span>
          <h1
            style={{
              fontSize: '40px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.tight,
              lineHeight: '1.15',
              margin: '0 0 16px',
            }}
          >
            Simple, transparent pricing.
          </h1>
          <p
            style={{
              fontSize: '17px',
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              lineHeight: '1.65',
              margin: '0',
            }}
          >
            All plans include the free tier for responding to data requests.
            Supplier plans are priced by record volume and upload capacity.
            Buyer plans are priced by supplier entity connections.
          </p>
        </div>
      </section>

      {/* Supplier plans */}
      <section style={{ backgroundColor: colours.background, padding: '72px 0' }}>
        <div style={container}>
          <div style={{ marginBottom: '40px' }}>
            <h2
              style={{
                fontSize: '24px',
                fontWeight: typography.weights.medium,
                color: colours.textPrimary,
                letterSpacing: typography.tracking.tight,
                margin: '0 0 8px',
              }}
            >
              Supplier plans
            </h2>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                margin: 0,
              }}
            >
              For manufacturers, producers, and suppliers building a certified operational data record.
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '16px',
            }}
          >
            {supplierPlans.map(plan => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      {/* Buyer plans */}
      <section style={{ backgroundColor: colours.surface, padding: '72px 0' }}>
        <div style={container}>
          <div style={{ marginBottom: '40px' }}>
            <h2
              style={{
                fontSize: '24px',
                fontWeight: typography.weights.medium,
                color: colours.textPrimary,
                letterSpacing: typography.tracking.tight,
                margin: '0 0 8px',
              }}
            >
              Buyer plans
            </h2>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                margin: 0,
              }}
            >
              For large companies, procurement teams, and sustainability functions accessing verified supply chain data.
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '16px',
            }}
          >
            {buyerPlans.map(plan => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      {/* Notes */}
      <section
        style={{
          backgroundColor: colours.background,
          padding: '56px 0',
          borderTop: `1px solid ${colours.border}`,
        }}
      >
        <div style={container}>
          <h3
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.tight,
              margin: '0 0 20px',
            }}
          >
            Notes on pricing
          </h3>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {[
              'All prices are exclusive of VAT. VAT is charged at the applicable rate for UK businesses.',
              'Annual billing is available on all paid plans at a 20% discount.',
              'Responding to buyer data requests is always free for suppliers, regardless of plan.',
              'Data submitted to arbor remains owned by the submitting entity. arbor holds a licence to store and serve it.',
              'A Data Processing Agreement is included in the Enterprise plan and available separately for other plans.',
              'For custom pricing, volume discounts, or procurement requirements, contact hello@arbor.io.',
            ].map((note, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: '4px',
                    height: '4px',
                    borderRadius: '50%',
                    backgroundColor: colours.textTertiary,
                    marginTop: '8px',
                  }}
                />
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: '1.55',
                    margin: 0,
                  }}
                >
                  {note}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
