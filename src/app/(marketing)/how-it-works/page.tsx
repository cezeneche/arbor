import type { Metadata } from 'next'
import Link from 'next/link'
import { RecordExample } from '@/components/marketing/RecordExample'
import { pilotRequestHref } from '@/lib/marketing/pilot'

export const metadata: Metadata = {
  title: 'How Arbor works | From documents to reusable records',
  description: 'See how Arbor extracts operational figures, handles review, keeps evidence-quality labels visible and shares records with permission.',
}

const steps = [
  {
    number: '01', title: 'Upload a supported document',
    body: 'Choose the document type and upload a PDF, JPEG or PNG up to 50 MB. You can add a reporting period where it helps place the figures in context.',
    detail: 'Electricity bills, freight invoices and production logs are typical examples.',
  },
  {
    number: '02', title: 'Review what was extracted',
    body: 'Arbor identifies relevant fields, preserves available source text and flags extraction or document-quality concerns for review.',
    detail: 'Each field shows the text it was read from and how clearly it was read. Anything uncertain is flagged for you to check.',
  },
  {
    number: '03', title: 'Keep a labelled record',
    body: 'Eligible documents can create Declared records automatically. Other documents require review before a record is created. A record’s label follows the applicable evidence and review rules.',
    detail: 'When a figure is corrected, a new record supersedes the earlier one. The change history remains available within the account’s retention rules.',
  },
  {
    number: '04', title: 'Share what you choose',
    body: 'Authorised buyers can see records you grant access to, including the evidence-quality information Arbor holds. The same stored data can be queried or exported for another request.',
    detail: 'Labels travel with every record Arbor shares or exports.',
  },
]

const tiers = [
  { name: 'Verified', style: 'verified', example: 'Read from a source document and confirmed through review.' },
  { name: 'Declared', style: 'declared', example: 'Entered or imported by you, or read from a document without meeting the Verified requirements. It can still link to its source.' },
  { name: 'Estimated', style: 'estimated', example: 'A published reference value used where no measured figure exists, with its source cited.' },
]

export default function HowItWorksPage() {
  return (
    <>
      <section className="mk-page-intro">
        <div className="mk-container mk-page-intro-grid">
          <div>
            <span className="mk-eyebrow">How it works</span>
            <h1>From a document to a record you can inspect and reuse.</h1>
            <p>Arbor separates extraction, review and sharing. The result is a stored operational figure with a visible evidence-quality label and available source information.</p>
            <a className="mk-text-link" href={pilotRequestHref()}>Request pilot access <span aria-hidden="true">→</span></a>
          </div>
          <RecordExample compact />
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-container">
          <div className="mk-section-head"><span className="mk-eyebrow">The workflow</span><h2>Four steps, with evidence quality visible throughout.</h2></div>
          <div className="mk-detailed-steps">
            {steps.map(step => (
              <article className="mk-detailed-step" key={step.number}>
                <span className="mk-detailed-number">{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p><p className="mk-step-note">{step.detail}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-sage">
        <div className="mk-container">
          <div className="mk-section-head"><span className="mk-eyebrow">Evidence quality</span><h2>What each label tells you.</h2><p>The label belongs to the record and can change only through a new qualifying record, such as after further evidence and review. It is not a user-selected badge.</p></div>
          <div className="mk-tier-grid">
            {tiers.map(tier => <article className="mk-tier-card" key={tier.name}><span className={`mk-tier-pill mk-tier-${tier.style}`}>{tier.name}</span><p>{tier.example}</p></article>)}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-warm">
        <div className="mk-container mk-editorial-grid">
          <div><span className="mk-eyebrow">Correction history</span><h2>A record can change without losing its history.</h2></div>
          <div className="mk-editorial-copy"><p>If a figure needs correction, Arbor creates a new record that supersedes it. You can see the current value and every earlier one.</p></div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-container mk-editorial-grid">
          <div><span className="mk-eyebrow">Technical assurance</span><h2>Changes to stored records can be checked.</h2></div>
          <div className="mk-editorial-copy"><p>An HMAC audit chain links stored records, so a change to a historical record is detected when the chain is checked. Audit packages carry their own inclusion proofs.</p><Link className="mk-text-link" href="/security">Read about security <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="mk-section mk-section-warm" id="limits">
        <div className="mk-container mk-editorial-grid">
          <div><span className="mk-eyebrow">Plain limits</span><h2>What labels and checks don’t claim.</h2></div>
          <div className="mk-editorial-copy">
            <ul className="mk-limits">
              <li>A label describes the evidence and review behind a figure. It is not an audit of the activity the figure records.</li>
              <li>A confidence score says how clearly a field was read, not whether the figure is true.</li>
              <li>A supported document type does not mean every figure in it is read.</li>
              <li>The audit chain detects changes to records inside Arbor. It cannot show that a source document was accurate.</li>
              <li>Labels travel with Arbor’s exports, but a copy changed after download is outside Arbor’s control.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mk-close"><div className="mk-container mk-close-inner"><div><span className="mk-eyebrow mk-eyebrow-light">Private pilot</span><h2>See whether your documents fit.</h2><p>Tell us what you need to extract and which requests you need to answer. We can discuss pilot access and supported workflows.</p></div><a className="mk-button mk-button-light" href={pilotRequestHref()}>Request pilot access</a></div></section>
    </>
  )
}
