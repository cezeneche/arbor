import type { Metadata } from 'next'
import Link from 'next/link'
import { pilotRequestHref } from '@/lib/marketing/pilot'

export const metadata: Metadata = {
  title: 'CBAM returns for importers | Arbor',
  description:
    'Prepare UK and EU CBAM figures from your customs declarations and supplier data, with every figure traceable to its source. Arbor prepares; you submit.',
}

const request = pilotRequestHref('importer')

const dates = [
  { name: '1 January 2027', detail: 'UK CBAM charges begin on covered goods imported from this date.' },
  { name: '31 January 2028', detail: 'Last date to register with HMRC for the first year.' },
  { name: '31 May 2028', detail: 'The first UK return and payment are due, covering all of 2027.' },
  { name: 'From 2028', detail: 'UK returns move to a quarterly cycle.' },
]

const steps = [
  {
    number: '01',
    title: 'Upload your customs declarations',
    body: 'Arbor reads each goods line — commodity code, net mass, country of origin and installation — and shows the text it read each figure from.',
    detail: 'You confirm the figures before a case is opened. A six-digit code or a missing field is flagged, not guessed.',
  },
  {
    number: '02',
    title: 'Collect emissions from your suppliers',
    body: 'Send a supplier a secure form for the emissions figure a goods line needs. They fill it in without creating an account.',
    detail: 'Where no supplier figure is available, the published default value can be applied, and the case shows which method each line uses.',
  },
  {
    number: '03',
    title: 'Back the figures with evidence',
    body: 'Attach an accredited verifier’s statement to a supplier’s figure, and claim relief for carbon price already paid in the country of origin under a recognised scheme.',
    detail: 'Relief only counts once the verifier’s statement for the claim is attached, and it is capped at the CBAM charge on those goods.',
  },
  {
    number: '04',
    title: 'Prepare the return',
    body: 'Arbor prepares the UK return, by consignment and goods line, as a document and a data file, and an EU declaration in XML for your declarant.',
    detail: 'Arbor does not submit to HMRC or the EU registry. You, or your agent, review and submit.',
  },
]

const evidence = [
  { name: 'Why this number?', body: 'Open any weight or emissions figure to see the words on the document it was read from, and whether a person corrected it.' },
  { name: 'Supplier history', body: 'A supplier’s figure is compared with the same installation’s earlier figures for the same goods, and flagged when it is far out of line.' },
  { name: 'Audit narrative', body: 'A written account of how the case’s figures were reached, checked against the figures themselves. When they disagree, it is flagged for review.' },
]

const goods = [
  { name: 'Iron and steel', examples: 'UK and EU' },
  { name: 'Aluminium', examples: 'UK and EU' },
  { name: 'Cement', examples: 'UK and EU' },
  { name: 'Fertilisers', examples: 'UK and EU' },
  { name: 'Hydrogen', examples: 'UK and EU' },
  { name: 'Electricity', examples: 'EU only' },
]

export default function CbamCompliancePage() {
  return (
    <>
      <section className="mk-page-intro">
        <div className="mk-container">
          <span className="mk-eyebrow">For importers</span>
          <h1>Your CBAM return, from the documents you already have.</h1>
          <p>
            UK CBAM charges begin on 1 January 2027, and the first return is due on 31 May 2028. Arbor turns your
            customs declarations and supplier emissions data into the figures your UK and EU returns need, with every
            figure traceable to where it came from.
          </p>
          <div className="mk-actions">
            <a className="mk-button mk-button-navy" href={request}>Request pilot access</a>
            <Link className="mk-text-link" href="#how">See how it works <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-warm">
        <div className="mk-container mk-editorial-grid">
          <div>
            <span className="mk-eyebrow">The deadline</span>
            <h2>The UK return has a date and a price on it.</h2>
          </div>
          <div className="mk-editorial-copy">
            <p>
              Importers of iron and steel, aluminium, cement, fertilisers and hydrogen above HMRC’s registration
              threshold pay a charge on the carbon embedded in those goods. The figures come from customs entries you hold and from suppliers who may not
              have them ready.
            </p>
            <div className="mk-domain-grid">
              {dates.map(d => (
                <div className="mk-domain-row" key={d.name}>
                  <strong>{d.name}</strong>
                  <span>{d.detail}</span>
                </div>
              ))}
            </div>
            <p className="mk-step-note">
              Dates from HMRC’s published guidance. EU importers of more than 50 tonnes a year need authorised
              declarant status and make an annual declaration; check the European Commission’s guidance for current
              EU deadlines.
            </p>
          </div>
        </div>
      </section>

      <section className="mk-section" id="how">
        <div className="mk-container">
          <div className="mk-section-head">
            <span className="mk-eyebrow">How it works</span>
            <h2>From customs entry to a return you can stand behind.</h2>
          </div>
          <div className="mk-detailed-steps">
            {steps.map(step => (
              <article className="mk-detailed-step" key={step.number}>
                <span className="mk-detailed-number">{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <p className="mk-step-note">{step.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-sage">
        <div className="mk-container">
          <div className="mk-section-head">
            <span className="mk-eyebrow">Evidence</span>
            <h2>Every figure can answer for itself.</h2>
            <p>When HMRC, an auditor or your own finance team asks where a number came from, the answer is in the case.</p>
          </div>
          <div className="mk-tier-grid">
            {evidence.map(item => (
              <article className="mk-tier-card" key={item.name}>
                <h3>{item.name}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-warm">
        <div className="mk-container">
          <div className="mk-section-head">
            <span className="mk-eyebrow">Covered goods</span>
            <h2>The UK and EU cover the same five sectors; the EU adds electricity.</h2>
            <p>Arbor calculates each regime under its own rules. The UK charges direct emissions only; an importer into both gets a separate calculation for each.</p>
          </div>
          <div className="mk-domain-grid">
            {goods.map(g => (
              <div className="mk-domain-row" key={g.name}>
                <strong>{g.name}</strong>
                <span>{g.examples}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-close">
        <div className="mk-container mk-close-inner">
          <div>
            <span className="mk-eyebrow mk-eyebrow-light">Private pilot</span>
            <h2>Start with this year’s imports.</h2>
            <p>Tell us what you import, where from, and whether you file in the UK, the EU or both.</p>
          </div>
          <a className="mk-button mk-button-light" href={request}>Request pilot access</a>
        </div>
      </section>
    </>
  )
}
