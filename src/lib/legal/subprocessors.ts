// Illustrative provider inventory for the unapproved legal drafts. Verify the
// actual deployment, provider contracts, processing locations and transfer
// safeguards before using this list in an executed DPA.
export const DPA_VERSION = 'v1'
export const DPA_LAST_UPDATED = '9 July 2026'

export interface SubProcessor {
  name: string
  activity: string
  location: string
  dpaUrl: string
}

export const SUB_PROCESSORS: SubProcessor[] = [
  { name: 'Vercel Inc.', activity: 'Application hosting and edge delivery', location: 'To confirm', dpaUrl: 'https://vercel.com/legal/dpa' },
  { name: 'Supabase Inc.', activity: 'Managed PostgreSQL database', location: 'To confirm', dpaUrl: 'https://supabase.com/legal/dpa' },
  { name: 'Anthropic PBC', activity: 'Document data extraction; data-use terms to verify', location: 'To confirm', dpaUrl: 'https://www.anthropic.com/legal/commercial-terms' },
  { name: 'Resend Inc.', activity: 'Transactional email delivery', location: 'To confirm', dpaUrl: 'https://resend.com/legal/dpa' },
  { name: 'Inngest Inc.', activity: 'Background job queue and scheduling', location: 'To confirm', dpaUrl: 'https://www.inngest.com/legal/dpa' },
  { name: 'Upstash Inc.', activity: 'Rate-limiting (Redis)', location: 'To confirm', dpaUrl: 'https://upstash.com/trust/dpa.pdf' },
  { name: 'Slack Technologies, LLC', activity: 'Internal alerts: new enquiries (organisation name) and CBAM cases needing review', location: 'To confirm', dpaUrl: 'https://slack.com/terms-of-service/data-processing' },
  { name: 'WorkOS, Inc.', activity: 'Enterprise SSO authentication and SCIM directory provisioning', location: 'To confirm', dpaUrl: 'https://workos.com/legal/dpa' },
]
