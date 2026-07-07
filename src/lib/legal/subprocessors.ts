// sub-processor list (DPA appendix). Update DPA_VERSION whenever this
// list changes; buyers may have signed a specific version.
export const DPA_VERSION = 'v1'
export const DPA_LAST_UPDATED = '19 June 2026'

export interface SubProcessor {
  name: string
  activity: string
  location: string
  dpaUrl: string
}

export const SUB_PROCESSORS: SubProcessor[] = [
  { name: 'Vercel Inc.', activity: 'Application hosting and edge delivery', location: 'EU (Frankfurt region)', dpaUrl: 'https://vercel.com/legal/dpa' },
  { name: 'Supabase Inc.', activity: 'Managed PostgreSQL database', location: 'EU (West)', dpaUrl: 'https://supabase.com/legal/dpa' },
  { name: 'Anthropic PBC', activity: 'Document data extraction (no training on customer data)', location: 'USA (SCCs in place)', dpaUrl: 'https://www.anthropic.com/legal/commercial-terms' },
  { name: 'Resend Inc.', activity: 'Transactional email delivery', location: 'USA (SCCs in place)', dpaUrl: 'https://resend.com/legal/dpa' },
  { name: 'Inngest Inc.', activity: 'Background job queue and scheduling', location: 'USA (SCCs in place)', dpaUrl: 'https://www.inngest.com/legal/dpa' },
  { name: 'Upstash Inc.', activity: 'Rate-limiting (Redis)', location: 'EU (SCCs in place)', dpaUrl: 'https://upstash.com/trust/dpa.pdf' },
]
