import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";

// Static article content — extends as new articles are added.
const articles: Record<
  string,
  { title: string; category: string; date: string; body: React.ReactNode }
> = {
  "uk-vs-eu-cbam": {
    title: "UK CBAM vs EU CBAM: the key differences",
    category: "Comparison",
    date: "March 2026",
    body: (
      <>
        <p>
          The UK and EU Carbon Border Adjustment Mechanisms share a common intent — pricing
          the embedded carbon in imported goods — but they are different legal instruments
          with different scope, thresholds, payment mechanisms, and timelines. An importer
          selling into both markets must manage two separate compliance obligations.
        </p>

        <h2>Timeline</h2>
        <p>
          EU CBAM entered its definitive phase on 1 January 2026. Financial obligations
          apply from that date. The first annual declaration covering 2026 imports is due
          31 August 2027.
        </p>
        <p>
          UK CBAM begins on 1 January 2027 — with no transitional period. Financial
          obligations apply immediately. The first annual return covers calendar year 2027
          and is due 31 May 2028.
        </p>

        <h2>Threshold</h2>
        <p>
          The EU threshold is 50 tonnes of net mass per year across all covered goods.
          Approximately 90% of importers fall below this threshold.
        </p>
        <p>
          The UK threshold is £50,000 of CBAM goods in a rolling 12-month window, tested
          on the first of each month. Two tests apply: have you exceeded £50,000 in the
          past 12 months, or do you expect to in the next 30 days?
        </p>

        <h2>Scope</h2>
        <p>
          Both regimes cover iron and steel, aluminium, cement, fertilisers, and hydrogen.
          EU CBAM also covers electricity imports — UK CBAM does not. Most UK electricity
          imports arrive from the EU or Norway, which already operate equivalent ETS schemes.
        </p>

        <h2>Indirect emissions</h2>
        <p>
          EU CBAM requires indirect emissions (from electricity used in manufacturing) to
          be reported for cement and fertilisers from 2026. UK CBAM defers indirect
          emissions to 2029 at the earliest — meaning UK liability will be materially lower
          than EU liability for the same aluminium or hydrogen imports during the initial
          years.
        </p>

        <h2>Payment mechanism</h2>
        <p>
          EU CBAM operates through a certificate purchase and surrender mechanism. Importers
          must buy EU CBAM certificates at the weekly average EU ETS auction price and
          surrender them annually.
        </p>
        <p>
          UK CBAM operates as a self-assessed tax return submitted to HMRC — similar in
          structure to VAT. There are no certificates to purchase. Liability is calculated
          and paid with the return.
        </p>
      </>
    ),
  },
  registration: {
    title: "When do I need to register for UK CBAM?",
    category: "Registration",
    date: "March 2026",
    body: (
      <>
        <p>
          UK CBAM registration is required when you exceed the £50,000 threshold —
          defined as £50,000 of covered CBAM goods in a rolling 12-month window.
        </p>

        <h2>The two threshold tests</h2>
        <p>
          HMRC applies two tests, run on the first of each month:
        </p>
        <p>
          <strong>Historic test:</strong> Have you imported £50,000 or more of CBAM goods
          in the past 12 months? If yes, you must register.
        </p>
        <p>
          <strong>Prospective test:</strong> Do you reasonably expect to import £50,000
          or more of CBAM goods in the next 30 days? If yes, you must register.
        </p>

        <h2>Registration deadline</h2>
        <p>
          Once a threshold test is met, you have 30 days to register with HMRC via
          Government Gateway. In Year 1 (2027), HMRC has confirmed that importers have
          until 31 January 2028 to register — regardless of when the threshold was first
          met during 2027.
        </p>

        <h2>What you will need</h2>
        <p>
          To register, you will need your EORI number, UK VAT registration number,
          business legal name and address, estimated annual import value of CBAM goods,
          and the estimated combined weight of CBAM goods.
        </p>

        <h2>Nil returns</h2>
        <p>
          Once registered, you must submit a return for every reporting period — even if
          your CBAM liability for that period is nil. There is no de-registration mechanism
          in the initial period.
        </p>
      </>
    ),
  },
};

// Generate all known slugs at build time
export function generateStaticParams() {
  return Object.keys(articles).map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const article = articles[params.slug];
  if (!article) return { title: "Not found" };
  return {
    title: article.title,
    description: `nucleos resources: ${article.title}`,
  };
}

export default function ResourceArticlePage({
  params,
}: {
  params: { slug: string };
}) {
  const article = articles[params.slug];
  if (!article) notFound();

  return (
    <>
      <Nav />

      {/* Breadcrumb */}
      <section
        className="bg-surface"
        style={{ borderBottom: "0.5px solid var(--color-border)" }}
      >
        <div className="page-content py-4">
          <p className="text-xs text-text-tertiary">
            <Link href="/resources" className="hover:text-text-secondary transition-colors">
              Resources
            </Link>
            {" / "}
            <span>{article.category}</span>
          </p>
        </div>
      </section>

      {/* Article */}
      <section className="section" style={{ backgroundColor: "var(--color-bg)" }}>
        <div className="page-content">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-16 items-start">
            <article>
              <div className="mb-10">
                <span
                  className="text-xs rounded-badge px-2 py-1 mb-4 inline-block"
                  style={{
                    fontWeight: 500,
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text-secondary)",
                    border: "0.5px solid var(--color-border)",
                  }}
                >
                  {article.category}
                </span>
                <h1
                  className="text-lg text-text-primary mt-4 mb-3"
                  style={{ fontWeight: 500, letterSpacing: "-0.01em" }}
                >
                  {article.title}
                </h1>
                <p className="text-xs text-text-tertiary">{article.date}</p>
              </div>

              {/* Article prose */}
              <div
                className="flex flex-col gap-5"
                style={{ color: "var(--color-text-secondary)", lineHeight: 1.8, fontSize: "var(--text-sm)" }}
              >
                <style>{`
                  article h2 {
                    font-size: var(--text-base);
                    font-weight: 500;
                    color: var(--color-text-primary);
                    letter-spacing: -0.01em;
                    margin-top: 32px;
                    margin-bottom: 0;
                  }
                `}</style>
                {article.body}
              </div>
            </article>

            {/* Sidebar */}
            <div className="flex flex-col gap-6 sticky top-24">
              <div
                className="bg-surface rounded-card p-6"
                style={{ border: "0.5px solid var(--color-border)" }}
              >
                <p className="text-xs text-text-tertiary mb-4" style={{ letterSpacing: "0.08em" }}>
                  FREE TOOL
                </p>
                <p className="text-sm text-text-primary mb-3" style={{ fontWeight: 500 }}>
                  Check your CN code
                </p>
                <p className="text-xs text-text-secondary mb-4" style={{ lineHeight: 1.6 }}>
                  Find out if your goods are in scope and estimate your liability.
                </p>
                <Button href="/scope-checker" variant="primary" size="sm">
                  Check now
                </Button>
              </div>

              <div
                className="bg-surface rounded-card p-6"
                style={{ border: "0.5px solid var(--color-border)" }}
              >
                <p className="text-xs text-text-tertiary mb-4" style={{ letterSpacing: "0.08em" }}>
                  MORE GUIDES
                </p>
                <ul className="flex flex-col gap-3">
                  {Object.entries(articles)
                    .filter(([slug]) => slug !== params.slug)
                    .slice(0, 4)
                    .map(([slug, a]) => (
                      <li key={slug}>
                        <Link
                          href={`/resources/${slug}`}
                          className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                          style={{ lineHeight: 1.5 }}
                        >
                          {a.title}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
