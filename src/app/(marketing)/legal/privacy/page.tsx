import type { Metadata } from 'next'
import { colours, typography } from '@/lib/design-system'
import { SUB_PROCESSORS } from '@/lib/legal/subprocessors'
import { LegalContents } from '@/components/marketing/LegalContents'
import { legalContainer, legalH2, legalH3, legalLi, legalP } from '@/components/marketing/legal-styles'
import { LegalDraftNotice } from '@/components/marketing/LegalDraftNotice'

export const metadata: Metadata = { title: 'Privacy Policy | Arbor', description: 'How Arbor describes its handling of personal data, rights and contact routes.' }

// IMPORTANT: This document must be reviewed by a qualified solicitor before publication.
// Placeholder company details (marked with []) must be replaced before going live.

export default function PrivacyPolicyPage() {
  return (
    <div className="mk-legal-page" style={{ backgroundColor: colours.surface }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${colours.border}`, padding: '64px 0 48px' }}>
        <div style={legalContainer}>
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase' as const,
              display: 'block',
              marginBottom: '16px',
            }}
          >
            Legal
          </span>
          <h1
            style={{
              fontSize: 'clamp(30px, 6vw, 44px)',
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              letterSpacing: typography.tracking.tight,
              lineHeight: typography.lineHeight.display,
              margin: '0 0 16px',
            }}
          >
            Privacy Policy
          </h1>
          <LegalDraftNotice />
          <p style={{ ...legalP, margin: 0 }}>
            Last updated: 1 June 2026. This policy applies to all users of the arbor platform.
          </p>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '64px 0 96px' }}>
        <div id="privacy-sections" className="mk-legal-reading" style={legalContainer}>
          <LegalContents sections={[{ id: 'privacy-identity', label: 'Who we are' }, { id: 'privacy-collection', label: 'Data we collect' }, { id: 'privacy-use', label: 'How we use data' }, { id: 'privacy-retention', label: 'Retention' }, { id: 'privacy-rights', label: 'Your rights' }, { id: 'privacy-contact', label: 'Contact' }]} />

          <h2 id="privacy-identity" style={legalH2}>1. Who we are</h2>
          <p style={legalP}>
            Arbor is operated by arbor. Its company number and registered address are pending confirmation
            in this sample policy. &quot;We&quot;, &quot;us&quot; and &quot;our&quot; refer to arbor.
            We operate the Arbor operational data platform accessible at arbor.io
            and related subdomains.
          </p>
          <p style={legalP}>
            For the purposes of UK data protection law, the Arbor operator is the data controller for personal
            data collected from visitors to our website and users of our platform. Where we process personal
            data on behalf of our business customers, we act as a data processor. This distinction is addressed
            in our Data Processing Agreement.
          </p>
          <p style={legalP}>
            Our ICO registration position is pending confirmation. Our data protection contact is
            legal@arbor.io.
          </p>

          <h2 id="privacy-collection" style={legalH2}>2. Personal data we collect</h2>

          <h3 style={legalH3}>Account and identity data</h3>
          <p style={legalP}>
            When you create an account, we collect your name, email address, password (stored as a one-way
            hash), and your company&apos;s legal name, sector, and country. This is required to provide the
            service.
          </p>

          <h3 style={legalH3}>Operational documents and data</h3>
          <p style={legalP}>
            You may upload documents containing personal data (for example, a utility bill with your
            company&apos;s name and address, or a delivery note with a contact name). We process this data
            solely to provide the extraction and certification service. Where documents contain personal data,
            you are responsible for ensuring you have a lawful basis for sharing that data with us.
          </p>

          <h3 style={legalH3}>Usage and technical data</h3>
          <p style={legalP}>
            We collect standard server logs including your IP address, browser type, pages accessed, and
            timestamps. We use this data to operate, maintain, and improve the service, and to investigate
            security incidents.
          </p>

          <h3 style={legalH3}>Communications</h3>
          <p style={legalP}>
            When you contact us by email or submit a pilot or institutional enquiry, we collect the details
            you provide to handle your request and maintain a record of our communications.
          </p>

          <h2 id="privacy-use" style={legalH2}>3. How we use your personal data</h2>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'To create and manage your account',
              'To provide the data extraction, certification, and storage service',
              'To process and fulfil data sharing requests between suppliers and buyers',
              'To send transactional notifications about your account and data records',
              'To provide customer support',
              'To investigate security incidents and enforce our Terms of Service',
              'To comply with our legal obligations',
            ].map(item => (
              <li key={item} style={legalLi}>{item}</li>
            ))}
          </ul>
          <p style={legalP}>
            We do not use your personal data for direct marketing without your explicit consent. We do not
            sell personal data to third parties.
          </p>

          <h2 style={legalH2}>4. Legal basis for processing</h2>
          <p style={legalP}>
            We rely on the following legal bases under UK GDPR:
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            <li style={legalLi}>
              <strong>Contract (Article 6(1)(b)):</strong> Processing necessary to perform our contract with
              you, including account management, document processing, and data sharing facilitation.
            </li>
            <li style={legalLi}>
              <strong>Legitimate interests (Article 6(1)(f)):</strong> Processing for our legitimate interests
              in operating a secure and reliable service, preventing fraud, improving our systems, and
              maintaining business records.
            </li>
            <li style={legalLi}>
              <strong>Legal obligation (Article 6(1)(c)):</strong> Processing required to comply with
              applicable law, including data retention obligations and regulatory enquiries.
            </li>
          </ul>

          <h2 style={legalH2}>5. Third-party processors</h2>
          <p style={legalP}>
            This illustrative provider inventory is drawn from the application configuration. The actual
            providers, processing locations and contractual terms must be verified before this policy is approved:
          </p>
          <div
            tabIndex={0}
            role="region"
            aria-label="Third-party processors"
            style={{
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              overflowX: 'auto',
              marginBottom: '16px',
            }}
          >
            {SUB_PROCESSORS.map(({ name, activity: purpose, location }, i) => (
              <div
                key={name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr 160px',
                  minWidth: '560px',
                  gap: '16px',
                  padding: '12px 16px',
                  borderTop: i === 0 ? 'none' : `1px solid ${colours.border}`,
                  backgroundColor: i % 2 === 0 ? colours.surface : colours.background,
                }}
              >
                <span
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.medium,
                    color: colours.textPrimary,
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                  }}
                >
                  {purpose}
                </span>
                <span
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textTertiary,
                  }}
                >
                  {location}
                </span>
              </div>
            ))}
          </div>
          <p style={legalP}>
            Where processors are located in the United States, we ensure appropriate safeguards are in place
            under UK GDPR, including Standard Contractual Clauses where required.
          </p>

          <h2 style={legalH2}>6. International transfers</h2>
          <p style={legalP}>
            Any international transfers and the applicable UK transfer safeguards must be mapped to the
            deployed providers and reviewed before this draft is approved. No particular transfer mechanism
            is asserted by this sample policy.
          </p>

          <h2 id="privacy-retention" style={legalH2}>7. Data retention</h2>
          <p style={legalP}>
            We retain account and service data while needed to provide the service. The period after account
            closure, backup expiry and any lawful exceptions must be set in an approved retention schedule.
            No fixed post-closure period is approved in this draft.
          </p>
          <p style={legalP}>
            The retention and export process for operational records after account closure must be defined in
            the approved schedule and customer terms. This draft does not set a deletion deadline.
          </p>
          <p style={legalP}>
            The retention period for server logs and technical data is also pending operational confirmation.
          </p>

          <h2 id="privacy-rights" style={legalH2}>8. Your rights under UK GDPR</h2>
          <p style={legalP}>You have the following rights regarding your personal data:</p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Right of access: you may request a copy of the personal data we hold about you.',
              'Right to rectification: you may request correction of inaccurate personal data.',
              'Right to erasure: you may request deletion of your personal data, subject to our legal obligations.',
              'Right to restriction: you may request that we restrict processing of your personal data in certain circumstances.',
              'Right to data portability: you may request your personal data in a structured, machine-readable format.',
              'Right to object: you may object to processing based on legitimate interests.',
            ].map(item => (
              <li key={item} style={legalLi}>{item}</li>
            ))}
          </ul>
          <p style={legalP}>
            To exercise any of these rights, contact us at legal@arbor.io. We will respond within one month.
            You also have the right to lodge a complaint with the Information Commissioner&apos;s Office (ico.org.uk).
          </p>

          <h2 style={legalH2}>9. Cookies</h2>
          <p style={legalP}>
            We use a session cookie to maintain your authenticated session. This cookie is essential for the
            service to function and does not require consent under PECR. We do not use tracking cookies,
            advertising cookies, or third-party analytics cookies.
          </p>

          <h2 style={legalH2}>10. Changes to this policy</h2>
          <p style={legalP}>
            We may update this policy from time to time. Where changes are material, we will notify you by
            email or by prominent notice on the platform. Your continued use of the service following notice
            of changes constitutes acceptance of the updated policy.
          </p>

          <h2 id="privacy-contact" style={legalH2}>11. Contact</h2>
          <p style={legalP}>
            For any questions about this policy or our data practices, contact us at legal@arbor.io or write
            to: arbor (registered address to be confirmed).
          </p>

        </div>
      </div>
    </div>
  )
}
