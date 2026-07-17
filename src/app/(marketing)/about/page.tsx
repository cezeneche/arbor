import Link from 'next/link'
import { colours, typography } from '@/lib/design-system'

const container = {
  maxWidth: '1140px',
  margin: '0 auto',
  padding: '0 clamp(20px, 5vw, 40px)',
}

const eyebrow = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textTertiary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  marginBottom: '16px',
  display: 'block',
}

export default function AboutPage() {
  return (
    <div>

      {/* Header */}
      <section
        style={{
          backgroundColor: colours.navy,
          padding: '88px 0 80px',
        }}
      >
        <div style={container}>
          <span
            style={{
              ...eyebrow,
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            About arbor
          </span>
          <h1
            style={{
              fontSize: 'clamp(30px, 6vw, 44px)',
              fontWeight: typography.weights.medium,
              color: '#FFFFFF',
              letterSpacing: typography.tracking.tight,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 24px',
            }}
          >
            Robust, Verified Data Record.
          </h1>
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.6)',
              lineHeight: typography.lineHeight.body,
              margin: 0,
            }}
          >
            Manufacturers and suppliers across the UK and Europe are being asked for the
            same operational data in more formats, by more parties, more often than ever
            before. arbor exists to solve that once.
          </p>
        </div>
      </section>

      {/* What arbor is */}
      <section style={{ backgroundColor: colours.surface, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>What arbor is</span>
          <h2
            style={{
              fontSize: '32px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.heading,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 24px',
            }}
          >
            A certified operational data repository.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {[
              'Manufacturers, suppliers, and producers upload the documents their business already produces: energy bills, production logs, delivery notes, freight invoices, customs declarations, certificates.',
              'arbor reads each document, extracts the structured data it contains, and asks the user to review anything it is not confident about.',
              'Once confirmed, the data is written as a permanent, immutable record. Source text is recorded. Trust tier is assigned. An HMAC audit chain links every record to its predecessors.',
              'Those certified records can then be shared with any authorised party (a customer, an auditor, a regulator) instantly and in a consistent format.',
              'The data does not change between submissions. The same record answers every request.',
            ].map((para, i) => (
              <p
                key={i}
                style={{
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  lineHeight: typography.lineHeight.body,
                  margin: 0,
                }}
              >
                {para}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* What arbor is not */}
      <section style={{ backgroundColor: colours.background, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>What arbor is not</span>
          <h2
            style={{
              fontSize: '32px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.heading,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 40px',
            }}
          >
            arbor holds the data. It does not process it.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1px', backgroundColor: colours.border }}>
            {[
              {
                heading: 'Not a calculation engine',
                body: 'arbor does not calculate emissions, carbon footprints, or ESG scores. Those calculations happen in your tools, using arbor as the data source. Calculation logic and data storage are deliberately separate.',
              },
              {
                heading: 'Not a reporting tool',
                body: 'arbor does not produce CBAM returns, Scope 3 inventories, sustainability reports, or any other regulatory output. It holds the verified operational data those outputs require.',
              },
              {
                heading: 'Not a compliance platform',
                body: 'arbor does not assess whether your data meets any particular regulatory threshold. It records, certifies, and stores. Whether the data satisfies a given framework is determined by the framework, not arbor.',
              },
            ].map(({ heading, body }) => (
              <div key={heading} style={{ backgroundColor: colours.surface, padding: '32px' }}>
                <p
                  style={{
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    margin: '0 0 12px',
                    letterSpacing: typography.tracking.heading,
                  }}
                >
                  {heading}
                </p>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: typography.lineHeight.body,
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

      {/* Why now */}
      <section style={{ backgroundColor: colours.surface, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>Why now</span>
          <h2
            style={{
              fontSize: '32px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.heading,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 24px',
            }}
          >
            The data burden on manufacturers is accelerating.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {[
              'CBAM requires verified emissions data for every good entering the EU. CSRD means large buyers now need documented figures from their entire supply chain. Procurement due diligence is pushing those same expectations further down the chain, faster.',
              'Every one of these obligations draws on the same underlying operational data. But today, manufacturers reconstruct those figures from scratch every time a new request lands.',
              'arbor exists to change that. Submit your documents once. Answer every request from the same certified record.',
            ].map((para, i) => (
              <p
                key={i}
                style={{
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  lineHeight: typography.lineHeight.body,
                  margin: 0,
                }}
              >
                {para}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Principles */}
      <section style={{ backgroundColor: colours.background, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>Principles</span>
          <h2
            style={{
              fontSize: '32px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.heading,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 40px',
            }}
          >
            How we build.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1px', backgroundColor: colours.border }}>
            {[
              {
                heading: 'The database is the product',
                body: 'Every feature either fills the database, improves the quality of existing records, or makes the database more accessible to legitimate users. Features that do none of these are not built.',
              },
              {
                heading: 'Provenance is non-negotiable',
                body: 'Every data point carries its source. Confidence below threshold is flagged, never silently accepted. Users always know the quality of the data they are looking at.',
              },
              {
                heading: 'Immutability by design',
                body: 'Records are never modified. Corrections create new records that supersede the old. The historical record is always intact and independently verifiable.',
              },
              {
                heading: 'Transparency without complexity',
                body: 'Trust tiers and certification labels are always visible. They cannot be hidden in any output. Suppliers see plain English. Buyers see full technical detail.',
              },
              {
                heading: 'Separation of concerns',
                body: 'AI belongs in ingestion only. Storage is deterministic. Access is read-only. These boundaries are not guidelines; they are enforced in the architecture.',
              },
              {
                heading: 'Owned by the submitter',
                body: 'Data submitted to arbor remains owned by the submitting entity. arbor holds a storage and serving licence. You can export everything and leave at any time.',
              },
            ].map(({ heading, body }) => (
              <div key={heading} style={{ backgroundColor: colours.surface, padding: '32px' }}>
                <p
                  style={{
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                    margin: '0 0 12px',
                    letterSpacing: typography.tracking.heading,
                  }}
                >
                  {heading}
                </p>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: typography.lineHeight.body,
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

      {/* Contact */}
      <section style={{ backgroundColor: colours.surface, padding: '80px 0', borderTop: `1px solid ${colours.border}` }}>
        <div style={container}>
          <span style={eyebrow}>Contact</span>
          <h2
            style={{
              fontSize: '32px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.heading,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 24px',
            }}
          >
            Get in touch.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '40px' }}>
            {[
              { label: 'General enquiries', email: 'hello@arbor.io' },
              { label: 'Legal and data', email: 'legal@arbor.io' },
            ].map(({ label, email }) => (
              <div key={label}>
                <p
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    color: colours.textTertiary,
                    letterSpacing: typography.tracking.wider,
                    textTransform: 'uppercase' as const,
                    margin: '0 0 8px',
                  }}
                >
                  {label}
                </p>
                <a
                  href={`mailto:${email}`}
                  style={{
                    fontSize: typography.sizes.base,
                    fontWeight: typography.weights.light,
                    color: colours.navy,
                    textDecoration: 'none',
                    borderBottom: `1px solid ${colours.border}`,
                    paddingBottom: '2px',
                  }}
                >
                  {email}
                </a>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '48px' }}>
            <Link
              href="/signup"
              style={{
                display: 'inline-block',
                padding: '12px 28px',
                backgroundColor: colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                textDecoration: 'none',
                borderRadius: '4px',
                letterSpacing: typography.tracking.normal,
              }}
            >
              Get started
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
