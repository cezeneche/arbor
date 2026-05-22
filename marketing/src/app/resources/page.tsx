import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "CBAM resources — guides for UK and EU importers",
  description:
    "Practical CBAM guides for UK and EU importers: registration deadlines, sector rules, default values, Carbon Price Relief, and the difference between UK and EU CBAM.",
};

const articles = [
  {
    slug: "uk-vs-eu-cbam",
    category: "Comparison",
    title: "UK CBAM vs EU CBAM: the key differences",
    summary:
      "The two regimes share a common intent but differ on scope, thresholds, indirect emissions, payment mechanism, and timing. If you import into both markets, you are running two separate compliance obligations.",
    date: "March 2026",
    readTime: "8 min read",
  },
  {
    slug: "registration",
    category: "Registration",
    title: "When do I need to register for UK CBAM?",
    summary:
      "The UK CBAM registration threshold is £50,000 of covered goods in a rolling 12-month window, tested on the first of each month. Miss it and you are late — with a penalty clock running from the day you should have registered.",
    date: "March 2026",
    readTime: "5 min read",
  },
  {
    slug: "default-values",
    category: "Calculation",
    title: "Understanding Annex VI default values and the 10% surcharge",
    summary:
      "When supplier emissions data is unavailable, CBAM regulations specify default SEE values from Annex VI of EU Regulation 2023/1773. Using these values attracts a 10% loading — and that loading compounds annually as the CBAM rate rises.",
    date: "February 2026",
    readTime: "6 min read",
  },
  {
    slug: "carbon-price-relief",
    category: "Calculation",
    title: "Carbon Price Relief: how to claim the deduction",
    summary:
      "If your goods were produced in a country with a qualifying carbon pricing scheme, you can deduct the carbon price already paid from your CBAM liability. The CPR calculation requires GACI-accredited verification — but can reduce liability to near zero.",
    date: "February 2026",
    readTime: "7 min read",
  },
  {
    slug: "sectors",
    category: "Sectors",
    title: "CBAM by sector: iron & steel, aluminium, cement, fertilisers, hydrogen",
    summary:
      "Each CBAM sector has different production routes, different emissions intensities, and different calculation rules. This guide covers what you need to know for each sector — and where the data collection challenge is hardest.",
    date: "January 2026",
    readTime: "12 min read",
  },
  {
    slug: "supplier-data",
    category: "Data collection",
    title: "Getting emissions data from your suppliers",
    summary:
      "Most suppliers will not have pre-prepared CBAM emissions reports. Here is what to ask for, in what format, and what to do when they cannot or will not provide it.",
    date: "January 2026",
    readTime: "9 min read",
  },
  {
    slug: "audit-trail",
    category: "Records",
    title: "What does a defensible CBAM audit trail look like?",
    summary:
      "CBAM records must be retained for six years and be defensible under HMRC enquiry. This guide describes what HMRC expects — and what a spreadsheet cannot provide.",
    date: "December 2025",
    readTime: "6 min read",
  },
  {
    slug: "free-allocation",
    category: "Calculation",
    title: "How the free allocation adjustment affects your CBAM rate",
    summary:
      "The CBAM rate is not simply the UK ETS price. It is the ETS price adjusted for the sector-specific free allocation that domestic producers receive. As free allocations phase out, the CBAM rate rises — and this happens on a published schedule.",
    date: "December 2025",
    readTime: "5 min read",
  },
];

const categories = ["All", "Comparison", "Registration", "Calculation", "Sectors", "Data collection", "Records"];

export default function ResourcesPage() {
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
            RESOURCES
          </p>
          <h1
            className="text-lg text-text-primary mb-3"
            style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            CBAM guides for UK importers.
          </h1>
          <p className="text-sm text-text-secondary max-w-[520px]" style={{ lineHeight: 1.7 }}>
            Plain-language guides to every aspect of CBAM compliance. No marketing.
            No jargon. Just what you need to know, referenced to the regulations.
          </p>
        </div>
      </section>

      {/* Category filter — static labels, no JS filtering for SSR */}
      <section
        className="bg-surface"
        style={{ borderBottom: "0.5px solid var(--color-border)" }}
      >
        <div className="page-content py-4 flex gap-6 overflow-x-auto">
          {categories.map((c, i) => (
            <span
              key={c}
              className="text-sm whitespace-nowrap cursor-default"
              style={{
                color: i === 0 ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                fontWeight: i === 0 ? 500 : 300,
                paddingBottom: "4px",
                borderBottom: i === 0 ? "1px solid var(--color-text-primary)" : "none",
              }}
            >
              {c}
            </span>
          ))}
        </div>
      </section>

      {/* Articles */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div
            className="flex flex-col"
            style={{ borderTop: "0.5px solid var(--color-border)" }}
          >
            {articles.map((a) => (
              <Link
                key={a.slug}
                href={`/resources/${a.slug}`}
                className="group grid grid-cols-1 md:grid-cols-[1fr_200px] gap-6 py-8 hover:bg-surface transition-colors"
                style={{ borderBottom: "0.5px solid var(--color-border)", borderRadius: "var(--card-radius)" }}
              >
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className="text-xs rounded-badge px-2 py-1"
                      style={{
                        fontWeight: 500,
                        backgroundColor: "var(--color-surface)",
                        color: "var(--color-text-secondary)",
                        border: "0.5px solid var(--color-border)",
                      }}
                    >
                      {a.category}
                    </span>
                  </div>
                  <h2
                    className="text-base text-text-primary mb-2 group-hover:text-navy transition-colors"
                    style={{ fontWeight: 500 }}
                  >
                    {a.title}
                  </h2>
                  <p className="text-sm text-text-secondary" style={{ lineHeight: 1.7 }}>
                    {a.summary}
                  </p>
                </div>
                <div className="flex flex-col md:items-end gap-1">
                  <p className="text-xs text-text-tertiary">{a.date}</p>
                  <p className="text-xs text-text-tertiary">{a.readTime}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter / CTA */}
      <section className="section bg-surface">
        <div className="page-content">
          <div
            className="rounded-card p-12"
            style={{ backgroundColor: "var(--color-bg)", border: "0.5px solid var(--color-border)" }}
          >
            <div className="max-w-[480px]">
              <p
                className="text-xs text-text-tertiary mb-4"
                style={{ letterSpacing: "0.1em" }}
              >
                STAY CURRENT
              </p>
              <h2
                className="text-lg text-text-primary mb-3"
                style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
              >
                CBAM rates, deadlines, and regulation changes.
              </h2>
              <p className="text-sm text-text-secondary mb-6" style={{ lineHeight: 1.7 }}>
                HMRC publishes CBAM rates quarterly. Scope changes are proposed months
                before they take effect. We track all of it and send one email when
                something changes that affects your compliance.
              </p>
              <form className="flex gap-3">
                <input
                  type="email"
                  placeholder="your@email.com"
                  className="flex-1 rounded-input text-text-primary text-base bg-surface"
                  style={{
                    height: "var(--input-height)",
                    border: "0.5px solid var(--color-border)",
                    paddingLeft: "var(--space-16)",
                    paddingRight: "var(--space-16)",
                    fontWeight: "var(--font-body)",
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  className="rounded-btn text-sm text-surface bg-navy hover:bg-navy-hover transition-colors px-6"
                  style={{ height: "var(--btn-height)", fontWeight: 300 }}
                >
                  Subscribe
                </button>
              </form>
              <p className="text-xs text-text-tertiary mt-3">
                No marketing. Unsubscribe any time.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
