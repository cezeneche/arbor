import type { Metadata } from 'next'
import { pilotRequestHref } from '@/lib/marketing/pilot'

export const metadata: Metadata = {
  title: 'Pilot access and planned pricing | Arbor',
  description:
    'Arbor is in a private pilot with invitation-only access and individually agreed terms. Explore the planned supplier and buyer plans.',
}

type Plan = {
  name: string
  price: string
  description: string
  capacity: string
  detail: string
  highlighted?: boolean
}

const supplierPlans: Plan[] = [
  {
    name: 'Starter',
    price: 'Free',
    description: 'Respond to buyer requests using manual declarations.',
    capacity: 'Up to 5 active records',
    detail: 'No document uploads.',
  },
  {
    name: 'Micro',
    price: '£29',
    description: 'Start building a document-backed operational record.',
    capacity: 'Up to 500 active records',
    detail: 'Up to 10 document uploads each calendar month.',
  },
  {
    name: 'Small',
    price: '£79',
    description: 'For teams handling documents more regularly.',
    capacity: 'Up to 2,500 active records',
    detail: 'Up to 50 document uploads each calendar month.',
    highlighted: true,
  },
  {
    name: 'Growth',
    price: '£149',
    description: 'For a larger record and document workload.',
    capacity: 'Up to 10,000 active records',
    detail: 'No monthly cap on document uploads.',
  },
]

const buyerPlans: Plan[] = [
  {
    name: 'Standard',
    price: '£299',
    description: 'Begin requesting and reviewing supplier records.',
    capacity: 'Up to 10 connected suppliers',
    detail: 'A connection is a distinct supplier organisation.',
  },
  {
    name: 'Business',
    price: '£699',
    description: 'Work across a wider supplier portfolio.',
    capacity: 'Up to 50 connected suppliers',
    detail: 'Requests to an already-connected supplier do not use another connection.',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '£1,499',
    description: 'Discuss larger-scale supplier access and integration needs.',
    capacity: 'No cap on connected suppliers',
    detail: 'Service and support terms are agreed separately.',
  },
]

function PlanCard({ plan, audience }: { plan: Plan; audience: 'supplier' | 'buyer' }) {
  return (
    <article className={`mk-plan-card${plan.highlighted ? ' mk-plan-featured' : ''}`}>
      <span className="mk-plan-name">{plan.name}</span>
      <div className="mk-plan-price">
        {plan.price}
        {plan.price !== 'Free' && <small> / month</small>}
      </div>
      <p>{plan.description}</p>
      <div className="mk-plan-capacity">
        <strong>{plan.capacity}</strong>
        <span>{plan.detail}</span>
      </div>
      <a
        className={`mk-button ${plan.highlighted ? 'mk-button-light' : 'mk-button-navy'}`}
        href={pilotRequestHref(audience, plan.name)}
      >
        Discuss {plan.name}
      </a>
    </article>
  )
}

export default function PricingPage() {
  return (
    <>
      <section className="mk-page-intro mk-pricing-intro">
        <div className="mk-container">
          <span className="mk-eyebrow">Pricing</span>
          <h1>Pilot terms first. Planned pricing for what follows.</h1>
          <p>
            Arbor is in a private pilot. Access is by invitation and pilot terms are agreed directly. The
            plans below are planned for after the pilot. They are not a checkout, and pilot terms are agreed
            separately.
          </p>
          <a className="mk-button mk-button-navy" href={pilotRequestHref()}>
            Request pilot access
          </a>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-container">
          <div className="mk-section-head">
            <span className="mk-eyebrow">For suppliers</span>
            <h2>Choose the record capacity your work needs.</h2>
            <p>
              Responding to buyer data requests through the submission flow is not capped by these supplier
              record limits.
            </p>
          </div>
          <div className="mk-plan-grid mk-plan-grid-supplier">
            {supplierPlans.map(plan => (
              <PlanCard key={plan.name} plan={plan} audience="supplier" />
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-warm">
        <div className="mk-container">
          <div className="mk-section-head">
            <span className="mk-eyebrow">For buyers</span>
            <h2>Start with the suppliers you need to work with.</h2>
            <p>
              Buyer capacity is counted by distinct connected supplier organisations, not by the number of
              data requests sent to an existing connection.
            </p>
          </div>
          <div className="mk-plan-grid mk-plan-grid-buyer">
            {buyerPlans.map(plan => (
              <PlanCard key={plan.name} plan={plan} audience="buyer" />
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-container mk-editorial-grid">
          <div>
            <span className="mk-eyebrow">For importers</span>
            <h2>CBAM terms are agreed in the pilot.</h2>
          </div>
          <div className="mk-editorial-copy">
            <p>
              Preparing UK and EU CBAM returns is priced separately from the supplier and buyer plans, and
              agreed directly with each importer during the pilot. Tell us what you import and where you file.
            </p>
            <a className="mk-text-link" href={pilotRequestHref('importer')}>
              Request importer pilot access <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>

      <section className="mk-section mk-section-sage">
        <div className="mk-container mk-pricing-explain">
          <div>
            <span className="mk-eyebrow">A practical example</span>
            <h2>What is an active record?</h2>
          </div>
          <div>
            <p>
              An active record is a current stored figure. A single electricity bill can produce several
              figures, such as consumption and cost, so one document may use more than one record slot. When a
              correction supersedes a figure, the previous version is no longer active.
            </p>
            <p>
              Upload limits count documents submitted in a calendar month. Where a plan limit applies, Arbor
              blocks a new upload or record write that would exceed it; the existing records remain available.
            </p>
          </div>
        </div>
      </section>

      <section className="mk-close">
        <div className="mk-container mk-close-inner">
          <div>
            <span className="mk-eyebrow mk-eyebrow-light">Private pilot</span>
            <h2>Talk through the right starting point.</h2>
            <p>
              Tell us whether you supply operational data or request it from suppliers. We will discuss pilot
              terms directly.
            </p>
          </div>
          <a className="mk-button mk-button-light" href={pilotRequestHref()}>
            Request pilot access
          </a>
        </div>
      </section>
    </>
  )
}
