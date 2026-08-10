import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "About nucleos | Nucleos Compliance Ltd",
  description:
    "nucleos is built by Nucleos Compliance Ltd to make CBAM compliance accurate and defensible for UK and EU importers. The platform is the calculation, not a wrapper around a spreadsheet.",
};

const principles = [
  {
    title: "The number is the product.",
    body: "CBAM compliance ends with a number submitted to HMRC. Every feature in nucleos exists to produce that number correctly and make it defensible. We do not build features that do not serve the calculation.",
  },
  {
    title: "Traceability is not optional.",
    body: "Every figure in your HMRC return must trace to its source document and the calculation that produced it. An audit is possible without notice. nucleos treats the audit trail as infrastructure, not an afterthought.",
  },
  {
    title: "Defaults are honest.",
    body: "When supplier data is unavailable, the correct answer is a documented default with the appropriate surcharge, not an approximation presented as actual data. nucleos shows you the cost of defaults so you can decide whether to pursue actual data.",
  },
  {
    title: "Both regimes, correctly.",
    body: "UK and EU CBAM are different legal systems with different scope, different calculation methodologies, and different output formats. We do not treat them as the same thing with a flag switch. They have separate calculation engines.",
  },
];

export default function AboutPage() {
  return (
    <>
      <Nav />

      {/* Header */}
      <section
        className="section-sm bg-surface"
        style={{ borderBottom: "0.5px solid var(--color-border)" }}
      >
        <div className="page-content">
          <p
            className="text-xs text-text-tertiary mb-4"
            style={{ letterSpacing: "0.1em" }}
          >
            ABOUT
          </p>
          <h1
            className="text-lg text-text-primary mb-3 max-w-[480px]"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            nucleos is built to make CBAM compliance accurate and defensible.
          </h1>
        </div>
      </section>

      {/* Mission */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-sm text-text-secondary mb-6" style={{ lineHeight: 1.8 }}>
                CBAM is a calculation problem. UK and EU importers of steel, aluminium, cement,
                fertilisers, and hydrogen must determine the embedded carbon in their supply
                chain, apply the correct carbon price, and submit a defensible return to HMRC
                or the EU CBAM Registry.
              </p>
              <p className="text-sm text-text-secondary mb-6" style={{ lineHeight: 1.8 }}>
                The tools available to do this are inadequate. The European Commission published
                an Excel spreadsheet that answers one binary question and was last updated in
                March 2025. HMRC has published guidance commitments, not tools. Most importers
                are managing CBAM in a spreadsheet that cannot provide an audit trail, cannot
                reconcile conflicting supplier documents, and cannot apply Carbon Price Relief.
              </p>
              <p className="text-sm text-text-secondary" style={{ lineHeight: 1.8 }}>
                nucleos is the platform that fills this gap, from supplier document upload to
                submitted HMRC return, with every calculation traceable and every assumption
                documented.
              </p>
            </div>

            <div className="flex flex-col gap-px" style={{ backgroundColor: "var(--color-border)", border: "0.5px solid var(--color-border)", borderRadius: "var(--card-radius)", overflow: "hidden" }}>
              {principles.map((p) => (
                <div key={p.title} className="bg-surface p-8">
                  <h3
                    className="text-base text-text-primary mb-3"
                    style={{ fontWeight: 500 }}
                  >
                    {p.title}
                  </h3>
                  <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Regulatory grounding */}
      <section className="section bg-surface">
        <div className="page-content">
          <div className="mb-12">
            <p
              className="text-xs text-text-tertiary mb-4"
              style={{ letterSpacing: "0.1em" }}
            >
              REGULATORY BASIS
            </p>
            <h2
              className="text-lg text-text-primary max-w-[480px]"
              style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
            >
              Built to the regulation, not around it.
            </h2>
          </div>

          <div
            className="flex flex-col"
            style={{ borderTop: "0.5px solid var(--color-border)" }}
          >
            {[
              {
                label: "UK CBAM",
                ref: "Finance (No.2) Bill 2025–26",
                note: "UK liability calculation, registration threshold, return format, record retention",
              },
              {
                label: "EU CBAM",
                ref: "Regulation (EU) 2023/956, amended by Regulation (EU) 2025/2083",
                note: "EU declaration, certificate mechanism, sector scope including electricity",
              },
              {
                label: "Default values",
                ref: "Commission Implementing Regulation (EU) 2023/1773, Annex VI",
                note: "World-average default SEE values, updated per CN code revision",
              },
              {
                label: "Emissions calculation",
                ref: "EU 2023/1773 Art. 4: three-tier hierarchy",
                note: "Tier 1 actual verified, Tier 2 estimated, Tier 3 default",
              },
              {
                label: "Free allocation adjustment",
                ref: "UK ETS Authority quarterly publication",
                note: "Sector-specific FA factors applied per quarter",
              },
            ].map((r) => (
              <div
                key={r.label}
                className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-6 py-6 px-4"
                style={{ borderBottom: "0.5px solid var(--color-border)" }}
              >
                <p className="text-sm text-text-primary" style={{ fontWeight: 500 }}>
                  {r.label}
                </p>
                <div>
                  <p className="text-sm text-text-secondary mb-1">{r.ref}</p>
                  <p className="text-xs text-text-tertiary">{r.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2
                className="text-lg text-text-primary mb-4"
                style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
              >
                Talk to us before your next shipment arrives.
              </h2>
              <p className="text-sm text-text-secondary mb-8" style={{ lineHeight: 1.7 }}>
                The data from your 2027 shipments needs to be captured when the goods
                arrive, not assembled retrospectively from memory in April 2028. The
                earlier you start, the more complete your audit trail.
              </p>
              <div className="flex gap-3">
                <Button href="/demo" variant="primary">
                  Request a demo
                </Button>
                <Button href="/scope-checker" variant="ghost">
                  Check your scope
                </Button>
              </div>
            </div>
            <div
              className="bg-surface rounded-card p-8"
              style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
            >
              <p className="text-xs text-text-tertiary mb-6" style={{ letterSpacing: "0.08em" }}>
                CONTACT
              </p>
              <p className="text-sm text-text-secondary mb-2" style={{ lineHeight: 1.7 }}>
                Nucleos Compliance Ltd
              </p>
              <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                For product questions, compliance queries, or enterprise enquiries, use the demo request form and we will respond within one business day.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
