import type { Metadata } from 'next'
import { PilotRequestForm } from '@/components/marketing/PilotRequestForm'

export const metadata: Metadata = {
  title: 'Request Arbor pilot access',
  description:
    'Tell Arbor about your organisation, your role and the operational data you need to manage or request. Pilot access is by invitation.',
}

const supplierPlans = ['Starter', 'Micro', 'Small', 'Growth']
const buyerPlans = ['Standard', 'Business', 'Enterprise']

export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string; plan?: string }>
}) {
  const params = await searchParams
  const audience =
    params.audience === 'supplier' || params.audience === 'buyer' || params.audience === 'importer'
      ? params.audience
      : 'general'
  const importer = audience === 'importer'
  const plans = audience === 'supplier' ? supplierPlans : audience === 'buyer' ? buyerPlans : []
  const plan = params.plan && plans.includes(params.plan) ? params.plan : ''

  return (
    <section className="mk-section mk-section-warm mk-request-section">
      <div className="mk-container mk-request-grid">
        <div className="mk-request-intro">
          <span className="mk-eyebrow">Private pilot</span>
          <h1>
            {importer
              ? 'Tell us about your CBAM imports.'
              : 'Tell us what you need to do with operational data.'}
          </h1>
          <p>
            {importer
              ? 'Share the goods you import, where from, and whether you file in the UK, the EU or both.'
              : 'Share a little about your organisation and the documents or supplier requests you handle.'}{' '}
            This is an expression of interest; it does not create an account or reserve a plan.
          </p>
          <div className="mk-request-aside">
            <strong>Already invited?</strong>
            <p>Use your invitation code to create a pilot account. Existing users can sign in.</p>
            <a href="/signup">
              Create your invited account <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <PilotRequestForm initialAudience={audience} initialPlan={plan} />
      </div>
    </section>
  )
}
