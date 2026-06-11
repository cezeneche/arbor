import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Privacy policy | Nucleos Compliance Ltd",
  description:
    "How Nucleos Compliance Ltd collects, uses, and protects personal data under the UK GDPR and Data Protection Act 2018.",
};

const EFFECTIVE = "1 June 2026";

export default function PrivacyPage() {
  return (
    <>
      <Nav />

      <section
        className="section-sm bg-surface"
        style={{ borderBottom: "0.5px solid var(--color-border)" }}
      >
        <div className="page-content">
          <p
            className="text-xs text-text-tertiary mb-4"
            style={{ letterSpacing: "0.1em" }}
          >
            LEGAL
          </p>
          <h1
            className="text-lg text-text-primary mb-3"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            Privacy policy
          </h1>
          <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
            Effective {EFFECTIVE}. This policy describes how Nucleos Compliance Ltd collects,
            uses, and protects personal data in connection with the nucleos platform and website.
          </p>
        </div>
      </section>

      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div
            className="bg-surface rounded-card"
            style={{
              border: "0.5px solid var(--color-border)",
              padding: "clamp(32px, 5vw, 64px)",
              maxWidth: "720px",
            }}
          >
            <LegalSection title="1. Who we are">
              <p>
                Nucleos Compliance Ltd is the data controller for personal data processed through the
                nucleos platform and website. We are incorporated in England and Wales.
              </p>
              <p>
                Contact: <a href="mailto:privacy@nucleos.co.uk">privacy@nucleos.co.uk</a>
              </p>
            </LegalSection>

            <LegalSection title="2. What data we collect">
              <p><strong>2.1 Demo and enquiry requests.</strong> When you submit a demo request,
                we collect: full name, work email address, company name, job role, sector, and any
                information you include in your message. This is provided voluntarily and used
                solely to respond to your enquiry.
              </p>

              <p><strong>2.2 Account data.</strong> When you create a nucleos account, we collect
                your email address and, where provided, your organisation name and EORI number.
              </p>

              <p><strong>2.3 Import and compliance data.</strong> When you use the nucleos platform,
                you upload supplier documents including invoices, mill certificates, and customs
                declarations. These may contain personal data about individuals at your suppliers
                (names, contact details on documents). We process this data on your behalf, acting
                as your data processor for this purpose. Calculation outputs, CBAM liability figures,
                and report packages are stored in connection with your account.
              </p>

              <p><strong>2.4 Usage data.</strong> We collect standard server logs including IP
                addresses, browser type, and pages accessed. This is used for security and platform
                operation.
              </p>
            </LegalSection>

            <LegalSection title="3. Legal basis for processing">
              <ul>
                <li>
                  <strong>Demo enquiries:</strong> Legitimate interest in responding to prospective
                  customers who have contacted us voluntarily.
                </li>
                <li>
                  <strong>Account and subscription data:</strong> Performance of contract. We need
                  your account data to provide the service you have subscribed to.
                </li>
                <li>
                  <strong>Supplier document processing:</strong> Performance of contract. Processing
                  uploaded documents is the core service you have contracted for.
                </li>
                <li>
                  <strong>Regulatory retention:</strong> Legal obligation. UK CBAM regulations
                  require CBAM records to be retained for six years.
                </li>
              </ul>
            </LegalSection>

            <LegalSection title="4. How we use your data">
              <p>We use the data we collect to:</p>
              <ul>
                <li>Respond to demo requests and enquiries</li>
                <li>Provide and maintain the nucleos platform</li>
                <li>Calculate CBAM liability on your behalf</li>
                <li>Generate HMRC returns and EU CBAM declarations</li>
                <li>Send transactional communications related to your account</li>
                <li>Meet regulatory record-keeping obligations</li>
                <li>Investigate and resolve platform errors</li>
              </ul>
              <p>
                We do not sell personal data. We do not use your data to train AI models.
                We do not send marketing emails without your explicit consent.
              </p>
            </LegalSection>

            <LegalSection title="5. Third-party processors">
              <p>We share data with the following sub-processors to operate the platform:</p>
              <ul>
                <li>
                  <strong>Supabase Inc.</strong> — Database hosting and document storage. Data is
                  stored in EU data centres. Supabase processes data under a Data Processing
                  Agreement compliant with UK GDPR Article 28.
                </li>
                <li>
                  <strong>Anthropic, PBC</strong> — AI document processing. When you upload a
                  supplier document, its content is sent to Anthropic's API for extraction. Anthropic
                  operates under a Data Processing Addendum; document contents are not used to train
                  Anthropic's models. Anthropic processes data under standard contractual clauses.
                </li>
              </ul>
              <p>
                We do not share personal data with any other third party except where required by law
                or as necessary to provide the service (for example, HMRC where you authorise us to
                submit on your behalf).
              </p>
            </LegalSection>

            <LegalSection title="6. Data retention">
              <ul>
                <li>
                  <strong>Demo enquiry data:</strong> Retained for two years from the date of
                  enquiry, or until you ask us to delete it.
                </li>
                <li>
                  <strong>Account data:</strong> Retained for the duration of your subscription and
                  for six years after it ends, to comply with HMRC record-keeping requirements.
                </li>
                <li>
                  <strong>CBAM calculation records:</strong> Retained for six years from the date of
                  the relevant CBAM return, as required by the Finance (No.2) Act 2025-26 and
                  associated HMRC guidance.
                </li>
                <li>
                  <strong>Uploaded documents:</strong> Retained for the life of your account and
                  for six years after closure. You may request deletion of individual documents
                  outside the mandatory retention period.
                </li>
              </ul>
            </LegalSection>

            <LegalSection title="7. Your rights under UK GDPR">
              <p>
                As a UK data subject, you have the following rights in relation to your personal data:
              </p>
              <ul>
                <li>
                  <strong>Access:</strong> Request a copy of the personal data we hold about you.
                </li>
                <li>
                  <strong>Rectification:</strong> Ask us to correct inaccurate or incomplete data.
                </li>
                <li>
                  <strong>Erasure:</strong> Request deletion of your personal data, subject to
                  regulatory retention obligations (see Section 6).
                </li>
                <li>
                  <strong>Restriction:</strong> Ask us to restrict processing while a dispute is
                  resolved.
                </li>
                <li>
                  <strong>Portability:</strong> Receive a structured, machine-readable copy of data
                  you have provided to us.
                </li>
                <li>
                  <strong>Objection:</strong> Object to processing based on legitimate interest.
                </li>
              </ul>
              <p>
                To exercise any of these rights, email{" "}
                <a href="mailto:privacy@nucleos.co.uk">privacy@nucleos.co.uk</a>. We will respond
                within one calendar month.
              </p>
            </LegalSection>

            <LegalSection title="8. Cookies">
              <p>
                The nucleos website uses a session cookie to maintain your login state. No
                third-party analytics or advertising cookies are used. The scope checker tool
                operates without requiring a cookie.
              </p>
            </LegalSection>

            <LegalSection title="9. Security">
              <p>
                All data in transit is encrypted with TLS 1.2 or higher. Calculation records are
                protected by an HMAC-signed audit chain. We apply field-level encryption to sensitive
                import data at rest. Access to production systems is restricted to authorised
                personnel.
              </p>
            </LegalSection>

            <LegalSection title="10. Complaints">
              <p>
                If you believe we have handled your personal data unlawfully, you have the right to
                lodge a complaint with the UK Information Commissioner&apos;s Office (ICO):
              </p>
              <p>
                ICO website: ico.org.uk<br />
                ICO helpline: 0303 123 1113
              </p>
              <p>
                We would prefer to resolve any concern directly. Please contact us at{" "}
                <a href="mailto:privacy@nucleos.co.uk">privacy@nucleos.co.uk</a> before escalating
                to the ICO.
              </p>
            </LegalSection>

            <LegalSection title="11. Changes to this policy">
              <p>
                We will update this policy when our processing practices change materially. The
                effective date at the top of this page reflects the most recent revision. Subscribers
                will be notified of material changes by email at least 14 days before they take
                effect.
              </p>
            </LegalSection>

            <p
              className="text-xs text-text-tertiary"
              style={{ marginTop: "48px", borderTop: "0.5px solid var(--color-border)", paddingTop: "24px" }}
            >
              Nucleos Compliance Ltd · privacy@nucleos.co.uk · Effective {EFFECTIVE}
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}

function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "40px" }}>
      <h2
        className="text-base text-text-primary"
        style={{ fontWeight: 500, marginBottom: "16px", letterSpacing: "-0.01em" }}
      >
        {title}
      </h2>
      <div
        className="text-sm text-text-secondary"
        style={{ lineHeight: 1.8, display: "flex", flexDirection: "column", gap: "12px" }}
      >
        {children}
      </div>
    </div>
  );
}
