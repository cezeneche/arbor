import type { Metadata } from 'next'
import { colours, typography } from '@/lib/design-system'
import { SUB_PROCESSORS, DPA_LAST_UPDATED } from '@/lib/legal/subprocessors'
import { LegalContents } from '@/components/marketing/LegalContents'
import { legalContainer, legalH2, legalH3, legalLi, legalP } from '@/components/marketing/legal-styles'
import { LegalDraftNotice } from '@/components/marketing/LegalDraftNotice'

export const metadata: Metadata = { title: 'Data Processing Agreement | Arbor', description: 'The Arbor data processing terms and sub-processor information.' }

// IMPORTANT: This document must be reviewed by a qualified solicitor before publication.

export default function DpaPage() {
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
            Data Processing Agreement
          </h1>
          <LegalDraftNotice />
          <p style={{ ...legalP, margin: '0 0 12px' }}>
            Document date: 1 June 2026. Sub-processor appendix updated: {DPA_LAST_UPDATED}.
          </p>
          <p style={{ ...legalP, margin: 0 }}>
            This Data Processing Agreement (&quot;DPA&quot;) forms part of the Terms of Service between
            Arbor [contracting entity to confirm] (&quot;Processor&quot;) and the entity that has agreed to those terms
            (&quot;Customer&quot;, &quot;Controller&quot;). It applies where arbor processes personal data on behalf
            of the Customer in the course of providing the arbor platform service.
          </p>
          <p style={{ ...legalP, margin: '20px 0 0' }}>
            To keep a review copy, use your browser&apos;s Print command and choose Save as PDF. The approved agreement will be provided after legal review.
          </p>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '64px 0 96px' }}>
        <div id="dpa-sections" className="mk-legal-reading" style={legalContainer}>
          <LegalContents sections={[{ id: 'dpa-scope', label: 'Scope' }, { id: 'dpa-obligations', label: 'Processor obligations' }, { id: 'dpa-processors', label: 'Sub-processors' }, { id: 'dpa-deletion', label: 'Return and deletion' }, { id: 'dpa-appendix', label: 'Appendix A' }, { id: 'dpa-contact', label: 'Contact' }]} />

          <h2 style={legalH2}>1. Definitions</h2>
          <p style={legalP}>
            Terms defined in UK GDPR (UK General Data Protection Regulation) and the Data Protection
            Act 2018 have the same meaning here. &quot;Personal data&quot;, &quot;processing&quot;, &quot;data subject&quot;,
            &quot;data controller&quot;, and &quot;data processor&quot; are used as defined in those instruments.
          </p>
          <p style={legalP}>
            &quot;Services&quot; means the operational data repository platform provided by arbor under the Terms
            of Service, including document ingestion, data extraction, certification, storage, and access
            facilitation.
          </p>

          <h2 id="dpa-scope" style={legalH2}>2. Scope and subject matter</h2>
          <p style={legalP}>
            arbor processes personal data on behalf of the Customer solely to provide the Services.
            The nature and purpose of processing is the ingestion, AI-powered extraction, storage,
            certification, and controlled sharing of operational data records derived from documents
            submitted by the Customer.
          </p>
          <p style={legalP}>
            arbor does not process personal data for its own purposes beyond what is necessary to
            provide the Services, comply with legal obligations, and maintain the security of the platform.
          </p>

          <h2 style={legalH2}>3. Types of personal data and data subjects</h2>
          <h3 style={legalH3}>Personal data categories</h3>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Identity data: names, job titles, and contact details of individuals named in submitted documents',
              'Company data: business names, addresses, registration numbers in submitted documents',
              'Transaction data: invoice amounts, dates, counterparties in submitted documents',
              'Account data: names, email addresses, and credentials of platform users',
            ].map(item => (
              <li key={item} style={legalLi}>{item}</li>
            ))}
          </ul>
          <h3 style={legalH3}>Data subjects</h3>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Employees and authorised users of the Customer who access the platform',
              'Third parties whose personal data appears incidentally in submitted documents (e.g., named on invoices)',
            ].map(item => (
              <li key={item} style={legalLi}>{item}</li>
            ))}
          </ul>

          <h2 style={legalH2}>4. Duration</h2>
          <p style={legalP}>
            This DPA applies for the duration of the Customer&apos;s use of the Services, commencing when
            the Customer first submits personal data to the platform and ending when all personal data
            has been deleted in accordance with Clause 11.
          </p>

          <h2 id="dpa-obligations" style={legalH2}>5. Processor obligations</h2>
          <p style={legalP}>arbor shall:</p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            <li style={legalLi}>
              Process personal data only on documented instructions from the Controller, including with
              regard to transfers, unless required to do so by applicable law.
            </li>
            <li style={legalLi}>
              Ensure that persons authorised to process personal data have committed to confidentiality or
              are under an appropriate statutory obligation of confidentiality.
            </li>
            <li style={legalLi}>
              Implement appropriate technical and organisational measures to ensure a level of security
              appropriate to the risk, as described in Clause 10.
            </li>
            <li style={legalLi}>
              Not engage sub-processors without the prior written authorisation of the Controller, except
              as set out in Clause 6.
            </li>
            <li style={legalLi}>
              Assist the Controller in responding to data subject requests, to the extent technically
              feasible, taking into account the nature of processing.
            </li>
            <li style={legalLi}>
              Notify the Controller promptly, and in any event within 72 hours of becoming aware, of any
              personal data breach affecting the Controller&apos;s data.
            </li>
            <li style={legalLi}>
              Delete or return all personal data on termination of the Services, as set out in Clause 11.
            </li>
            <li style={legalLi}>
              Make available to the Controller all information necessary to demonstrate compliance with
              this DPA, and allow for and contribute to audits conducted by the Controller or a mandated
              auditor, on reasonable prior written notice.
            </li>
          </ul>

          <h2 id="dpa-processors" style={legalH2}>6. Sub-processors</h2>
          <p style={legalP}>
            The following is an illustrative provider inventory for review. The actual sub-processor list,
            locations, customer authorisation and related agreements must be verified before execution:
          </p>
          <div
            tabIndex={0}
            role="region"
            aria-label="Sub-processors"
            style={{
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              overflowX: 'auto',
              marginBottom: '16px',
            }}
          >
            {SUB_PROCESSORS.map(({ name, activity, location }, i) => (
              <div
                key={name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr 200px',
                  minWidth: '600px',
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
                  {activity}
                </span>
                <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
                  {location}
                </span>
              </div>
            ))}
          </div>
          <p style={legalP}>
            arbor will notify the Customer of any intended changes to this list (additions or replacements)
            by email, with at least 14 days&apos; prior notice, giving the Customer opportunity to object.
            arbor will impose equivalent data protection obligations on all sub-processors.
          </p>

          <h2 style={legalH2}>7. International transfers</h2>
          <p style={legalP}>
            The parties must identify any international transfers and confirm the applicable UK transfer
            safeguards before executing this DPA. Provider locations and transfer terms in this draft have
            not been verified.
          </p>

          <h2 style={legalH2}>8. Data subject rights</h2>
          <p style={legalP}>
            Where arbor receives a data subject request relating to personal data it processes on behalf
            of the Customer, arbor will promptly forward the request to the Customer and will not respond
            to the data subject directly without the Customer&apos;s authorisation, except as required by law.
          </p>
          <p style={legalP}>
            arbor will, at the Customer&apos;s written request, assist with the fulfilment of data subject
            requests to the extent technically feasible, given the nature of the processing.
          </p>

          <h2 style={legalH2}>9. Personal data breach notification</h2>
          <p style={legalP}>
            arbor shall notify the Customer without undue delay, and where feasible within 72 hours,
            after becoming aware of a personal data breach affecting data processed under this DPA.
            Notification will include the nature of the breach, the categories and approximate number
            of data subjects and records concerned, the likely consequences, and measures taken or
            proposed to address the breach.
          </p>

          <h2 style={legalH2}>10. Technical and organisational measures</h2>
          <p style={legalP}>
            arbor implements the following technical and organisational measures to protect personal data:
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {[
              'Transport and storage encryption controls, subject to deployment evidence',
              'Access controls limiting database access to authorised personnel only',
              'HMAC-chained audit log for all data record writes',
              'Password hashing using bcrypt with cost factor 12',
              'Role-based access control within the platform',
              'API key scoping to limit access to authorised data only',
              'Separate storage of AI extraction layer from the permanent record store',
              'Regular security review of third-party sub-processors',
            ].map(item => (
              <li key={item} style={legalLi}>{item}</li>
            ))}
          </ul>

          <h2 id="dpa-deletion" style={legalH2}>11. Return and deletion of data</h2>
          <p style={legalP}>
            On termination of the Services, arbor shall, at the Customer&apos;s election:
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            <li style={legalLi}>
              Return all personal data to the Customer in a structured, machine-readable format (CSV or JSON), or
            </li>
            <li style={legalLi}>
              Securely delete personal data and provide written confirmation under the agreed retention and deletion schedule, including backup expiry.
            </li>
          </ul>
          <p style={legalP}>
            arbor may retain personal data beyond termination where required to do so by applicable law,
            for the period required by that law only.
          </p>

          <h2 style={legalH2}>12. Audit rights</h2>
          <p style={legalP}>
            arbor shall make available to the Customer all information reasonably necessary to demonstrate
            compliance with this DPA and shall allow for and contribute to audits and inspections conducted
            by the Customer or its nominated auditor, on reasonable prior written notice of no less than
            30 days.
          </p>
          <p style={legalP}>
            arbor may object to an audit on reasonable grounds (including disruption to operations or
            conflict with confidentiality obligations to other customers) and in such case shall work with
            the Customer to agree an alternative approach that satisfies the Customer&apos;s compliance needs.
          </p>

          <h2 id="dpa-appendix" style={legalH2}>Appendix A — Sub-processors</h2>
          <p style={legalP}>
            arbor engages the following sub-processors to provide the Services. This
            sample list was last edited on {DPA_LAST_UPDATED}; it is not a verified current inventory.
            Notice terms for changes require legal and operational approval.
          </p>
          <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
            {SUB_PROCESSORS.map((s) => (
              <li key={s.name} style={legalLi}>
                <strong style={{ fontWeight: typography.weights.medium, color: colours.textPrimary }}>{s.name}</strong>
                {' '}— {s.activity}. Location: {s.location}.
              </li>
            ))}
          </ul>

          <h2 style={legalH2}>13. Governing law</h2>
          <p style={legalP}>
            This DPA is governed by the laws of England and Wales and is subject to the exclusive
            jurisdiction of the courts of England and Wales.
          </p>

          <h2 id="dpa-contact" style={legalH2}>14. Contact</h2>
          <p style={legalP}>
            For all data protection queries, contact legal@arbor.io or write to:
            arbor (registered address to be confirmed).
          </p>

        </div>
      </div>
    </div>
  )
}
