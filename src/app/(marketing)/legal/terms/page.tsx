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

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p style={{ ...pStyle, margin: 0 }}>
            Last updated: 1 June 2026. By creating an account and using the arbor platform,
            you agree to these terms.
          </p>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '64px 0 96px' }}>
        <div style={container}>

          <h2 style={h2Style}>1. About the service</h2>
          <p style={pStyle}>
            arbor is a certified operational data repository. The service enables manufacturers,
            suppliers, and producers (&quot;Suppliers&quot;) to upload operational documents, extract structured
            data fields, and store those records with a permanent audit chain. It enables buyers,
            large companies, and procurement teams (&quot;Buyers&quot;) to request and receive certified data
            records from their supply chain.
          </p>
          <p style={pStyle}>
            arbor certifies the provenance of data records, not their accuracy. A trust tier of
            &quot;Verified&quot; means the data was extracted from a document you submitted and that extraction
            met the required confidence threshold. It does not mean arbor has independently verified
            the accuracy of the underlying document.
          </p>

          <h2 style={h2Style}>2. Account eligibility and creation</h2>
          <p style={pStyle}>
            You must be at least 18 years old and have the authority to bind the company on whose
            behalf you register. By creating an account, you represent that both conditions are met.
          </p>
          <p style={pStyle}>
            You are responsible for maintaining the confidentiality of your credentials and for all
            activity that occurs under your account. Notify us immediately at hello@arbor.io if you
            suspect unauthorised access.
          </p>
          <p style={pStyle}>
            arbor Data Ltd reserves the right to decline or suspend accounts at its discretion,
            including where use is inconsistent with these terms or applicable law.
          </p>

          <h2 style={h2Style}>3. Data submitted to the service</h2>

          <h3 style={h3Style}>Ownership</h3>
          <p style={pStyle}>
            You retain ownership of all data and documents you submit to arbor. By submitting data,
            you grant arbor Data Ltd a limited, non-exclusive, worldwide licence to store, process,
            and serve that data for the purpose of providing the service to you and to authorised parties
            you designate.
          </p>

          <h3 style={h3Style}>Responsibility for submitted content</h3>
          <p style={pStyle}>
            You are solely responsible for the accuracy and lawfulness of documents and data you submit.
            You represent that you have all necessary rights and permissions to submit the content,
            including where it contains third-party information or personal data.
          </p>

          <h3 style={h3Style}>Permanent records</h3>
          <p style={pStyle}>
            Data records stored in arbor are permanent. Corrections do not overwrite existing records.
            Instead, a new record is created that supersedes the original, and the original is retained
            in the audit chain. This behaviour is fundamental to the integrity of the certification system
            and cannot be waived.
          </p>

          <h2 style={h2Style}>4. Trust certification</h2>
          <p style={pStyle}>
            Every data record stored in arbor carries a trust tier: Verified, Declared, or Estimated.
            These tiers are determined automatically by applying the admissibility rules of the service.
            You may not select or override a trust tier directly. You may upgrade a Declared record to
            Verified by submitting a qualifying source document.
          </p>
          <p style={pStyle}>
            Trust tier labels travel with data records in all exports and API responses. They cannot be
            removed or hidden by any user or system integration.
          </p>

          <h2 style={h2Style}>5. Sharing and access control</h2>
          <p style={pStyle}>
            Suppliers control which Buyers can access their certified records. Granting access authorises
            the Buyer to read the records you specify for the duration you specify. You may revoke access
            at any time. Revocation does not delete any data the Buyer has already downloaded or stored
            outside arbor.
          </p>
          <p style={pStyle}>
            Buyers must not share, resell, or republish certified records outside their own internal
            systems without the explicit written consent of the Supplier whose data is involved.
          </p>

          <h2 style={h2Style}>6. Acceptable use</h2>
          <p style={pStyle}>You agree not to:</p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Submit false, fabricated, or materially misleading documents or data',
              'Attempt to manipulate or circumvent the trust tier determination system',
              'Use automated tools to scrape or bulk-extract data beyond your authorised API access',
              'Use the service in a way that interferes with its operation or availability',
              'Attempt to access accounts or data you are not authorised to access',
              'Use the service for any unlawful purpose or in violation of any applicable law',
            ].map(item => (
              <li key={item} style={liStyle}>{item}</li>
            ))}
          </ul>
          <p style={pStyle}>
            Submitting knowingly false data may constitute fraud and will result in immediate account
            suspension and referral to relevant authorities.
          </p>

          <h2 style={h2Style}>7. Intellectual property</h2>
          <p style={pStyle}>
            The arbor platform, including its extraction algorithms, trust certification methodology,
            audit chain implementation, and user interface, is owned by arbor Data Ltd. Nothing in
            these terms transfers any intellectual property rights to you.
          </p>
          <p style={pStyle}>
            &quot;arbor&quot;, the arbor wordmark, and associated logos are trademarks of arbor Data Ltd. You may
            not use them without our prior written consent.
          </p>

          <h2 style={h2Style}>8. Limitation of liability</h2>
          <p style={pStyle}>
            To the maximum extent permitted by applicable law, arbor Data Ltd shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages arising from or related to
            your use of the service, including but not limited to loss of data, loss of profits, or business
            interruption.
          </p>
          <p style={pStyle}>
            Our total liability to you for any claim arising from or related to the service shall not exceed
            the amount you paid us in the three months preceding the claim.
          </p>
          <p style={pStyle}>
            arbor certifies the provenance of records, not their factual accuracy. We are not liable for
            decisions made by you or any third party in reliance on data records stored in arbor.
          </p>

          <h2 style={h2Style}>9. Indemnification</h2>
          <p style={pStyle}>
            You agree to indemnify and hold harmless arbor Data Ltd, its officers, directors, and employees
            from any claims, damages, or costs (including reasonable legal fees) arising from your violation
            of these terms, your submitted content, or your use of the service.
          </p>

          <h2 style={h2Style}>10. Service availability and changes</h2>
          <p style={pStyle}>
            We aim to maintain high availability but do not guarantee uninterrupted access. We may update,
            modify, or discontinue features of the service with reasonable notice. We will provide at least
            30 days&apos; notice before any change that materially reduces the functionality you rely on.
          </p>

          <h2 style={h2Style}>11. Termination</h2>
          <p style={pStyle}>
            You may close your account at any time by contacting hello@arbor.io. We will provide an export
            of your certified records before deletion, which must be requested before account closure is
            confirmed.
          </p>
          <p style={pStyle}>
            We may suspend or terminate your account for violation of these terms, non-payment, or any other
            reason at our discretion, with 14 days&apos; notice where possible. Termination for material breach
            may be immediate.
          </p>

          <h2 style={h2Style}>12. Governing law and disputes</h2>
          <p style={pStyle}>
            These terms are governed by the laws of England and Wales. Any dispute arising from or relating
            to these terms or the service shall be subject to the exclusive jurisdiction of the courts of
            England and Wales.
          </p>

          <h2 style={h2Style}>13. Changes to these terms</h2>
          <p style={pStyle}>
            We may update these terms from time to time. Where changes are material, we will notify you
            by email at least 30 days before the changes take effect. Your continued use of the service
            after the effective date constitutes acceptance.
          </p>

          <h2 style={h2Style}>14. Contact</h2>
          <p style={pStyle}>
            For questions about these terms, contact us at legal@arbor.io or write to:
            arbor Data Ltd, [Company Address, City, Postcode].
          </p>

        </div>
      </div>
    </div>
  )
}
