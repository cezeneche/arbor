import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Pricing: nucleos CBAM compliance software",
  description:
    "nucleos pricing for UK and EU CBAM compliance. Start with the free scope checker. Move to a full plan when you need extraction, calculation, and return generation.",
};

const tiers = [
  {
    name: "Starter",
    price: "£799",
    period: "per year",
    description: "For importers with straightforward CBAM obligations and a single CN code family.",
    features: [
      "Up to 50 CBAM goods lines per return period",
      "Document extraction for 2 document types",
      "UK CBAM annual return generation",
      "Default value fallback with Annex VI data",
      "Conflict arbitration",
      "Audit package with 6-year retention",
      "Email support",
    ],
    cta: "Get started",
    href: "/demo",
    highlight: false,
  },
  {
    name: "Professional",
    price: "£2,499",
    period: "per year",
    description: "For importers with multiple sectors, suppliers, and both UK and EU obligations.",
    features: [
      "Unlimited CBAM goods lines",
      "All document types (mill certificates, invoices, customs declarations, supplier reports)",
      "UK and EU CBAM returns",
      "Carbon Price Relief calculation",
      "Supplier outreach templates",
      "Quarterly threshold monitoring",
      "Narrative compliance summary (for auditors)",
      "Priority support with named account manager",
    ],
    cta: "Request a demo",
    href: "/demo",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    description: "For importers with complex multi-entity, multi-jurisdiction, or high-volume needs.",
    features: [
      "Everything in Professional",
      "Multi-entity and multi-subsidiary support",
      "API access for system integration",
      "Custom verification workflows",
      "Dedicated implementation support",
      "SLA with guaranteed response times",
      "On-site or virtual training",
    ],
    cta: "Contact us",
    href: "/demo",
    highlight: false,
  },
];

const faqs = [
  {
    q: "How is nucleos priced relative to my CBAM liability?",
    a: "For a Professional subscriber with a £200,000 annual CBAM liability, the subscription is 1.25% of the liability. By claiming actual data instead of defaults, you typically save 10% of the default liability, many times the cost of the subscription.",
  },
  {
    q: "Do I need a subscription to use the scope checker?",
    a: "No. The scope checker is free and requires no account. It will tell you whether your CN code is in scope, whether you exceed the registration threshold, and your estimated liability based on default Annex VI values.",
  },
  {
    q: "Can my accountant or tax agent access nucleos on my behalf?",
    a: "Yes. All tiers support invited users. Professional and Enterprise tiers include tax agent access with separate login and permission controls.",
  },
  {
    q: "Does nucleos handle both the first annual return and quarterly returns from 2028?",
    a: "Yes. The return builder generates both the 2027 annual return (due 31 May 2028) and the quarterly returns due from 2028 onwards. The format and data requirements differ; nucleos handles both.",
  },
  {
    q: "What if I only import from one country with its own carbon pricing scheme?",
    a: "nucleos calculates your Carbon Price Relief deduction automatically. For imports from countries with a qualifying ETS or carbon tax, the CPR can reduce your CBAM liability to near zero, but the calculation and documentation must still be correct and defensible.",
  },
  {
    q: "Is there a contract or can I cancel?",
    a: "Annual subscriptions are annual. There is no monthly option for the current period. We do not offer refunds for unused periods, but we do offer a 14-day trial on Professional with a real document run before you commit.",
  },
];

export default function PricingPage() {
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
            PRICING
          </p>
          <h1
            className="text-lg text-text-primary mb-3"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            Straightforward pricing.
          </h1>
          <p className="text-sm text-text-secondary max-w-[480px]" style={{ lineHeight: 1.7 }}>
            Start with the free scope checker. Move to a full plan when you need
            extraction, calculation, and return generation.
          </p>
        </div>
      </section>

      {/* Tiers */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tiers.map((t) => (
              <div
                key={t.name}
                className="rounded-card p-8 flex flex-col"
                style={{
                  backgroundColor: t.highlight ? "var(--color-navy)" : "var(--color-surface)",
                  border: t.highlight
                    ? "0.5px solid rgba(255,255,255,0.15)"
                    : "0.5px solid var(--color-border)",
                  boxShadow: t.highlight ? "none" : "var(--card-shadow)",
                }}
              >
                <div className="mb-8">
                  <p
                    className="text-xs mb-4"
                    style={{
                      letterSpacing: "0.1em",
                      color: t.highlight
                        ? "rgba(255,255,255,0.5)"
                        : "var(--color-text-tertiary)",
                    }}
                  >
                    {t.name.toUpperCase()}
                  </p>
                  <p
                    className="text-lg mb-1"
                    style={{
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      color: t.highlight ? "var(--color-surface)" : "var(--color-text-primary)",
                    }}
                  >
                    {t.price}
                  </p>
                  <p
                    className="text-xs mb-6"
                    style={{
                      color: t.highlight
                        ? "rgba(255,255,255,0.5)"
                        : "var(--color-text-tertiary)",
                    }}
                  >
                    {t.period}
                  </p>
                  <p
                    className="text-sm"
                    style={{
                      lineHeight: 1.7,
                      color: t.highlight
                        ? "rgba(255,255,255,0.7)"
                        : "var(--color-text-secondary)",
                    }}
                  >
                    {t.description}
                  </p>
                </div>

                <ul className="flex flex-col gap-3 mb-10 flex-1">
                  {t.features.map((f) => (
                    <li
                      key={f}
                      className="flex gap-3 text-sm"
                      style={{
                        color: t.highlight
                          ? "rgba(255,255,255,0.8)"
                          : "var(--color-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <span
                        className="shrink-0 mt-0.5"
                        style={{
                          color: t.highlight
                            ? "rgba(255,255,255,0.5)"
                            : "var(--color-text-tertiary)",
                        }}
                      >
                        ✓
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  href={t.href}
                  variant={t.highlight ? "primary-inverse" : "primary"}
                >
                  {t.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="section bg-surface">
        <div className="page-content">
          <div className="mb-12">
            <p
              className="text-xs text-text-tertiary mb-4"
              style={{ letterSpacing: "0.1em" }}
            >
              FREQUENTLY ASKED
            </p>
            <h2
              className="text-lg text-text-primary"
              style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
            >
              Questions about pricing and what&apos;s included.
            </h2>
          </div>

          <div
            className="flex flex-col"
            style={{ borderTop: "0.5px solid var(--color-border)" }}
          >
            {faqs.map((f) => (
              <div
                key={f.q}
                className="grid grid-cols-1 md:grid-cols-2 gap-8 py-8"
                style={{ borderBottom: "0.5px solid var(--color-border)" }}
              >
                <p
                  className="text-base text-text-primary"
                  style={{ fontWeight: 500 }}
                >
                  {f.q}
                </p>
                <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                  {f.a}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col sm:flex-row gap-4">
            <Button href="/demo" variant="primary">
              Talk to us
            </Button>
            <Button href="/scope-checker" variant="ghost">
              Try the free scope checker
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
