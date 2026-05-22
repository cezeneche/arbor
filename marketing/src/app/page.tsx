import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "nucleos — CBAM compliance, calculated",
  description:
    "nucleos reads your supplier documents and calculates exactly what you owe under UK and EU CBAM — line by line, tonne by tonne.",
};

const stats = [
  { value: "5", label: "sectors in scope" },
  { value: "£50k", label: "UK registration threshold" },
  { value: "31 May 2028", label: "first UK return due" },
  { value: "6 years", label: "record retention required" },
];

const problems = [
  {
    number: "01",
    title: "Missing the threshold",
    body: "The UK CBAM registration threshold is £50,000 of covered goods in a rolling 12-month window. It is tested monthly. Most importers find out they were in scope months after they should have registered.",
  },
  {
    number: "02",
    title: "Default value surcharge",
    body: "If you cannot provide verified supplier emissions data, HMRC applies a 10% surcharge on top of the default Annex VI figure. For a £200,000 liability, that is £20,000 overpaid — every year.",
  },
  {
    number: "03",
    title: "No audit trail",
    body: "CBAM records must be retained for six years and be defensible under HMRC enquiry. A spreadsheet with manual inputs is not a defensible audit trail. Every number must trace to its source document.",
  },
];

const steps = [
  {
    step: "01",
    title: "Upload your supplier documents",
    body: "Drop in mill certificates, invoices, customs declarations, and supplier emissions reports. nucleos extracts every relevant figure and flags anything that needs review.",
  },
  {
    step: "02",
    title: "Review the calculation",
    body: "The engine calculates embedded emissions for each goods line, applies the correct UK or EU CBAM rate, resolves conflicts between documents, and applies Carbon Price Relief where applicable.",
  },
  {
    step: "03",
    title: "Submit your return",
    body: "nucleos generates your HMRC self-assessment return or EU CBAM declaration. Every figure is traceable to its source document. The audit package is complete before you click submit.",
  },
];

const features = [
  {
    title: "Document extraction",
    body: "Reads mill certificates, invoices, and customs declarations. Extracts CN codes, production routes, and emissions figures. Flags low-confidence values before they reach your return.",
  },
  {
    title: "Conflict arbitration",
    body: "When two documents disagree — a mill certificate says BF-BOF, an invoice says EAF — the arbitration layer resolves the conflict and records why, so your auditor can follow the reasoning.",
  },
  {
    title: "Default value fallback",
    body: "When supplier data is unavailable, nucleos applies the correct Annex VI world-average default for the specific CN code. The 10% default surcharge is calculated automatically and shown clearly.",
  },
  {
    title: "Carbon Price Relief",
    body: "If your goods were produced in a country with a qualifying carbon pricing scheme, nucleos calculates the CPR deduction and reduces your CBAM liability accordingly — properly documented for HMRC.",
  },
  {
    title: "UK and EU coverage",
    body: "One platform, two regimes. The calculation engine handles the different scope (electricity in EU, excluded in UK), different indirect emissions rules, and different output formats simultaneously.",
  },
  {
    title: "Audit-ready records",
    body: "Every calculation output carries an HMAC-signed audit chain. Each entry is timestamped, version-controlled, and traces to the exact paragraph in the source document. Six-year retention built in.",
  },
];

export default function Home() {
  return (
    <>
      {/* Navy hero uses its own dark nav */}
      <div className="bg-navy">
        <Nav dark />

        {/* Hero */}
        <section className="page-content pt-24 pb-32 md:pt-32 md:pb-40">
          <div className="max-w-[600px]">
            <p
              className="text-xs mb-8"
              style={{
                color: "rgba(255,255,255,0.45)",
                letterSpacing: "0.12em",
                fontWeight: 300,
              }}
            >
              UK & EU CBAM COMPLIANCE SOFTWARE
            </p>

            <h1
              className="text-hero md:text-hero-xl text-surface mb-8"
              style={{
                fontWeight: 500,
                letterSpacing: "-0.03em",
                lineHeight: 1.0,
              }}
            >
              CBAM<br />compliance,<br />calculated.
            </h1>

            <p
              className="text-base mb-12 max-w-[440px]"
              style={{ color: "rgba(255,255,255,0.65)", lineHeight: 1.7 }}
            >
              nucleos reads your supplier documents and calculates exactly what you owe
              — line by line, tonne by tonne, before the deadline.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button href="/demo" variant="primary-inverse">
                Request a demo
              </Button>
              <Button href="/scope-checker" variant="ghost-inverse">
                Check your CN code →
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* Stats bar */}
      <section className="bg-surface" style={{ borderBottom: "0.5px solid var(--color-border)" }}>
        <div className="page-content py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-0 md:divide-x divide-border">
            {stats.map((s) => (
              <div key={s.label} className="md:px-8 first:pl-0 last:pr-0">
                <p
                  className="text-lg text-navy mb-1"
                  style={{ fontWeight: 500, letterSpacing: "-0.02em" }}
                >
                  {s.value}
                </p>
                <p className="text-sm text-text-secondary">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem section */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div className="mb-16">
            <p
              className="text-xs text-text-tertiary mb-4"
              style={{ letterSpacing: "0.1em" }}
            >
              THE PROBLEM
            </p>
            <h2
              className="text-lg text-text-primary max-w-[520px]"
              style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
            >
              Three ways importers get CBAM wrong.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {problems.map((p) => (
              <div
                key={p.number}
                className="bg-surface rounded-card p-8"
                style={{ border: "0.5px solid var(--color-border)" }}
              >
                <p
                  className="text-xs text-text-tertiary mb-6"
                  style={{ letterSpacing: "0.1em" }}
                >
                  {p.number}
                </p>
                <h3
                  className="text-base text-text-primary mb-4"
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
      </section>

      {/* How it works */}
      <section className="section bg-surface">
        <div className="page-content">
          <div className="mb-16">
            <p
              className="text-xs text-text-tertiary mb-4"
              style={{ letterSpacing: "0.1em" }}
            >
              HOW IT WORKS
            </p>
            <h2
              className="text-lg text-text-primary"
              style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
            >
              From supplier document to HMRC return.
            </h2>
          </div>

          <div className="flex flex-col gap-0" style={{ borderTop: "0.5px solid var(--color-border)" }}>
            {steps.map((s, i) => (
              <div
                key={s.step}
                className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-8 py-10"
                style={{ borderBottom: "0.5px solid var(--color-border)" }}
              >
                <div>
                  <p
                    className="text-xs text-text-tertiary"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    STEP {s.step}
                  </p>
                </div>
                <div className="max-w-[560px]">
                  <h3
                    className="text-base text-text-primary mb-3"
                    style={{ fontWeight: 500 }}
                  >
                    {s.title}
                  </h3>
                  <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <Link
              href="/how-it-works"
              className="text-sm text-navy hover:text-navy-hover transition-colors"
            >
              See the full workflow →
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div className="mb-16">
            <p
              className="text-xs text-text-tertiary mb-4"
              style={{ letterSpacing: "0.1em" }}
            >
              WHAT NUCLEOS DOES
            </p>
            <h2
              className="text-lg text-text-primary max-w-[440px]"
              style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
            >
              Every step of the compliance workflow, handled.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ backgroundColor: "var(--color-border)" }}>
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-surface p-8"
              >
                <h3
                  className="text-base text-text-primary mb-3"
                  style={{ fontWeight: 500 }}
                >
                  {f.title}
                </h3>
                <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scope checker CTA */}
      <section className="section bg-surface">
        <div className="page-content">
          <div
            className="rounded-card p-12 md:p-16"
            style={{ backgroundColor: "var(--color-bg)", border: "0.5px solid var(--color-border)" }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div>
                <p
                  className="text-xs text-text-tertiary mb-4"
                  style={{ letterSpacing: "0.1em" }}
                >
                  FREE TOOL
                </p>
                <h2
                  className="text-lg text-text-primary mb-4"
                  style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
                >
                  Find out if you&apos;re in scope in 60 seconds.
                </h2>
                <p className="text-sm text-text-secondary mb-8" style={{ lineHeight: 1.7 }}>
                  Enter your CN code and estimated annual import value. The scope checker
                  tells you immediately whether CBAM applies, what your estimated liability
                  is, and when you need to register.
                </p>
                <Button href="/scope-checker" variant="primary">
                  Check your CN code
                </Button>
              </div>

              {/* Visual — document → number representation */}
              <div className="hidden md:flex flex-col gap-3">
                <div
                  className="bg-surface rounded-card p-6"
                  style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
                >
                  <p className="text-xs text-text-tertiary mb-1">CN code</p>
                  <p className="text-base text-text-primary" style={{ fontWeight: 500 }}>
                    7208 10 00
                  </p>
                  <p className="text-xs text-text-tertiary mt-1">Flat-rolled iron, hot-rolled</p>
                </div>
                <div
                  className="flex items-center gap-2 px-2"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border)" }} />
                  <p className="text-xs">nucleos</p>
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-border)" }} />
                </div>
                <div
                  className="bg-surface rounded-card p-6"
                  style={{ border: "0.5px solid var(--color-border)", boxShadow: "var(--card-shadow)" }}
                >
                  <p className="text-xs text-text-tertiary mb-1">Estimated annual liability</p>
                  <p
                    className="text-lg text-navy"
                    style={{ fontWeight: 500, letterSpacing: "-0.02em" }}
                  >
                    £18,420
                  </p>
                  <p className="text-xs text-green mt-2">
                    ✓ In scope · Registration required
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="section bg-navy">
        <div className="page-content text-center">
          <h2
            className="text-lg text-surface mb-4"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            Your first CBAM return is due 31 May 2028.
          </h2>
          <p
            className="text-base mb-10 max-w-[480px] mx-auto"
            style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}
          >
            The data from your 2027 shipments needs to be captured now, not in April 2028.
            Start a conversation with us today.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button href="/demo" variant="primary-inverse">
              Request a demo
            </Button>
            <Button href="/pricing" variant="ghost-inverse">
              See pricing
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
