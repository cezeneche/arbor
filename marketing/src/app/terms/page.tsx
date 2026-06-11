import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Terms of service | Nucleos Compliance Ltd",
  description:
    "Terms governing access to and use of the nucleos CBAM compliance platform, provided by Nucleos Compliance Ltd.",
};

const EFFECTIVE = "1 June 2026";

export default function TermsPage() {
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
            Terms of service
          </h1>
          <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
            Effective {EFFECTIVE}. These terms govern your access to and use of the nucleos platform
            provided by Nucleos Compliance Ltd.
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
            <LegalSection title="1. Parties and agreement">
              <p>
                These terms form a binding agreement between Nucleos Compliance Ltd
                (&ldquo;Nucleos&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) and the individual or
                organisation accessing the platform (&ldquo;you&rdquo;, &ldquo;subscriber&rdquo;).
                By creating an account or using the nucleos platform, you agree to these terms.
              </p>
              <p>
                If you are accepting these terms on behalf of an organisation, you represent that
                you have authority to bind that organisation.
              </p>
            </LegalSection>

            <LegalSection title="2. What nucleos provides">
              <p>
                nucleos is a calculation and reporting tool for UK and EU Carbon Border Adjustment
                Mechanism (CBAM) compliance. The platform:
              </p>
              <ul>
                <li>Extracts relevant data from uploaded supplier documents</li>
                <li>Calculates embedded emissions and estimated CBAM liability</li>
                <li>Generates HMRC self-assessment returns and EU CBAM declarations</li>
                <li>Maintains an audit-ready record of calculations and source documents</li>
              </ul>

              <p
                style={{
                  borderLeft: "3px solid var(--color-amber)",
                  paddingLeft: "16px",
                  margin: "8px 0",
                }}
              >
                <strong>Important:</strong> nucleos is a calculation tool, not a tax adviser or
                legal adviser. Nothing in the platform or on the nucleos website constitutes tax
                advice, legal advice, or professional compliance advice. You are responsible for
                verifying that your submissions to HMRC and the EU CBAM Registry are correct and
                complete. We strongly recommend that you consult a qualified tax adviser or customs
                specialist for your specific circumstances.
              </p>
            </LegalSection>

            <LegalSection title="3. CBAM rate disclaimer">
              <p>
                UK CBAM rates are published quarterly by HMRC. Until HMRC publishes official
                quarterly rates (expected from Q4 2026), the platform uses placeholder rates derived
                from the UK ETS price and sector-specific free allocation factors. These are
                estimates only.
              </p>
              <p>
                We will update the platform automatically when HMRC publishes official rates.
                Calculations performed using placeholder rates will be clearly labelled as such.
                You must not submit a return based on placeholder rates without first verifying the
                current official rate with HMRC.
              </p>
            </LegalSection>

            <LegalSection title="4. Your responsibilities">
              <p>You are responsible for:</p>
              <ul>
                <li>
                  Ensuring that documents you upload are genuine, accurate, and relate to actual
                  import transactions
                </li>
                <li>
                  Registering with HMRC for UK CBAM and with the relevant national competent
                  authority for EU CBAM, where required
                </li>
                <li>
                  Reviewing all platform outputs before submitting any return or declaration to HMRC
                  or the EU CBAM Registry
                </li>
                <li>
                  Obtaining third-party verification for actual emissions data and Carbon Price
                  Relief claims where required by regulation
                </li>
                <li>
                  Retaining original source documents for the regulatory retention period (six years
                  under UK CBAM)
                </li>
                <li>
                  Keeping your account credentials secure and notifying us immediately of any
                  unauthorised access
                </li>
              </ul>
            </LegalSection>

            <LegalSection title="5. Acceptable use">
              <p>You must not use the platform to:</p>
              <ul>
                <li>Upload documents that are fraudulent, forged, or fabricated</li>
                <li>
                  Attempt to understate CBAM liability deliberately through manipulation of
                  calculation inputs
                </li>
                <li>
                  Reverse-engineer, copy, or resell any part of the platform or its calculation
                  methodology
                </li>
                <li>
                  Conduct automated scraping or bulk data extraction outside of features provided
                  for that purpose
                </li>
                <li>
                  Use the platform in a way that violates any applicable law, including UK CBAM
                  legislation, HMRC rules, or data protection law
                </li>
              </ul>
            </LegalSection>

            <LegalSection title="6. Subscription and payment">
              <p>
                Access to the platform is provided on a subscription basis. Pricing is as described
                on the nucleos pricing page at the time of your subscription.
              </p>
              <ul>
                <li>
                  Subscriptions are billed annually in advance unless otherwise agreed in writing.
                </li>
                <li>
                  You may cancel your subscription at any time. Cancellation takes effect at the end
                  of your current billing period. No partial refunds are provided for the unused
                  portion of a billing period, except within 14 days of initial purchase.
                </li>
                <li>
                  We reserve the right to change pricing with 60 days&apos; written notice. Price
                  changes take effect at your next renewal date.
                </li>
                <li>
                  Enterprise and custom pricing agreements are governed by the written agreement
                  between the parties, which takes precedence over these terms where they conflict.
                </li>
              </ul>
            </LegalSection>

            <LegalSection title="7. Data and confidentiality">
              <p>
                Your import data, calculation outputs, and uploaded documents are your confidential
                information. We process this data on your behalf to provide the service. We do not
                share your data with third parties except as described in our Privacy Policy and
                as necessary to operate the platform.
              </p>
              <p>
                We may use aggregated, anonymised data about platform usage (not your specific import
                data) to improve the service.
              </p>
            </LegalSection>

            <LegalSection title="8. Intellectual property">
              <p>
                The nucleos platform, including its calculation methodology, software, and
                documentation, is owned by Nucleos Compliance Ltd and protected by copyright and
                other intellectual property laws.
              </p>
              <p>
                Your subscription grants you a non-exclusive, non-transferable licence to use the
                platform for your own CBAM compliance purposes. You may not copy, modify,
                distribute, or create derivative works from the platform.
              </p>
              <p>
                You retain ownership of all data you upload. By uploading documents, you grant us
                a limited licence to process them to provide the service.
              </p>
            </LegalSection>

            <LegalSection title="9. Limitation of liability">
              <p>
                To the extent permitted by law:
              </p>
              <ul>
                <li>
                  We are not liable for any CBAM penalties, interest charges, or compliance failures
                  arising from your reliance on platform outputs without appropriate professional
                  review.
                </li>
                <li>
                  We are not liable for errors in calculation outputs caused by inaccurate,
                  incomplete, or fraudulent input data.
                </li>
                <li>
                  Our total aggregate liability to you for any claim arising out of or in connection
                  with these terms is limited to the subscription fees you paid in the 12 months
                  preceding the claim.
                </li>
                <li>
                  We are not liable for any indirect, consequential, or special losses, including
                  loss of profits, loss of business, or loss of data.
                </li>
              </ul>
              <p>
                Nothing in these terms limits our liability for death or personal injury caused by
                negligence, fraud, or any other liability that cannot be excluded by law.
              </p>
            </LegalSection>

            <LegalSection title="10. Service availability">
              <p>
                We aim to make the platform available at all times but do not guarantee uninterrupted
                access. We may take the platform offline for maintenance with reasonable prior notice
                where practicable. We are not liable for losses arising from platform downtime.
              </p>
            </LegalSection>

            <LegalSection title="11. Termination">
              <p>
                We may suspend or terminate your account if you breach these terms and fail to
                remedy the breach within 14 days of written notice, or immediately if we believe the
                breach involves fraud or wilful misconduct.
              </p>
              <p>
                On termination, your access to the platform ceases. We will retain your CBAM
                calculation records for the regulatory retention period (six years) and make them
                available to you on request. After the retention period, your data will be deleted.
              </p>
            </LegalSection>

            <LegalSection title="12. Governing law">
              <p>
                These terms are governed by the laws of England and Wales. Any dispute arising out
                of or in connection with these terms shall be subject to the exclusive jurisdiction
                of the courts of England and Wales.
              </p>
            </LegalSection>

            <LegalSection title="13. Changes to these terms">
              <p>
                We may update these terms from time to time. We will notify you by email at least
                14 days before material changes take effect. Continued use of the platform after
                that date constitutes acceptance of the revised terms.
              </p>
              <p>
                The effective date at the top of this page reflects the most recent revision.
              </p>
            </LegalSection>

            <LegalSection title="14. Contact">
              <p>
                Questions about these terms: <a href="mailto:hello@nucleos.co.uk">hello@nucleos.co.uk</a>
              </p>
              <p>
                Nucleos Compliance Ltd, England and Wales
              </p>
            </LegalSection>

            <p
              className="text-xs text-text-tertiary"
              style={{ marginTop: "48px", borderTop: "0.5px solid var(--color-border)", paddingTop: "24px" }}
            >
              Nucleos Compliance Ltd · hello@nucleos.co.uk · Effective {EFFECTIVE}
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
