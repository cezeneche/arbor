import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "How nucleos works: from supplier document to HMRC return",
  description:
    "nucleos extracts emissions data from your supplier documents, resolves conflicts, calculates your CBAM liability, and generates your HMRC return, automatically and with a complete audit trail.",
};

const pipeline = [
  {
    number: "01",
    title: "Document upload",
    subtitle: "Any format. Any supplier.",
    body: "Drop in mill certificates, purchase invoices, customs declarations, and supplier emissions reports in any format: PDF, scanned image, or structured file. nucleos accepts them all and routes each document to the correct extraction pipeline.",
    detail: "Documents are stored securely and linked to the specific goods line they relate to. Every upload is timestamped and retained for the six-year HMRC record-keeping requirement.",
  },
  {
    number: "02",
    title: "Structured extraction",
    subtitle: "Every relevant figure, found.",
    body: "The extraction layer reads each document and identifies: CN commodity codes, production routes (BF-BOF, EAF, DRI), direct embedded emissions (tCO₂e/t), indirect emissions where applicable, supplier installation details, and import quantities.",
    detail: "Every extracted value carries a confidence score and the exact source text it was drawn from. Low-confidence values are flagged for human review before they reach the calculation.",
  },
  {
    number: "03",
    title: "Conflict arbitration",
    subtitle: "When documents disagree, nucleos resolves.",
    body: "A mill certificate may state BF-BOF production. An invoice may specify a different facility. The arbitration layer compares every extraction across all documents for a given goods line, identifies conflicts, and applies a documented resolution rule.",
    detail: "The resolution rule and the winning value are both written to the audit record. Your HMRC enquiry response is already drafted before you submit.",
  },
  {
    number: "04",
    title: "Default value fallback",
    subtitle: "No supplier data? No problem.",
    body: "When a supplier cannot or will not provide verified emissions data, nucleos automatically applies the correct Annex VI world-average default for the specific CN code. The 10% default surcharge is calculated and shown, so you can see the cost of not having actual data.",
    detail: "The default value applied, its version reference, and the date of application are recorded. If a supplier provides actual data later, the calculation updates and the improvement in liability is visible.",
  },
  {
    number: "05",
    title: "Liability calculation",
    subtitle: "The correct number, from the correct inputs.",
    body: "The calculation engine is a pure function: given verified embedded emissions, the quarterly UK or EU CBAM rate, and any applicable Carbon Price Relief, it produces a single liability figure. No AI, no approximation, no ambiguity.",
    detail: "UK and EU calculations run separately where a case spans both regimes. The free allocation adjustment is applied automatically. Carbon Price Relief is calculated and deducted where the goods originate from a country with a qualifying carbon pricing scheme.",
  },
  {
    number: "06",
    title: "Return generation",
    subtitle: "Ready to submit.",
    body: "nucleos generates your HMRC self-assessment return (UK) or EU CBAM declaration XML in the correct format, pre-populated with all required fields. Every figure in the return traces to its source document and calculation step.",
    detail: "The audit package (source documents, extraction outputs, conflict resolutions, and calculation records) is bundled alongside the return. Six-year retention is built in.",
  },
];

const sectors = [
  { name: "Iron & steel", note: "BF-BOF, EAF, DRI routes handled" },
  { name: "Aluminium", note: "Primary and secondary, UK indirect emissions deferred" },
  { name: "Cement", note: "Clinker content differentiation supported" },
  { name: "Fertilisers", note: "CO₂ and N₂O both calculated" },
  { name: "Hydrogen", note: "Grey, blue, green production routes" },
  { name: "EU electricity", note: "EU CBAM only; excluded under UK CBAM" },
];

export default function HowItWorksPage() {
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
            HOW IT WORKS
          </p>
          <h1
            className="text-lg text-text-primary mb-3 max-w-[520px]"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            From supplier document to HMRC return.
          </h1>
          <p className="text-sm text-text-secondary max-w-[560px]" style={{ lineHeight: 1.7 }}>
            nucleos handles every step of the CBAM compliance workflow: extraction,
            calculation, and submission, with a complete audit trail at every stage.
          </p>
        </div>
      </section>

      {/* Pipeline */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div
            className="flex flex-col"
            style={{ borderTop: "0.5px solid var(--color-border)" }}
          >
            {pipeline.map((step) => (
              <div
                key={step.number}
                className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 py-12"
                style={{ borderBottom: "0.5px solid var(--color-border)" }}
              >
                <div>
                  <p
                    className="text-xs text-text-tertiary mb-2"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    STEP {step.number}
                  </p>
                  <p
                    className="text-base text-text-primary"
                    style={{ fontWeight: 500 }}
                  >
                    {step.title}
                  </p>
                </div>
                <div className="max-w-[560px]">
                  <p
                    className="text-base text-text-primary mb-3"
                    style={{ fontWeight: 500 }}
                  >
                    {step.subtitle}
                  </p>
                  <p className="text-sm text-text-secondary mb-4" style={{ lineHeight: 1.7 }}>
                    {step.body}
                  </p>
                  <p className="text-sm text-text-tertiary" style={{ lineHeight: 1.7 }}>
                    {step.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sectors */}
      <section className="section bg-surface">
        <div className="page-content">
          <div className="mb-12">
            <p
              className="text-xs text-text-tertiary mb-4"
              style={{ letterSpacing: "0.1em" }}
            >
              SECTORS COVERED
            </p>
            <h2
              className="text-lg text-text-primary"
              style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
            >
              UK and EU CBAM, both regimes.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ backgroundColor: "var(--color-border)", border: "0.5px solid var(--color-border)", borderRadius: "var(--card-radius)", overflow: "hidden" }}>
            {sectors.map((s) => (
              <div
                key={s.name}
                className="bg-surface px-8 py-6 flex items-center justify-between"
              >
                <p className="text-base text-text-primary" style={{ fontWeight: 500 }}>
                  {s.name}
                </p>
                <p className="text-xs text-text-tertiary text-right max-w-[200px]">
                  {s.note}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section bg-navy">
        <div className="page-content text-center">
          <h2
            className="text-lg text-surface mb-4"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            See it working with your documents.
          </h2>
          <p
            className="text-sm mb-10 max-w-[400px] mx-auto"
            style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}
          >
            Send us one of your supplier documents. We&apos;ll run it through the pipeline
            and show you the output before you commit to anything.
          </p>
          <Button href="/demo" variant="primary-inverse">
            Request a demo
          </Button>
        </div>
      </section>

      <Footer />
    </>
  );
}
