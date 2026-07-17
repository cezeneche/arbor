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

const sectionHeading = {
  fontSize: '32px',
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  letterSpacing: typography.tracking.heading,
  lineHeight: typography.lineHeight.display,
  margin: '0 0 20px',
}

export default function HowItWorksPage() {
  return (
    <div>

      {/* Header */}
      <section
        style={{
          backgroundColor: colours.surface,
          borderBottom: `1px solid ${colours.border}`,
          padding: '72px 0 64px',
        }}
      >
        <div style={container}>
          <span style={eyebrow}>How it works</span>
          <h1
            style={{
              fontSize: 'clamp(30px, 6vw, 44px)',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.tight,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 20px',
            }}
          >
            Document in. Certified record out.
          </h1>
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              lineHeight: typography.lineHeight.body,
              margin: 0,
            }}
          >
            arbor takes the operational documents your business already produces and turns
            them into a permanent, certified, and instantly shareable data record. No
            reformatting. No manual entry. No recalculation.
          </p>
        </div>
      </section>

      {/* Three layers overview */}
      <section style={{ backgroundColor: colours.background, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>The three layers</span>
          <h2 style={sectionHeading}>
            Three separate layers. Each with a single job.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1px', backgroundColor: colours.border, marginTop: '40px' }}>
            {[
              {
                num: '01',
                label: 'Ingestion',
                heading: 'AI reads the document',
                body: 'The ingestion layer is the only place AI operates. It extracts structured fields from uploaded documents, assigns a confidence score to each, and flags anything below 0.85 for human review. Nothing is written to the database until you confirm.',
              },
              {
                num: '02',
                label: 'Storage and certification',
                heading: 'Records are written and locked',
                body: 'Once confirmed, each field is written as an immutable record with a full entity model: source text, confidence score, trust tier, unit (normalised to SI), period, and document reference. An HMAC audit chain links every record to its predecessors. Records are never overwritten.',
              },
              {
                num: '03',
                label: 'Access and sharing',
                heading: 'Data is served, never modified',
                body: 'The access layer is read-only. Queries, exports, and API responses all pull from certified records. Units are converted on output. Trust tier and certification label travel with every data point in every format.',
              },
            ].map(({ num, label, heading, body }) => (
              <div key={num} style={{ backgroundColor: colours.surface, padding: '40px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <span
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.textTertiary,
                      letterSpacing: typography.tracking.wider,
                    }}
                  >
                    {num}
                  </span>
                  <span
                    style={{
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.textTertiary,
                      letterSpacing: typography.tracking.wider,
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    {label}
                  </span>
                </div>
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

      {/* Step by step */}
      <section style={{ backgroundColor: colours.surface, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>Step by step</span>
          <h2 style={sectionHeading}>What happens when you upload a document.</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', backgroundColor: colours.border, marginTop: '40px' }}>
            {[
              {
                n: '01',
                heading: 'Upload your document',
                detail: [
                  'Accepted formats: PDF, JPEG, PNG.',
                  'Select the document type: electricity bill, freight invoice, production log, customs declaration, and more.',
                  'Optionally set the reporting period end date, used for certificate expiry validation.',
                  'Drag and drop or click to browse. Maximum file size 50 MB.',
                ],
              },
              {
                n: '02',
                heading: 'AI extracts structured fields',
                detail: [
                  'arbor reads the document and identifies the data fields that belong to that document type.',
                  'Each field is assigned a confidence score between 0 and 1, based on how clearly it can be read from the source.',
                  'The source text (the exact words from the document) is recorded alongside each extracted value.',
                  'Fields with a confidence score below 0.85 are automatically flagged for your review.',
                ],
              },
              {
                n: '03',
                heading: 'You review flagged fields',
                detail: [
                  'You see the extracted value, the confidence score, and the source text side by side.',
                  'You can confirm the value, correct it, or reject it entirely.',
                  'A field you confirm manually is treated as Verified, the same as a high-confidence extraction.',
                  'If you reject a field, it is not written to the database.',
                ],
              },
              {
                n: '04',
                heading: 'Records are written and certified',
                detail: [
                  'Once all fields are confirmed, each is written as a permanent DataRecord.',
                  'The record carries: the value, its SI-normalised equivalent, the unit, the domain, the reporting period, the source document reference, the confidence score, the source text, and the trust tier.',
                  'An HMAC digest is computed and linked into the audit chain, creating a cryptographically verifiable provenance trail.',
                  'If you later correct a value, a new record is written that supersedes the original. The original is never deleted.',
                ],
              },
              {
                n: '05',
                heading: 'Data is available instantly',
                detail: [
                  'Certified records are immediately queryable from your data portal.',
                  'You can share records directly with authorised buyers via the access control panel.',
                  'Buyers can query your data through the arbor interface or pull it directly via the API.',
                  'Every export includes the trust tier and certification label. There is no way to share a record without disclosing its provenance.',
                ],
              },
            ].map(({ n, heading, detail }) => (
              <div
                key={n}
                style={{
                  backgroundColor: colours.surface,
                  padding: '40px 48px',
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr',
                  gap: '40px',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    fontSize: '32px',
                    fontWeight: typography.weights.medium,
                    color: colours.border,
                    letterSpacing: typography.tracking.tight,
                    lineHeight: 1,
                    paddingTop: '4px',
                  }}
                >
                  {n}
                </div>
                <div>
                  <p
                    style={{
                      fontSize: typography.sizes.base,
                      fontWeight: typography.weights.medium,
                      color: colours.textPrimary,
                      margin: '0 0 16px',
                      letterSpacing: typography.tracking.tight,
                    }}
                  >
                    {heading}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {detail.map((line, i) => (
                      <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <span
                          style={{
                            flexShrink: 0,
                            width: '4px',
                            height: '4px',
                            borderRadius: '50%',
                            backgroundColor: colours.textTertiary,
                            marginTop: '7px',
                          }}
                        />
                        <p
                          style={{
                            fontSize: typography.sizes.sm,
                            fontWeight: typography.weights.light,
                            color: colours.textSecondary,
                            lineHeight: typography.lineHeight.body,
                            margin: 0,
                          }}
                        >
                          {line}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust tiers deep dive */}
      <section style={{ backgroundColor: colours.background, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>Trust tiers</span>
          <h2 style={sectionHeading}>
            How trust tier is determined, and why it cannot be changed.
          </h2>
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              lineHeight: typography.lineHeight.body,
              margin: '0 0 48px',
            }}
          >
            Trust tier is assigned automatically at the time a record is written. It reflects
            the quality of evidence behind the data point. It is not a user setting; it
            is a property of the record, computed from facts.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1px', backgroundColor: colours.border }}>
            {[
              {
                tier: 'Verified',
                colour: colours.green,
                bg: colours.greenBg,
                rule: 'Extracted from a submitted source document. Source text recorded. AI confidence ≥ 0.85, or field manually confirmed by the user after review.',
                note: 'A Declared record can be upgraded to Verified when a supporting document is submitted later.',
              },
              {
                tier: 'Declared',
                colour: colours.amber,
                bg: colours.amberBg,
                rule: 'Entered directly by the user without an attached supporting document, or the submitted document failed one or more quality checks that did not prevent submission.',
                note: 'Declared data is not untrustworthy; it is self-reported. Many regulatory frameworks accept declared data. The label makes that clear.',
              },
              {
                tier: 'Estimated',
                colour: colours.slate,
                bg: colours.slateBg,
                rule: 'No company-specific data is available. A published default reference value has been applied. The source is always cited, typically a regulatory or industry database.',
                note: 'Estimated records are never presented as actual activity data. They fill gaps in completeness reporting only.',
              },
            ].map(({ tier, colour, bg, rule, note }) => (
              <div
                key={tier}
                style={{
                  backgroundColor: colours.surface,
                  padding: '32px',
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '6px 12px',
                    backgroundColor: bg,
                    color: colour,
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    borderRadius: '3px',
                    letterSpacing: typography.tracking.wide,
                    textTransform: 'uppercase' as const,
                    marginBottom: '20px',
                  }}
                >
                  {tier}
                </div>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textPrimary,
                    lineHeight: typography.lineHeight.body,
                    margin: '0 0 10px',
                  }}
                >
                  {rule}
                </p>
                <p
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.light,
                    color: colours.textTertiary,
                    lineHeight: typography.lineHeight.body,
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

      {/* Audit chain */}
      <section style={{ backgroundColor: colours.surface, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>Audit chain</span>
          <h2 style={sectionHeading}>Every record is cryptographically linked.</h2>
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              lineHeight: typography.lineHeight.body,
              margin: '0 0 40px',
            }}
          >
            When a record is written, an HMAC digest is computed from its content and linked
            to the hash of the previous record in the chain. This creates a tamper-evident
            sequence: any modification to a historical record would break the chain, making
            alteration immediately detectable.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              'Each record contains: value, unit, source text, confidence score, trust tier, document reference, entity ID, timestamp.',
              'The HMAC is computed over the full record content using a server-side key.',
              'The chain links each record to the hash of its predecessor for that entity.',
              'The chain can be independently verified by downloading the full audit package from your data portal.',
              'Corrections create new records that supersede; they do not modify or delete existing records.',
            ].map((line, i) => (
              <div key={i} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    color: colours.textTertiary,
                    letterSpacing: typography.tracking.wider,
                    paddingTop: '1px',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    lineHeight: typography.lineHeight.body,
                    margin: 0,
                  }}
                >
                  {line}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Document types */}
      <section style={{ backgroundColor: colours.background, padding: '80px 0' }}>
        <div style={container}>
          <span style={eyebrow}>Accepted documents</span>
          <h2 style={sectionHeading}>What you can upload.</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1px',
              backgroundColor: colours.border,
              marginTop: '40px',
            }}
          >
            {[
              { category: 'Energy', types: ['Electricity bill', 'Gas bill', 'Fuel purchase receipt', 'Renewable energy certificate (REGO / REC / GO)'] },
              { category: 'Production and materials', types: ['Production log / batch record', 'Material intake record', 'Bill of materials', 'Process data sheet'] },
              { category: 'Logistics', types: ['Freight invoice', 'Delivery note', 'Customs declaration', 'Bill of lading'] },
              { category: 'Supply chain', types: ['Supplier invoice', 'Purchase order', 'CBAM declaration', 'Chain of custody'] },
              { category: 'Certification', types: ['Product certificate', 'Environmental management certificate', 'Carbon footprint report / LCA', 'Land use certificate'] },
              { category: 'Waste and water', types: ['Waste disposal record', 'Water use record', 'Fertiliser application record', 'Livestock record'] },
            ].map(({ category, types }) => (
              <div key={category} style={{ backgroundColor: colours.surface, padding: '28px' }}>
                <p
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    color: colours.textTertiary,
                    letterSpacing: typography.tracking.wider,
                    textTransform: 'uppercase' as const,
                    margin: '0 0 14px',
                  }}
                >
                  {category}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {types.map(t => (
                    <p
                      key={t}
                      style={{
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textSecondary,
                        lineHeight: typography.lineHeight.body,
                        margin: 0,
                      }}
                    >
                      {t}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ backgroundColor: colours.navy, padding: '88px 0' }}>
        <div style={{ ...container, textAlign: 'center' }}>
          <h2
            style={{
              fontSize: '32px',
              fontWeight: typography.weights.medium,
              color: '#FFFFFF',
              letterSpacing: typography.tracking.tight,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 16px',
            }}
          >
            Ready to upload your first document?
          </h2>
          <p
            style={{
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.light,
              color: 'rgba(255,255,255,0.55)',
              margin: '0 0 36px',
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
