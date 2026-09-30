import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Security and data access | Arbor',
  description: 'How Arbor structures access to operational records, tracks corrections and supports security reviews.',
}

const nav = [
  ['access', 'Access controls'], ['integrity', 'Record integrity'], ['documents', 'Documents and API keys'],
  ['assurance', 'Assurance requests'], ['disclosure', 'Report a vulnerability'],
] as const

export default function SecurityPage() {
  return (
    <div className="mk-doc-page">
      <header className="mk-page-intro"><div className="mk-container"><span className="mk-eyebrow">Security</span><h1>Controls that keep operational records accountable.</h1><p>Arbor combines account and grant controls with a history of record changes. This page explains the controls built into the application. Ask us for current deployment details and assessment status.</p></div></header>
      <div className="mk-container mk-doc-layout">
        <nav aria-label="On this page" className="mk-doc-nav"><strong>On this page</strong>{nav.map(([id,label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
        <div className="mk-doc-content">
          <section id="access"><h2>Access controls</h2><p>Organisation accounts use roles to separate administrators, contributors, viewers, verifiers and auditors. Sharing grants scope a buyer’s access to a supplier’s records; revocation stops subsequent reads through Arbor. Previously downloaded copies remain outside the service’s control.</p><p>Administrative accounts have a two-factor setup flow. API keys belong to one organisation and have read or read/write scope. Where configured, single sign-on and provisioning are available through the connected identity provider.</p></section>
          <section id="integrity"><h2>Record integrity</h2><p>Stored records are linked in an HMAC audit chain. A correction creates a superseding record instead of rewriting the prior value. Checking the chain can reveal a change to historical chain content at verification time.</p><p>The audit chain establishes provenance within Arbor. It does not independently verify a document’s factual accuracy or a supplier’s underlying activity. Audit packages include a separate way to inspect their inclusion proofs.</p></section>
          <section id="documents"><h2>Documents and API keys</h2><p>Document retrieval is controlled through authenticated or authorised access paths. API key secrets are stored as hashes rather than retrievable plaintext, and keys can be limited by scope. The application also supports account session revocation.</p><p>Specific encryption, storage-region and contractual transfer guarantees depend on the deployed services and provider agreements. Ask for the current evidence before relying on any particular deployment posture.</p></section>
          <section id="assurance"><h2>Assurance requests</h2><p>For current hosting regions, sub-processor details, contractual safeguards or external assessment status, contact <a href="mailto:security@arbor.io">security@arbor.io</a>. We share what is in place today, not what is planned.</p><p>The draft <a href="/legal/dpa">Data Processing Agreement</a> needs legal approval for your specific arrangement before it is executed.</p></section>
          <section id="disclosure"><h2>Report a vulnerability</h2><p>Send a suspected vulnerability to <a href="mailto:security@arbor.io">security@arbor.io</a> with the affected area and steps to reproduce. Please do not include production customer data or secrets in the report.</p></section>
        </div>
      </div>
    </div>
  )
}
