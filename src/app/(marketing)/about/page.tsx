import type { Metadata } from 'next'
import Link from 'next/link'
import { pilotRequestHref } from '@/lib/marketing/pilot'

export const metadata: Metadata = {
  title: 'About Arbor | Operational data with visible evidence quality',
  description: 'Why Arbor is building a reusable operational data record for suppliers and the customers who request their information.',
}

const principles = [
  { title: 'Evidence stays close', body: 'A stored figure carries its evidence-quality label and available source information, so the person using it can see what supports it.' },
  { title: 'Corrections stay visible', body: 'A correction creates a new record that supersedes the earlier one. Teams can follow the change history instead of losing the original value.' },
  { title: 'The supplier chooses access', body: 'Buyers see the records a supplier authorises for them. A downloaded copy remains outside Arbor’s access controls.' },
]

export default function AboutPage() {
  return (
    <>
      <section className="mk-hero mk-about-hero"><div className="mk-container"><span className="mk-eyebrow mk-eyebrow-light">About Arbor</span><h1>Operational data should be easier to explain and reuse.</h1><p>Suppliers are asked for figures that already exist in their bills, logs and invoices. Arbor helps them turn those sources into records that can be reviewed, corrected and shared with permission.</p></div></section>

      <section className="mk-section"><div className="mk-container mk-editorial-grid"><div><span className="mk-eyebrow">Our purpose</span><h2>Less rebuilding. More clarity about the figure.</h2></div><div className="mk-editorial-copy"><p>The same electricity or production figure may be requested by several customers in several formats. Re-entering it each time takes work and makes its provenance harder to follow.</p><p>Arbor keeps the operational record and its evidence-quality status together. A team can start the next response from a figure it can inspect rather than searching for the document again.</p></div></div></section>

      <section className="mk-section mk-section-warm"><div className="mk-container"><div className="mk-section-head"><span className="mk-eyebrow">What we build</span><h2>A repository for operational records.</h2><p>Arbor extracts supported fields from documents, stores records with visible labels and enables controlled sharing. AI also helps interpret natural-language searches, but query answers do not write new records.</p></div><div className="mk-about-boundary"><div><strong>What Arbor helps with</strong><p>Collecting documents, reviewing figures, keeping correction history and reusing authorised records.</p></div><div><strong>What a label does not prove</strong><p>Verified describes evidence and review requirements. It is not an independent audit of the supplier’s underlying activity.</p></div><div><strong>Regulatory workflows</strong><p>CBAM-related workflows exist for selected cases. Ask us about supported jurisdictions, reporting periods and output boundaries for your use case.</p></div></div></div></section>

      <section className="mk-section mk-section-sage"><div className="mk-container"><div className="mk-section-head"><span className="mk-eyebrow">Our principles</span><h2>Make each record useful to the next person who needs it.</h2></div><div className="mk-tier-grid">{principles.map(item => <article className="mk-tier-card" key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div></div></section>

      <section className="mk-section"><div className="mk-container mk-editorial-grid"><div><span className="mk-eyebrow">Get in touch</span><h2>Tell us what you are trying to manage or request.</h2></div><div className="mk-editorial-copy"><p>We welcome conversations with suppliers, buyers and institutional teams about operational documents, data requests and pilot fit.</p><div className="mk-about-contacts"><a href="mailto:hello@arbor.io">General enquiries · hello@arbor.io</a><a href="mailto:legal@arbor.io">Legal and data · legal@arbor.io</a></div><Link className="mk-button mk-button-navy" href={pilotRequestHref()}>Request pilot access</Link></div></div></section>
    </>
  )
}
