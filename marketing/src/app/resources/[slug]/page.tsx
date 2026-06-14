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
          The UK and EU Carbon Border Adjustment Mechanisms share a common intent: pricing
          the embedded carbon in imported goods. But they are different legal instruments
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
          UK CBAM begins on 1 January 2027, with no transitional period. Financial
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
          EU CBAM also covers electricity imports; UK CBAM does not. Most UK electricity
          imports arrive from the EU or Norway, which already operate equivalent ETS schemes.
        </p>

        <h2>Indirect emissions</h2>
        <p>
          EU CBAM requires indirect emissions (from electricity used in manufacturing) to
          be reported for cement and fertilisers from 2026. UK CBAM defers indirect
          emissions to 2029 at the earliest, meaning UK liability will be materially lower
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
          UK CBAM operates as a self-assessed tax return submitted to HMRC, similar in
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
          UK CBAM registration is required when you exceed the £50,000 threshold,
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
          until 31 January 2028 to register, regardless of when the threshold was first
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
          Once registered, you must submit a return for every reporting period, even if
          your CBAM liability for that period is nil. There is no de-registration mechanism
          in the initial period.
        </p>
      </>
    ),
  },
  "default-values": {
    title: "Understanding Annex VI default values and the 10% surcharge",
    category: "Calculation",
    date: "February 2026",
    body: (
      <>
        <p>
          When a supplier cannot or will not provide verified emissions data, CBAM
          regulations require importers to use published default values. These values are
          drawn from Annex VI of EU Commission Implementing Regulation 2023/1773 and
          represent world-average emissions intensities for each CN code and production
          route.
        </p>

        <h2>What the default values represent</h2>
        <p>
          Annex VI defaults are set conservatively. They are calculated from global average
          production data and are intended to be higher than the actual emissions of most
          individual installations. The deliberate overestimate creates an incentive for
          importers to pursue actual verified data.
        </p>
        <p>
          Defaults are differentiated by CN code and, where relevant, by production route.
          A blast furnace steel product has a different default than an electric arc furnace
          product, even if both share the same 8-digit CN code.
        </p>

        <h2>The 10% surcharge</h2>
        <p>
          Using a default value attracts a loading on top of the base default figure. For
          2026 declarations, that loading is 10%. It rises to 20% in 2027 and 30% from 2028
          onwards. The loading applies to the default emissions figure, not to your total
          liability, but the compounding effect is significant.
        </p>
        <p>
          For a company with £200,000 of CBAM liability calculated on default values, the
          10% surcharge adds £20,000. In 2028, that same position would cost £60,000 more
          than an equivalent position with verified actual data.
        </p>

        <h2>When defaults apply</h2>
        <p>
          Defaults apply when no verified supplier data is available. If a supplier
          provides data but it is not verified by an accredited third party, you cannot use
          it as Tier 1 actual data. You must either use the default or obtain verification.
        </p>

        <h2>Updating from defaults to actual data</h2>
        <p>
          If you start with defaults and later obtain verified actual data for the same
          goods, you can amend your declaration. The liability recalculates using the actual
          figure, without the loading. The amendment must be within the statutory amendment
          window.
        </p>
      </>
    ),
  },
  "carbon-price-relief": {
    title: "Carbon Price Relief: how to claim the deduction",
    category: "Calculation",
    date: "February 2026",
    body: (
      <>
        <p>
          Carbon Price Relief (CPR) allows importers to deduct the carbon price already
          paid in the country of origin from their UK CBAM liability. If your goods were
          produced in a country with a qualifying carbon pricing scheme and the producer
          paid a carbon price, that cost can be offset against what you owe HMRC.
        </p>

        <h2>What qualifies for CPR</h2>
        <p>
          A qualifying carbon pricing scheme must be mandatory by law, apply to the
          relevant installation, and have a published carbon price. Voluntary schemes, offset
          programmes, and internal carbon prices do not qualify.
        </p>
        <p>
          The EU ETS is an example of a qualifying scheme. However, UK-EU ETS linking has
          not yet been finalised. Until confirmed, EU-origin goods cannot automatically
          claim CPR against the UK ETS price paid in the EU.
        </p>

        <h2>The CPR formula</h2>
        <p>
          The effective carbon price is calculated as the carbon price paid per tonne of
          CO2e, minus any free allocations received, minus any rebates or refunds. This net
          figure is then multiplied by the verified embedded emissions and converted to GBP
          at the exchange rate on the date of import.
        </p>
        <p>
          The CPR deduction cannot reduce your CBAM liability below zero. If the carbon
          price paid in the origin country exceeds the UK CBAM rate, your net liability is
          nil but there is no refund of the excess.
        </p>

        <h2>Verification requirement</h2>
        <p>
          CPR claims require GACI-accredited verification. The verifier must confirm the
          carbon price actually paid, the free allocations received, and the embedded
          emissions used in the calculation. This is a separate verification exercise from
          the emissions data verification.
        </p>

        <h2>Documentation</h2>
        <p>
          You must retain evidence of the carbon price paid, the relevant free allocation
          data, verification reports, exchange rate documentation, and the CPR calculation.
          HMRC may request this documentation during an enquiry. Records must be kept for
          six years.
        </p>
      </>
    ),
  },
  sectors: {
    title: "CBAM by sector: iron and steel, aluminium, cement, fertilisers, hydrogen",
    category: "Sectors",
    date: "January 2026",
    body: (
      <>
        <p>
          UK CBAM covers five sectors: iron and steel, aluminium, cement, fertilisers, and
          hydrogen. Each has different production routes, different emissions intensities,
          and different complexity for data collection. EU CBAM covers the same five sectors
          plus electricity imports.
        </p>

        <h2>Iron and steel</h2>
        <p>
          Steel is the most complex CBAM sector because emissions vary significantly by
          production route. Blast furnace and basic oxygen furnace (BF-BOF) production
          using iron ore and coking coal produces approximately 1.8 to 2.2 tCO2 per tonne.
          Electric arc furnace (EAF) production using scrap steel produces 0.3 to 0.6
          tCO2 per tonne in direct emissions.
        </p>
        <p>
          The production route must be identified for the calculation to be correct. Mill
          certificates typically state the production route, but conflicts between documents
          are common and must be resolved before submission.
        </p>

        <h2>Aluminium</h2>
        <p>
          Primary aluminium produced by electrolysis from bauxite is highly
          electricity-intensive, with emissions of 1.5 to 4.0 tCO2e per tonne depending on
          the electricity grid. Secondary aluminium from recycled scrap has much lower
          emissions: typically 0.2 to 0.5 tCO2 per tonne.
        </p>
        <p>
          Under EU CBAM, indirect emissions from electricity are captured for aluminium.
          Under UK CBAM, indirect emissions are deferred until 2029 at the earliest, so UK
          liability on aluminium imports will be materially lower than EU liability on the
          same goods during the initial years.
        </p>

        <h2>Cement</h2>
        <p>
          Cement production involves the calcination of limestone, a chemical reaction that
          releases approximately 0.5 tCO2 per tonne of clinker regardless of the energy
          source. This process emission cannot be eliminated through fuel switching alone.
          Blended cements with lower clinker content have lower emissions intensity, and the
          EU regulations allow differentiation by clinker content.
        </p>

        <h2>Fertilisers</h2>
        <p>
          Fertiliser production involves multiple greenhouse gases. Ammonia production via
          the Haber-Bosch process emits approximately 1.6 to 2.1 tCO2 per tonne. Nitric
          acid production generates nitrous oxide (N2O), which has a warming potential 298
          times that of CO2. Both gases are captured under CBAM for relevant products.
        </p>

        <h2>Hydrogen</h2>
        <p>
          Hydrogen's carbon intensity depends entirely on production method. Grey hydrogen
          from steam methane reforming without carbon capture emits 9 to 12 tCO2 per tonne.
          Blue hydrogen with carbon capture emits 2 to 4 tCO2 per tonne. Green hydrogen
          from renewable electrolysis emits near zero. The production route must be
          documented and verified.
        </p>
      </>
    ),
  },
  "supplier-data": {
    title: "Getting emissions data from your suppliers",
    category: "Data collection",
    date: "January 2026",
    body: (
      <>
        <p>
          CBAM requires emissions data from the installation that manufactured your goods.
          That means the importer must obtain this data from the overseas producer, not
          calculate it independently. For most importers, this is the hardest part of the
          compliance process.
        </p>

        <h2>What to ask for</h2>
        <p>
          You need the following from each producing installation: the installation name
          and address, the production route, the direct specific embedded emissions in
          tCO2e per tonne of product, and the reporting period to which the data applies.
          For EU CBAM cement and fertiliser obligations, you also need indirect embedded
          emissions from electricity.
        </p>
        <p>
          The EU Commission provides a standard supplier data request template. You can use
          this as the basis for your request. The data must relate to the specific
          installation, not a company-wide average.
        </p>

        <h2>When suppliers cannot provide data</h2>
        <p>
          The EU's own data from the transitional period shows that 89 to 92% of importers
          were using default values in the first year of reporting. Most suppliers outside
          the EU and UK have not yet built the systems to track and report installation-level
          emissions. This is expected and the regulations account for it through the default
          value mechanism.
        </p>
        <p>
          If a supplier says they cannot provide data, document the request and their
          response. This creates a record that you attempted to obtain actual data. Apply the
          default value and include the 10% loading in your calculation.
        </p>

        <h2>Partial data</h2>
        <p>
          If a supplier provides some data but it cannot be fully verified, it may be
          usable as Tier 2 estimated data. This still requires professional judgement about
          confidence and may require disclosure as estimated rather than verified.
        </p>

        <h2>Verification</h2>
        <p>
          Supplier data used as Tier 1 actual emissions must be verified by a body
          accredited to ISO 17029 and ISO 14065, with accreditation from a GACI full member.
          In the UK, UKAS is the primary accreditation body. Without verification, the data
          cannot be used as Tier 1 and defaults apply.
        </p>
      </>
    ),
  },
  "audit-trail": {
    title: "What does a defensible CBAM audit trail look like?",
    category: "Records",
    date: "December 2025",
    body: (
      <>
        <p>
          CBAM records must be retained for six years under UK CBAM and be available for
          HMRC inspection. A return that cannot be substantiated during an enquiry exposes
          the importer to penalties even if the original liability calculation was correct.
          The record is as important as the return.
        </p>

        <h2>What HMRC can ask for</h2>
        <p>
          In an HMRC CBAM enquiry, you may be asked to produce: the source documents used
          to determine embedded emissions, the calculation that produced each goods-line
          liability figure, evidence that the correct default or actual emissions value was
          applied, verification reports if actual data was claimed, Carbon Price Relief
          documentation if CPR was deducted, and a reconciliation between your customs
          declarations and your CBAM return.
        </p>

        <h2>What a spreadsheet cannot provide</h2>
        <p>
          A manually maintained spreadsheet has no immutable audit trail. A figure can be
          overwritten without any record of what it was before or who changed it. There is
          no version history, no timestamp on individual cells, and no cryptographic proof
          that the spreadsheet was not altered after the return was filed.
        </p>
        <p>
          HMRC does not prescribe the format of the audit trail, but the burden of proof is
          on the importer. A spreadsheet that cannot show where each number came from is a
          weak defence.
        </p>

        <h2>What a defensible audit trail requires</h2>
        <p>
          Each goods line in your return should trace to: the source document (invoice,
          mill certificate, or customs declaration), the specific extracted value and the
          confidence level assigned to it, any conflicts between documents and the resolution
          applied, the version of the default value table used if defaults were applied, and
          the CBAM rate applied for the relevant quarter.
        </p>
        <p>
          All of these records should be immutable once created. Amendments should be
          recorded as new entries, not overwrites. The complete set should be stored for six
          years and be retrievable on demand.
        </p>
      </>
    ),
  },
  "free-allocation": {
    title: "How the free allocation adjustment affects your CBAM rate",
    category: "Calculation",
    date: "December 2025",
    body: (
      <>
        <p>
          The UK CBAM rate is not equal to the UK ETS carbon price. It is the ETS price
          adjusted for the sector-specific free allocation that domestic producers receive.
          This distinction matters because it determines how much you actually owe, and it
          changes quarterly.
        </p>

        <h2>Why free allocations exist</h2>
        <p>
          Under the UK ETS, domestic manufacturers receive some allowances for free. These
          free allocations exist to protect energy-intensive industries from carbon costs
          while their competitors face no equivalent obligation. As CBAM equalises the
          playing field, the rationale for free allocations weakens, and they are being
          phased out over time.
        </p>

        <h2>The adjustment formula</h2>
        <p>
          The UK CBAM rate equals the UK ETS price multiplied by one minus the
          sector-specific free allocation factor. If the ETS price is £50 per tonne and the
          free allocation factor for steel is 0.30, the CBAM rate is £35 per tonne, not
          £50. The difference represents the value of the free allocations domestic
          producers still receive.
        </p>

        <h2>How the rate changes over time</h2>
        <p>
          As free allocations phase out, the free allocation factor decreases and the CBAM
          rate approaches the full ETS price. HMRC publishes the CBAM rate quarterly,
          incorporating both the current ETS price and the current sector-specific free
          allocation factor. Importers must use the rate published for the quarter in which
          the goods were imported.
        </p>

        <h2>Sector differences</h2>
        <p>
          Free allocation factors differ by sector because the phase-out schedule varies.
          Steel, aluminium, cement, fertilisers, and hydrogen each have distinct trajectories
          published by HMRC. Using the wrong sector factor produces an incorrect liability
          figure and is a compliance risk.
        </p>

        <h2>Where to find the current rate</h2>
        <p>
          HMRC publishes a trial CBAM rate from Q4 2026 and the live rate from Q1 2027
          onwards. The published rate for each quarter is the figure to use for goods
          imported in that quarter. Rates are published on HMRC's website and will be
          updated four times per year.
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
                  className="text-xs rounded-badge px-3 py-1.5 mb-4 inline-block"
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
