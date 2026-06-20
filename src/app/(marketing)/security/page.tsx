import { colours, typography } from '@/lib/design-system'
import { SUB_PROCESSORS } from '@/lib/legal/subprocessors'

// Gap 7.2 — public security posture page. Referenced in the DPA and sent to
// enterprise buyer procurement / security teams.
const container = { maxWidth: '900px', margin: '0 auto', padding: '0 40px' }

const h2 = {
  fontSize: '20px',
  fontWeight: typography.weights.medium,
  color: colours.textPrimary,
  letterSpacing: typography.tracking.tight,
  margin: '40px 0 12px',
}
const p = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.light,
  color: colours.textSecondary,
  lineHeight: '1.75',
  margin: '0 0 16px',
}
const li = { ...p, margin: '0 0 8px' }

export const metadata = { title: 'Security · Arbor' }

export default function SecurityPage() {
  return (
    <div style={{ backgroundColor: colours.surface }}>
      <div style={{ borderBottom: `1px solid ${colours.border}`, padding: '64px 0 48px' }}>
        <div style={container}>
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textTertiary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase' as const,
              display: 'block',
              marginBottom: '16px',
            }}
          >
            Trust
          </span>
          <h1 style={{ fontSize: '40px', fontWeight: typography.weights.light, color: colours.textPrimary, letterSpacing: typography.tracking.tight, margin: 0 }}>
            Security at Arbor
          </h1>
          <p style={{ ...p, marginTop: '16px', maxWidth: '640px' }}>
            Arbor holds verified operational data on behalf of manufacturers and
            their customers. The integrity and confidentiality of that data is the
            product. This page summarises how we protect it.
          </p>
        </div>
      </div>

      <div style={{ ...container, padding: '0 40px 64px' }}>
        <h2 style={h2}>Encryption</h2>
        <p style={p}>
          Data is encrypted in transit with TLS 1.3 and at rest with AES-256.
          Uploaded documents are stored in private blob storage and can only be
          retrieved with a bearer token. TOTP secrets are encrypted with AES-256-GCM
          before storage.
        </p>

        <h2 style={h2}>Access controls</h2>
        <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
          <li style={li}>Role-based access: administrator, contributor, viewer, verifier, and external auditor roles, each scoped to what they need.</li>
          <li style={li}>Two-factor authentication is mandatory for every administrator account.</li>
          <li style={li}>API keys are scoped to a single organisation and stored only as a bcrypt hash.</li>
          <li style={li}>A session version stamp lets us revoke every active session for an account instantly.</li>
        </ul>

        <h2 style={h2}>Cryptographic audit chain</h2>
        <p style={p}>
          Every data record is cryptographically linked to the previous one using an
          HMAC chain. Any alteration to a stored record breaks the chain and is
          immediately detectable. Records are never overwritten — a correction
          creates a new record that supersedes the original, and both are preserved.
          External verifiers and auditors can confirm the chain independently.
        </p>

        <h2 style={h2}>Data residency</h2>
        <p style={p}>
          Application hosting and the primary database run in EU/UK regions. Where a
          sub-processor operates outside the UK/EEA, Standard Contractual Clauses are
          in place.
        </p>

        <h2 style={h2}>Sub-processors</h2>
        <ul style={{ paddingLeft: '20px', margin: '0 0 16px' }}>
          {SUB_PROCESSORS.map((s) => (
            <li key={s.name} style={li}>
              <strong style={{ fontWeight: typography.weights.medium, color: colours.textPrimary }}>{s.name}</strong> — {s.activity}. {s.location}.
            </li>
          ))}
        </ul>

        <h2 style={h2}>Independent assurance</h2>
        <p style={p}>
          SOC 2 Type I audit is in progress, with completion expected in Q4 2026.
          A penetration test is scheduled for Q3 2026; a results summary will be
          published here. Our Data Processing Agreement is available on the{' '}
          <a href="/legal/dpa" style={{ color: colours.navy }}>legal page</a>.
        </p>

        <h2 style={h2}>Responsible disclosure</h2>
        <p style={p}>
          If you believe you have found a security vulnerability, please email{' '}
          <a href="mailto:security@arbor.io" style={{ color: colours.navy }}>security@arbor.io</a>.
          We will acknowledge your report and keep you updated on remediation.
        </p>
      </div>
    </div>
  )
}
