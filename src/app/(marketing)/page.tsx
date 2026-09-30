import type { Metadata } from 'next'
import Link from 'next/link'
import { RecordExample } from '@/components/marketing/RecordExample'
import { pilotRequestHref } from '@/lib/marketing/pilot'

export const metadata: Metadata = {
  title: 'Arbor | Operational records you can reuse',
  description: 'Turn supported operational documents into evidence-labelled records. Review the figures, keep their sources in view, and share current records with authorised customers.',
}

const workflow = [
  { number: '01', title: 'Bring your documents together', body: 'Upload supported bills, invoices, production logs and other operational documents.' },
  { number: '02', title: 'Extract and review figures', body: 'Arbor structures the fields and flags review needs. Some eligible documents create Declared records automatically; others require review first.' },
  { number: '03', title: 'Keep a usable record', body: 'Each stored figure has an evidence-quality label. Available source information and later corrections stay connected to its history.' },
  { number: '04', title: 'Share with permission', body: 'Give customers access to the current records they need. Their view includes the evidence quality Arbor can provide.' },
]

const tiers = [
  { name: 'Verified', className: 'verified', body: 'Document-derived data that meets the applicable source and review requirements. This is not independent assurance of the underlying business activity.' },
  { name: 'Declared', className: 'declared', body: 'Self-reported, imported, or document-derived data that has not met Verified requirements. It can still have a source document.' },
  { name: 'Estimated', className: 'estimated', body: 'A cited reference value used in place of measured activity. It is labelled so it is not mistaken for an observed figure.' },
]

const domains = [
  { name: 'Energy', examples: 'Electricity and fuel statements' },
  { name: 'Materials', examples: 'Purchased inputs and feedstocks' },
  { name: 'Production', examples: 'Output and batch logs' },
  { name: 'Logistics', examples: 'Freight and delivery records' },
  { name: 'Emissions', examples: 'Measured and estimated figures' },
  { name: 'Agriculture', examples: 'Land and crop records' },
  { name: 'Waste and water', examples: 'Usage and disposal records' },
  { name: 'Compliance', examples: 'Permits and test results' },
]

export default function HomePage() {
  return (
    <>
      <section className="mk-hero">
        <div className="mk-container mk-hero-grid">
          <div className="mk-hero-copy">
            <span className="mk-eyebrow mk-eyebrow-light">For manufacturers, suppliers and producers</span>
            <h1>Operational data, ready to reuse.</h1>
            <p>Upload supported documents. Arbor extracts key figures, shows their evidence and review status, and helps you share current records with authorised customers.</p>
            <div className="mk-actions">
              <a className="mk-button mk-button-light" href={pilotRequestHref('supplier')}>Request pilot access</a>
              <Link className="mk-button mk-button-outline-light" href="/how-it-works">See how it works</Link>
            </div>
            <span className="mk-hero-note">Private pilot · Access by invitation</span>
          </div>
          <RecordExample />
        </div>
      </section>

      <section className="mk-benefit-band" aria-label="What Arbor helps you do">
        <div className="mk-container mk-benefit-grid">
          <div><strong>Reuse figures</strong><span>Answer another request without starting from the document search.</span></div>
          <div><strong>See the evidence</strong><span>Keep available source information and review status beside each record.</span></div>
          <div><strong>Track corrections</strong><span>See how a stored figure changed over time.</span></div>
          <div><strong>Choose access</strong><span>Share authorised records with the customers who need them.</span></div>
        </div>
      </section>

      <section className="mk-section mk-section-warm">
        <div className="mk-container mk-editorial-grid">
          <div>
            <span className="mk-eyebrow">The problem</span>
            <h2>The next request should not start from zero.</h2>
          </div>
          <div className="mk-editorial-copy">
            <p>A customer asks for last quarter’s electricity use. Your team finds the bill, copies the figure into a questionnaire and sends it. Months later, another customer asks for the same period in a different format.</p>
            <p>Arbor keeps the figure, its label and available evidence together, so the next response can start with a record your team can inspect and correct.</p>
          </div>
        </div>
      </section>

      <section className="mk-section" id="workflow">
        <div className="mk-container">
          <div className="mk-section-head">
            <span className="mk-eyebrow">How it works</span>
            <h2>From document to a record you can use again.</h2>
            <p>The workflow keeps extraction, review and sharing distinct, so the evidence quality stays visible.</p>
          </div>
          <div className="mk-workflow-grid">
            {workflow.map(step => (
              <article className="mk-workflow-step" key={step.number}>
                <span className="mk-workflow-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
          <Link className="mk-text-link" href="/how-it-works">Explore the full workflow <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="mk-section mk-section-sage">
        <div className="mk-container">
          <div className="mk-section-head">
            <span className="mk-eyebrow">Evidence quality</span>
            <h2>A label that tells you what sits behind the figure.</h2>
            <p>Arbor’s tiers describe evidence and review status. They do not certify that a supplier’s underlying activity happened exactly as stated.</p>
          </div>
          <div className="mk-tier-grid">
            {tiers.map(tier => (
              <article className="mk-tier-card" key={tier.name}>
                <span className={`mk-tier-pill mk-tier-${tier.className}`}>{tier.name}</span>
                <p>{tier.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-container">
          <div className="mk-section-head"><span className="mk-eyebrow">Two sides of the exchange</span><h2>Useful for the team sending data and the team requesting it.</h2></div>
          <div className="mk-audience-grid">
            <article className="mk-audience-card">
              <span className="mk-eyebrow">For suppliers</span>
              <h3>Keep answers close to their source.</h3>
              <p>Organise operational figures from documents you already hold. Review exceptions, track corrections and share authorised records when a customer asks.</p>
              <a className="mk-text-link" href={pilotRequestHref('supplier')}>Request supplier pilot access <span aria-hidden="true">→</span></a>
            </article>
            <article className="mk-audience-card mk-audience-card-dark">
              <span className="mk-eyebrow mk-eyebrow-light">For buyers</span>
              <h3>Ask for data you can assess.</h3>
              <p>Request structured information from participating suppliers and review the evidence quality of records they choose to share with you.</p>
              <a className="mk-text-link" href={pilotRequestHref('buyer')}>Request buyer pilot access <span aria-hidden="true">→</span></a>
            </article>
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-warm">
        <div className="mk-container">
          <div className="mk-section-head"><span className="mk-eyebrow">Operational domains</span><h2>Make different kinds of operational data easier to find.</h2><p>Records are grouped into eight domains. The examples show the kinds of material the categories can organise; support for a specific field depends on its document and workflow.</p></div>
          <div className="mk-domain-grid">
            {domains.map(domain => <div className="mk-domain-row" key={domain.name}><strong>{domain.name}</strong><span>{domain.examples}</span></div>)}
          </div>
        </div>
      </section>

      <section className="mk-close">
        <div className="mk-container mk-close-inner">
          <div><span className="mk-eyebrow mk-eyebrow-light">Private pilot</span><h2>Bring your next data request into a clearer workflow.</h2><p>Tell us what documents and customer requests you handle. Pilot access is by invitation.</p></div>
          <a className="mk-button mk-button-light" href={pilotRequestHref()}>Request pilot access</a>
        </div>
      </section>
    </>
  )
}
