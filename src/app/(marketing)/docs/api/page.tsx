import { colours, typography } from '@/lib/design-system'

// Gap 6.5 — public API reference. Gates enterprise buyer adoption.
const container = { maxWidth: '900px', margin: '0 auto', padding: '0 40px' }
const h2 = { fontSize: '20px', fontWeight: typography.weights.medium, color: colours.textPrimary, letterSpacing: typography.tracking.tight, margin: '40px 0 12px' }
const h3 = { fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: '24px 0 8px' }
const p = { fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: colours.textSecondary, lineHeight: '1.7', margin: '0 0 16px' }
const pre = {
  fontSize: '12px', fontFamily: 'monospace', fontWeight: typography.weights.light, color: colours.textPrimary,
  backgroundColor: colours.background, border: `1px solid ${colours.border}`, borderRadius: '4px',
  padding: '14px', margin: '0 0 16px', overflowX: 'auto' as const, whiteSpace: 'pre' as const, lineHeight: '1.6',
}

export const metadata = { title: 'API reference · Arbor' }

export default function ApiDocsPage() {
  return (
    <div style={{ backgroundColor: colours.surface }}>
      <div style={{ borderBottom: `1px solid ${colours.border}`, padding: '64px 0 48px' }}>
        <div style={container}>
          <h1 style={{ fontSize: '40px', fontWeight: typography.weights.light, color: colours.textPrimary, letterSpacing: typography.tracking.tight, margin: 0 }}>
            API reference
          </h1>
          <p style={{ ...p, marginTop: '16px' }}>
            The Arbor v1 API lets suppliers push operational data and buyers query certified
            supply-chain records. All endpoints are JSON over HTTPS.
          </p>
        </div>
      </div>

      <div style={{ ...container, padding: '0 40px 64px' }}>
        <h2 style={h2}>Authentication</h2>
        <p style={p}>
          Authenticate with an API key in the <code>Authorization</code> header. Create keys in
          Settings → Integrations &amp; API keys. Keys are scoped to your organisation.
        </p>
        <pre style={pre}>{`Authorization: Bearer arb_<prefix>_<secret>`}</pre>

        <h2 style={h2}>Rate limits</h2>
        <p style={p}>
          Buyer query endpoints are limited to 100 requests per minute per API key. Exceeding the
          limit returns <code>429</code> with code <code>RATE_LIMITED</code>.
        </p>

        <h2 style={h2}>Endpoints</h2>

        <h3 style={h3}>POST /api/v1/ingest</h3>
        <p style={p}>Push structured records from an ERP or accounting system. Records are created as Declared (Tier B). Supports an <code>idempotencyKey</code>.</p>

        <h3 style={h3}>GET /api/v1/records</h3>
        <p style={p}>Retrieve your own stored records. Filter by domain, tier, and period.</p>

        <h3 style={h3}>GET /api/v1/supply-chain</h3>
        <p style={p}>List suppliers that have granted you access, with a data-coverage summary and trust-tier distribution.</p>

        <h3 style={h3}>GET /api/v1/supply-chain/&#123;supplierId&#125;/records</h3>
        <p style={p}>
          Paginated records for a supplier you have access to. Query params:
          <code> domain</code>, <code>periodStart</code>, <code>periodEnd</code>, <code>trustTier</code>,
          <code> page</code>, <code>pageSize</code> (max 500). Returns <code>403</code> without an active grant.
        </p>

        <h3 style={h3}>GET /api/v1/supply-chain/gaps</h3>
        <p style={p}>Which supplier+domain combinations are missing records or have only estimated (Tier C) data for a period.</p>

        <h2 style={h2}>Webhooks</h2>
        <p style={p}>
          Subscribe in Settings → Webhooks. Each delivery is a POST with an{' '}
          <code>X-Arbor-Signature</code> header: <code>sha256=&lt;hmac&gt;</code> computed over the
          raw request body using your signing secret. Event types:{' '}
          <code>record.certified</code>, <code>record.superseded</code>, <code>access.granted</code>,
          <code> access.revoked</code>.
        </p>
        <pre style={pre}>{`{
  "event": "record.certified",
  "supplierEntityId": "ent_...",
  "domain": "ENERGY",
  "trustTier": "A",
  "periodStart": "2026-01-01T00:00:00.000Z",
  "periodEnd": "2026-03-31T23:59:59.000Z",
  "occurredAt": "2026-06-19T10:00:00.000Z"
}`}</pre>

        <h3 style={h3}>Verifying the signature (Node.js)</h3>
        <pre style={pre}>{`import { createHmac, timingSafeEqual } from 'crypto'

function verify(rawBody, header, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected); const b = Buffer.from(header)
  return a.length === b.length && timingSafeEqual(a, b)
}`}</pre>

        <h3 style={h3}>Verifying the signature (Python)</h3>
        <pre style={pre}>{`import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)`}</pre>

        <h2 style={h2}>Errors</h2>
        <p style={p}>
          Errors return a JSON body with <code>error</code> and <code>code</code> fields. Common codes:
          <code> UNAUTHORIZED</code> (401), <code>FORBIDDEN</code> (403),{' '}
          <code>VALIDATION_ERROR</code> (400), <code>RATE_LIMITED</code> (429).
        </p>
      </div>
    </div>
  )
}
