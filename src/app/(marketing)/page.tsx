import Link from 'next/link'
import { colours, typography } from '@/lib/design-system'

const container = {
  maxWidth: '1140px',
  margin: '0 auto',
  padding: '0 40px',
}

const eyebrow = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  marginBottom: '28px',
  display: 'block',
}

const sectionEyebrow = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textTertiary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  marginBottom: '16px',
  display: 'block',
}

const sectionHeading = {
  fontSize: '32px',
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  letterSpacing: typography.tracking.heading,
  lineHeight: typography.lineHeight.display,
  margin: '0 0 20px',
}

const sectionBody = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  lineHeight: typography.lineHeight.body,
  margin: '0',
}

const stepNumber = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textTertiary,
  letterSpacing: typography.tracking.wider,
  fontVariantNumeric: 'tabular-nums' as const,
  marginBottom: '12px',
  display: 'block',
}

export default function HomePage() {
  return (
    <div>

      {/* Hero */}
      <section style={{ backgroundColor: colours.navy, padding: '128px 0 160px' }}>
        <div style={container}>
          <span style={eyebrow}>Operational data infrastructure</span>
          <h1
            style={{
              fontSize: typography.sizes.heroXl,
              fontWeight: typography.weights.medium,
              color: '#FFFFFF',
              letterSpacing: typography.tracking.tight,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 28px',
            }}
          >
            Operational data, all in one verified data record.
          </h1>
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.65)',
              lineHeight: typography.lineHeight.body,
              margin: '0 0 40px',
            }}
          >
            arbor reads your operational data, certifies the data, and stores it permanently.
            One verified source for every data request.
          </p>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <Link
              href="/signup"
              style={{
                display: 'inline-block',
                padding: '13px 28px',
                backgroundColor: colours.surface,
                color: colours.navy,
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                textDecoration: 'none',
                borderRadius: '4px',
                letterSpacing: typography.tracking.normal,
              }}
            >
              Get started
            </Link>
            <Link
              href="/how-it-works"
              style={{
                display: 'inline-block',
                padding: '13px 24px',
                color: 'rgba(255,255,255,0.65)',
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.light,
                textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '4px',
                letterSpacing: typography.tracking.normal,
              }}
            >
              See how it works
            </Link>
          </div>
        </div>
      </section>

      {/* Feature strip */}
      <section style={{ backgroundColor: colours.surface, borderBottom: `1px solid ${colours.border}` }}>
        <div
          style={{
            ...container,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            borderLeft: `1px solid ${colours.border}`,
          }}
        >
          {[
            { stat: '8', label: 'Data domains' },
            { stat: '3', label: 'Trust tiers' },
            { stat: 'HMAC', label: 'Audit chain' },
            { stat: 'API', label: 'Direct access' },
          ].map(({ stat, label }) => (
            <div
              key={label}
              style={{
                padding: '24px 32px',
                borderRight: `1px solid ${colours.border}`,
                borderTop: `1px solid ${colours.border}`,
                borderBottom: `1px solid ${colours.border}`,
              }}
            >
              <div
                style={{
                  fontSize: '22px',
                  fontWeight: typography.weights.medium,
                  color: colours.navy,
                  letterSpacing: typography.tracking.tight,
                  marginBottom: '4px',
                }}
              >
                {stat}
              </div>
              <div
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section style={{ backgroundColor: colours.background, padding: '88px 0' }}>
        <div style={container}>
          <span style={sectionEyebrow}>The problem</span>
          <h2 style={sectionHeading}>
            The same data, rebuilt from scratch, every time.
          </h2>
          <p style={{ ...sectionBody, marginBottom: '56px' }}>
            Manufacturers receive increasing requests for operational data from customers,
            auditors, and regulators. Each request triggers the same process: find the documents,
            extract the figures, format the output. Hours spent. Same data arrived at differently.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', backgroundColor: colours.border }}>
            {[
              {
                heading: 'Rebuilt every time',
                body: 'Every data request means reconstructing the same figures from different sources. Supplier questionnaires, customs declarations, audit requests, each answered from scratch.',
              },
              {
                heading: 'No audit trail',
                body: 'When a figure arrives without a source document, there is no way to verify where it came from. Buyers cannot trust it. Regulators will not accept it.',
              },
              {
                heading: 'Inconsistent across submissions',
                body: 'The same figure submitted to different customers at different times can vary. Without a single source of truth, inconsistency accumulates and trust erodes.',
              },
            ].map(({ heading, body }) => (
              <div key={heading} style={{ backgroundColor: colours.surface, padding: '32px' }}>
                <p
                  style={{
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    margin: '0 0 12px',
                    letterSpacing: typography.tracking.tight,
                  }}
                >
                  {heading}
                </p>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: '1.65',
                    margin: 0,
                  }}
                >
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works (summary) */}
      <section style={{ backgroundColor: colours.surface, padding: '88px 0' }}>
        <div style={container}>
          <span style={sectionEyebrow}>How it works</span>
          <h2 style={sectionHeading}>Four steps from document to certified record.</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '40px',
              marginTop: '48px',
            }}
          >
            {[
              {
                n: '01',
                heading: 'Upload documents',
                body: 'Energy bills, production logs, delivery notes, invoices. Any operational document your business already produces.',
              },
              {
                n: '02',
                heading: 'Extraction and review',
                body: 'arbor reads each document and extracts structured data fields. Fields below the confidence threshold are flagged for your review before anything is stored.',
              },
              {
                n: '03',
                heading: 'Certified records',
                body: 'Every confirmed field is written with its source text, confidence score, and trust tier. Records are permanent. Corrections create new versions, not overwrites.',
              },
              {
                n: '04',
                heading: 'Share on demand',
                body: 'When a customer, auditor, or regulator needs your data, share certified records directly from the repository. Same data, every time.',
              },
            ].map(({ n, heading, body }) => (
              <div key={n} style={{ borderTop: `2px solid ${colours.navy}`, paddingTop: '24px' }}>
                <span style={stepNumber}>{n}</span>
                <p
                  style={{
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    margin: '0 0 10px',
                    letterSpacing: typography.tracking.tight,
                  }}
                >
                  {heading}
                </p>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: '1.65',
                    margin: 0,
                  }}
                >
                  {body}
                </p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '40px' }}>
            <Link
              href="/how-it-works"
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                color: colours.navy,
                textDecoration: 'none',
                borderBottom: `1px solid ${colours.navy}`,
                paddingBottom: '2px',
              }}
            >
              Full technical detail →
            </Link>
          </div>
        </div>
      </section>

      {/* Trust tiers */}
      <section style={{ backgroundColor: colours.background, padding: '88px 0' }}>
        <div style={container}>
          <span style={sectionEyebrow}>Data certification</span>
          <h2 style={sectionHeading}>
            Every record carries a certification label, permanently.
          </h2>
          <p style={{ ...sectionBody, marginBottom: '48px' }}>
            Trust tiers are assigned automatically from the quality of the source. They travel
            with the data in every output and cannot be removed or hidden.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', backgroundColor: colours.border }}>
            {[
              {
                tier: 'Verified',
                colour: colours.green,
                bg: colours.greenBg,
                body: 'Extracted from a submitted document. Source text recorded. AI confidence at or above 0.85, or field manually confirmed by the user.',
              },
              {
                tier: 'Declared',
                colour: colours.amber,
                bg: colours.amberBg,
                body: 'Entered directly, without a supporting document attached. Valid and useful. Upgradeable to Verified when a source document is submitted.',
              },
              {
                tier: 'Estimated',
                colour: colours.textTertiary,
                bg: colours.surface,
                body: 'A published default reference value has been applied. Source always cited. Never presented as actual activity data from your operations.',
              },
            ].map(({ tier, colour, bg, body }) => (
              <div key={tier} style={{ backgroundColor: colours.surface, padding: '32px' }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '4px 10px',
                    backgroundColor: bg,
                    color: colour,
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    borderRadius: '3px',
                    letterSpacing: typography.tracking.wide,
                    textTransform: 'uppercase' as const,
                    marginBottom: '16px',
                  }}
                >
                  {tier}
                </div>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: '1.65',
                    margin: 0,
                  }}
                >
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For who */}
      <section style={{ backgroundColor: colours.surface, padding: '88px 0' }}>
        <div style={container}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', backgroundColor: colours.border }}>
            {/* Suppliers */}
            <div style={{ backgroundColor: colours.surface, padding: '48px' }}>
              <span style={{ ...sectionEyebrow, marginBottom: '20px' }}>For suppliers and manufacturers</span>
              <h3
                style={{
                  fontSize: '24px',
                  fontWeight: typography.weights.medium,
                  color: colours.textPrimary,
                  letterSpacing: typography.tracking.tight,
                  lineHeight: '1.25',
                  margin: '0 0 16px',
                }}
              >
                Respond to any data request in minutes, not days.
              </h3>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  lineHeight: '1.65',
                  margin: '0 0 28px',
                }}
              >
                Upload the documents you already have. arbor organises and certifies
                the data. Every submission traces back to a source document. Control
                exactly which buyers can see your records.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  'Build a permanent, verifiable operational data record',
                  'Respond to customer questionnaires directly from the store',
                  'Every figure traces back to a source document',
                  'Control exactly which buyers can access your data',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        backgroundColor: colours.navy,
                        marginTop: '6px',
                      }}
                    />
                    <span
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        lineHeight: '1.5',
                      }}
                    >
                      {item}
                    </span>
                  </div>
                ))}
              </div>
              <Link
                href="/signup"
                style={{
                  display: 'inline-block',
                  marginTop: '32px',
                  padding: '10px 20px',
                  backgroundColor: colours.navy,
                  color: colours.surface,
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  textDecoration: 'none',
                  borderRadius: '4px',
                }}
              >
                Sign up as a supplier
              </Link>
            </div>

            {/* Buyers */}
            <div style={{ backgroundColor: colours.background, padding: '48px' }}>
              <span style={{ ...sectionEyebrow, marginBottom: '20px' }}>For buyers and large companies</span>
              <h3
                style={{
                  fontSize: '24px',
                  fontWeight: typography.weights.medium,
                  color: colours.textPrimary,
                  letterSpacing: typography.tracking.tight,
                  lineHeight: '1.25',
                  margin: '0 0 16px',
                }}
              >
                Certified supply chain data, without the chasing.
              </h3>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  lineHeight: '1.65',
                  margin: '0 0 28px',
                }}
              >
                Send structured data requests to your entire supply chain.
                Receive certified, document-backed records. Query across
                suppliers with consistent data formats.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  'Send structured data requests across your supply chain',
                  'Receive certified records with full source provenance',
                  'Query across suppliers with consistent data formats',
                  'API access for integration into your own systems',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        backgroundColor: colours.navy,
                        marginTop: '6px',
                      }}
                    />
                    <span
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        lineHeight: '1.5',
                      }}
                    >
                      {item}
                    </span>
                  </div>
                ))}
              </div>
              <Link
                href="/signup"
                style={{
                  display: 'inline-block',
                  marginTop: '32px',
                  padding: '10px 20px',
                  backgroundColor: colours.navy,
                  color: colours.surface,
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  textDecoration: 'none',
                  borderRadius: '4px',
                }}
              >
                Sign up as a buyer
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Data domains */}
      <section style={{ backgroundColor: colours.background, padding: '88px 0' }}>
        <div style={container}>
          <span style={sectionEyebrow}>Data domains</span>
          <h2 style={sectionHeading}>Eight certified operational data domains.</h2>
          <p style={{ ...sectionBody, marginBottom: '48px' }}>
            Every data record is classified into one of eight operational domains.
            Domain classification travels with every export.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '1px',
              backgroundColor: colours.border,
            }}
          >
            {[
              { domain: 'Energy', desc: 'Electricity, gas, fuel consumption and purchased energy.' },
              { domain: 'Materials', desc: 'Raw material inputs, purchased content, and feedstocks.' },
              { domain: 'Production', desc: 'Output volumes, yields, batch records, and throughput.' },
              { domain: 'Logistics', desc: 'Freight, transport modes, distances, and delivery data.' },
              { domain: 'Emissions', desc: 'Direct and indirect emission measurements and estimates.' },
              { domain: 'Agriculture', desc: 'Land use, crop inputs, livestock, and agricultural outputs.' },
              { domain: 'Waste and water', desc: 'Water consumption, discharge, and waste disposal records.' },
              { domain: 'Compliance', desc: 'Certificates, permits, test results, and regulatory filings.' },
            ].map(({ domain, desc }) => (
              <div key={domain} style={{ backgroundColor: colours.surface, padding: '24px' }}>
                <p
                  style={{
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.medium,
                    color: colours.navy,
                    margin: '0 0 8px',
                    letterSpacing: typography.tracking.tight,
                  }}
                >
                  {domain}
                </p>
                <p
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: '1.55',
                    margin: 0,
                  }}
                >
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ backgroundColor: colours.navy, padding: '96px 0' }}>
        <div style={{ ...container, textAlign: 'center' }}>
          <h2
            style={{
              fontSize: '36px',
              fontWeight: typography.weights.medium,
              color: '#FFFFFF',
              letterSpacing: typography.tracking.tight,
              lineHeight: '1.2',
              margin: '0 0 16px',
            }}
          >
            Start building your certified data record today.
          </h2>
          <p
            style={{
              fontSize: '17px',
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.55)',
              margin: '0 0 40px',
            }}
          >
            Free to get started. No credit card required.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
            <Link
              href="/signup"
              style={{
                display: 'inline-block',
                padding: '13px 32px',
                backgroundColor: colours.surface,
                color: colours.navy,
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                textDecoration: 'none',
                borderRadius: '4px',
                letterSpacing: typography.tracking.normal,
              }}
            >
              Get started
            </Link>
            <Link
              href="/pricing"
              style={{
                display: 'inline-block',
                padding: '13px 24px',
                color: 'rgba(255,255,255,0.65)',
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.light,
                textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '4px',
                letterSpacing: typography.tracking.normal,
              }}
            >
              View pricing
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
