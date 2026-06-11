import { colours, typography } from '@/lib/design-system'

// IMPORTANT: This document must be reviewed by a qualified solicitor before publication.

const container = {
  maxWidth: '720px',
  margin: '0 auto',
  padding: '0 40px',
}

const h2Style = {
  fontSize: '20px',
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  letterSpacing: typography.tracking.tight,
  margin: '40px 0 12px',
}

const h3Style = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  letterSpacing: typography.tracking.tight,
  margin: '24px 0 8px',
}

const pStyle = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  lineHeight: '1.75',
  margin: '0 0 16px',
}

const liStyle = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  lineHeight: '1.75',
  marginBottom: '6px',
}

export default function DpaPage() {
  return (
    <div style={{ backgroundColor: colours.surface }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${colours.border}`, padding: '64px 0 48px' }}>
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
            Legal
          </span>
          <h1
            style={{
              fontSize: '36px',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.tight,
              margin: '0 0 16px',
            }}
          >
            Data Processing Agreement
          </h1>
          <p style={{ ...pStyle, margin: '0 0 12px' }}>
            Last updated: 1 June 2026.
          </p>
          <p style={{ ...pStyle, margin: 0 }}>
            This Data Processing Agreement (&quot;DPA&quot;) forms part of the Terms of Service between
            Arbor Data Ltd (&quot;Arbor&quot;, &quot;Processor&quot;) and the entity that has agreed to those terms
            (&quot;Customer&quot;, &quot;Controller&quot;). It applies where Arbor processes personal data on behalf
            of the Customer in the course of providing the Arbor platform service.
          </p>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '64px 0 96px' }}>
        <div style={container}>

          <h2 style={h2Style}>1. Definitions</h2>
          <p style={pStyle}>
            Terms defined in UK GDPR (UK General Data Protection Regulation) and the Data Protection
            Act 2018 have the same meaning here. &quot;Personal data&quot;, &quot;processing&quot;, &quot;data subject&quot;,
            &quot;data controller&quot;, and &quot;data processor&quot; are used as defined in those instruments.
          </p>
          <p style={pStyle}>
            &quot;Services&quot; means the operational data repository platform provided by Arbor under the Terms
            of Service, including document ingestion, data extraction, certification, storage, and access
            facilitation.
          </p>

          <h2 style={h2Style}>2. Scope and subject matter</h2>
          <p style={pStyle}>
            Arbor processes personal data on behalf of the Customer solely to provide the Services.
            The nature and purpose of processing is the ingestion, AI-powered extraction, storage,
            certification, and controlled sharing of operational data records derived from documents
            submitted by the Customer.
          </p>
          <p style={pStyle}>
            Arbor does not process personal data for its own purposes beyond what is necessary to
            provide the Services, comply with legal obligations, and maintain the security of the platform.
          </p>

          <h2 style={h2Style}>3. Types of personal data and data subjects</h2>
          <h3 style={h3Style}>Personal data categories</h3>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Identity data: names, job titles, and contact details of individuals named in submitted documents',
              'Company data: business names, addresses, registration numbers in submitted documents',
              'Transaction data: invoice amounts, dates, counterparties in submitted documents',
              'Account data: names, email addresses, and credentials of platform users',
            ].map(item => (
              <li key={item} style={liStyle}>{item}</li>
            ))}
          </ul>
          <h3 style={h3Style}>Data subjects</h3>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Employees and authorised users of the Customer who access the platform',
              'Third parties whose personal data appears incidentally in submitted documents (e.g., named on invoices)',
            ].map(item => (
              <li key={item} style={liStyle}>{item}</li>
            ))}
          </ul>

          <h2 style={h2Style}>4. Duration</h2>
          <p style={pStyle}>
            This DPA applies for the duration of the Customer&apos;s use of the Services, commencing when
            the Customer first submits personal data to the platform and ending when all personal data
            has been deleted in accordance with Clause 11.
          </p>

          <h2 style={h2Style}>5. Processor obligations</h2>
          <p style={pStyle}>Arbor shall:</p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            <li style={liStyle}>
              Process personal data only on documented instructions from the Controller, including with
              regard to transfers, unless required to do so by applicable law.
            </li>
            <li style={liStyle}>
              Ensure that persons authorised to process personal data have committed to confidentiality or
              are under an appropriate statutory obligation of confidentiality.
            </li>
            <li style={liStyle}>
              Implement appropriate technical and organisational measures to ensure a level of security
              appropriate to the risk, as described in Clause 10.
            </li>
            <li style={liStyle}>
              Not engage sub-processors without the prior written authorisation of the Controller, except
              as set out in Clause 6.
            </li>
            <li style={liStyle}>
              Assist the Controller in responding to data subject requests, to the extent technically
              feasible, taking into account the nature of processing.
            </li>
            <li style={liStyle}>
              Notify the Controller promptly, and in any event within 72 hours of becoming aware, of any
              personal data breach affecting the Controller&apos;s data.
            </li>
            <li style={liStyle}>
              Delete or return all personal data on termination of the Services, as set out in Clause 11.
            </li>
            <li style={liStyle}>
              Make available to the Controller all information necessary to demonstrate compliance with
              this DPA, and allow for and contribute to audits conducted by the Controller or a mandated
              auditor, on reasonable prior written notice.
            </li>
          </ul>

          <h2 style={h2Style}>6. Sub-processors</h2>
          <p style={pStyle}>
            The Customer provides general authorisation for Arbor to engage the following sub-processors,
            who assist in delivering the Services:
          </p>
          <div
            style={{
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              overflow: 'hidden',
              marginBottom: '16px',
            }}
          >
            {[
              { name: 'Supabase', purpose: 'Database hosting', location: 'EU (Ireland)', transfers: 'Adequacy decision' },
              { name: 'Anthropic', purpose: 'AI extraction', location: 'United States', transfers: 'Standard Contractual Clauses' },
              { name: 'Inngest', purpose: 'Job processing', location: 'United States', transfers: 'Standard Contractual Clauses' },
              { name: 'Resend', purpose: 'Email delivery', location: 'United States', transfers: 'Standard Contractual Clauses' },
              { name: 'Vercel', purpose: 'Application hosting', location: 'EU / United States', transfers: 'Standard Contractual Clauses' },
            ].map(({ name, purpose, location, transfers }, i) => (
              <div
                key={name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr 160px 200px',
                  gap: '12px',
                  padding: '12px 16px',
                  borderTop: i === 0 ? 'none' : `1px solid ${colours.border}`,
                  backgroundColor: i % 2 === 0 ? colours.surface : colours.background,
                }}
              >
                <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                  {name}
                </span>
                <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary }}>
                  {purpose}
                </span>
                <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
                  {location}
                </span>
                <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
                  {transfers}
                </span>
              </div>
            ))}
          </div>
          <p style={pStyle}>
            Arbor will notify the Customer of any intended changes to this list (additions or replacements)
            by email, with at least 14 days&apos; prior notice, giving the Customer opportunity to object.
            Arbor will impose equivalent data protection obligations on all sub-processors.
          </p>

          <h2 style={h2Style}>7. International transfers</h2>
          <p style={pStyle}>
            Where sub-processors are located in countries outside the UK not covered by an adequacy
            decision, Arbor ensures appropriate safeguards are in place under UK GDPR Article 46.
            Where Standard Contractual Clauses are used, Arbor will make copies available to the Customer
            upon written request.
          </p>

          <h2 style={h2Style}>8. Data subject rights</h2>
          <p style={pStyle}>
            Where Arbor receives a data subject request relating to personal data it processes on behalf
            of the Customer, Arbor will promptly forward the request to the Customer and will not respond
            to the data subject directly without the Customer&apos;s authorisation, except as required by law.
          </p>
          <p style={pStyle}>
            Arbor will, at the Customer&apos;s written request, assist with the fulfilment of data subject
            requests to the extent technically feasible, given the nature of the processing.
          </p>

          <h2 style={h2Style}>9. Personal data breach notification</h2>
          <p style={pStyle}>
            Arbor shall notify the Customer without undue delay, and where feasible within 72 hours,
            after becoming aware of a personal data breach affecting data processed under this DPA.
            Notification will include the nature of the breach, the categories and approximate number
            of data subjects and records concerned, the likely consequences, and measures taken or
            proposed to address the breach.
          </p>

          <h2 style={h2Style}>10. Technical and organisational measures</h2>
          <p style={pStyle}>
            Arbor implements the following technical and organisational measures to protect personal data:
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Encryption of data in transit using TLS 1.2 or higher',
              'Encryption of data at rest',
              'Access controls limiting database access to authorised personnel only',
              'HMAC-chained audit log for all data record writes',
              'Password hashing using bcrypt with cost factor 12',
              'Role-based access control within the platform',
              'API key scoping to limit access to authorised data only',
              'Separate storage of AI extraction layer from the permanent record store',
              'Regular security review of third-party sub-processors',
            ].map(item => (
              <li key={item} style={liStyle}>{item}</li>
            ))}
          </ul>

          <h2 style={h2Style}>11. Return and deletion of data</h2>
          <p style={pStyle}>
            On termination of the Services, Arbor shall, at the Customer&apos;s election:
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            <li style={liStyle}>
              Return all personal data to the Customer in a structured, machine-readable format (CSV or JSON), or
            </li>
            <li style={liStyle}>
              Securely delete all personal data, and provide written confirmation of deletion within 30 days.
            </li>
          </ul>
          <p style={pStyle}>
            Arbor may retain personal data beyond termination where required to do so by applicable law,
            for the period required by that law only.
          </p>

          <h2 style={h2Style}>12. Audit rights</h2>
          <p style={pStyle}>
            Arbor shall make available to the Customer all information reasonably necessary to demonstrate
            compliance with this DPA and shall allow for and contribute to audits and inspections conducted
            by the Customer or its nominated auditor, on reasonable prior written notice of no less than
            30 days.
          </p>
          <p style={pStyle}>
            Arbor may object to an audit on reasonable grounds (including disruption to operations or
            conflict with confidentiality obligations to other customers) and in such case shall work with
            the Customer to agree an alternative approach that satisfies the Customer&apos;s compliance needs.
          </p>

          <h2 style={h2Style}>13. Governing law</h2>
          <p style={pStyle}>
            This DPA is governed by the laws of England and Wales and is subject to the exclusive
            jurisdiction of the courts of England and Wales.
          </p>

          <h2 style={h2Style}>14. Contact</h2>
          <p style={pStyle}>
            For all data protection queries, contact legal@arbor.io or write to:
            Arbor Data Ltd, [Company Address, City, Postcode].
          </p>

        </div>
      </div>
    </div>
  )
}
