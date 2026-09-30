import type { Metadata } from 'next'
import { CopyCode } from '@/components/marketing/CopyCode'

export const metadata: Metadata = {
  title: 'Arbor API guide | Authentication, records and supplier access',
  description: 'A practical guide to Arbor v1 keys, record ingestion, supplier queries, webhooks and response behaviour.',
}

const nav = [
  ['authentication', 'Authentication'], ['read-records', 'Read records'], ['ingest', 'Ingest records'],
  ['supplier-access', 'Supplier access'], ['webhooks', 'Webhooks'], ['errors', 'Errors'],
] as const

const readExample = `curl -H "Authorization: Bearer arb_<prefix>_<secret>" \\
  "https://YOUR_ARBOR_HOST/api/v1/records?domain=ENERGY&tier=B"`

const ingestExample = `curl -X POST "https://YOUR_ARBOR_HOST/api/v1/ingest" \\
  -H "Authorization: Bearer arb_<prefix>_<secret>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "idempotencyKey": "electricity-apr-2026-v1",
    "records": [{
      "domain": "ENERGY",
      "fieldName": "electricity_consumption",
      "value": 12480,
      "unit": "kWh",
      "periodStart": "2026-04-01T00:00:00.000Z",
      "periodEnd": "2026-05-01T00:00:00.000Z",
      "sourceSystem": "Example ERP"
    }]
  }'`

const nodeExample = `import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, header, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(header ?? '')
  return a.length === b.length && timingSafeEqual(a, b)
}`

const pythonExample = `import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)`

export default function ApiDocsPage() {
  return (
    <div className="mk-doc-page">
      <header className="mk-page-intro"><div className="mk-container"><span className="mk-eyebrow">Developer guide</span><h1>Build on operational records with the Arbor API.</h1><p>Use a scoped API key to read your organisation’s active records, ingest structured figures or query supplier records shared with you. Examples use a placeholder host and key.</p></div></header>
      <div className="mk-container mk-doc-layout">
        <nav aria-label="On this page" className="mk-doc-nav"><strong>On this page</strong>{nav.map(([id,label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
        <div className="mk-doc-content">
          <section id="authentication"><h2>Authentication</h2><p>Create a key under Settings → Integrations &amp; API keys. Send it as a Bearer token over HTTPS. A <code>READ</code> key can query data; a <code>READ_WRITE</code> key is required for ingestion.</p><CopyCode label="First read request" code={readExample} /><p>The base URL is the origin of your Arbor deployment. Keep the secret on your server; a browser-visible key can be copied by visitors.</p></section>

          <section id="read-records"><h2>Read your records</h2><h3>GET /api/v1/records</h3><p>Returns your organisation’s active records, newest submission first, as <code>{'{ records, count }'}</code>. Optional filters are <code>domain</code>, <code>tier</code> (A, B or C), <code>periodStart</code> and <code>periodEnd</code>. The period filters keep records starting on or after the requested start and ending on or before the requested end.</p><p><code>format=csv</code> or <code>format=xml</code> downloads the same selected records; JSON is the default. Confidence and document references can be null, for example on manually declared or integrated records. This route currently returns the matching set without pagination.</p></section>

          <section id="ingest"><h2>Ingest structured records</h2><h3>POST /api/v1/ingest</h3><p>Requires a <code>READ_WRITE</code> key. Send 1–500 numeric records with domain, field name, finite value, recognised unit and ISO date-time period bounds. Records entered through this route are Declared (Tier B) because a source document is not attached.</p><CopyCode label="Example ingestion request" code={ingestExample} /><p>The response reports <code>created</code>, <code>rejected</code>, <code>total</code> and an indexed <code>results</code> array. A valid batch can still contain rejected items, so inspect each result. Set an <code>idempotencyKey</code> to make retries safe: a completed request replays its result; reusing the key with different content returns <code>422 IDEMPOTENCY_KEY_REUSED</code>, and an in-progress request returns <code>409 IN_PROGRESS</code>.</p><p>Plan capacity can return <code>402 PLAN_LIMIT</code>. If a transient write fails, retry the same keyed batch after addressing the error; items already committed are not duplicated.</p></section>

          <section id="supplier-access"><h2>Query shared supplier data</h2><h3>GET /api/v1/supply-chain</h3><p>Lists suppliers with active grants to your organisation. Each item includes the supplier ID and name, accessible domains, record count and A/B/C tier counts. Only records covered by the current grants are counted.</p><h3>GET /api/v1/supply-chain/{'{supplierId}'}/records</h3><p>Returns accessible active records for one supplier. Filters: <code>domain</code>, <code>trustTier</code>, <code>periodStart</code>, <code>periodEnd</code>, <code>page</code> (default 1) and <code>pageSize</code> (default 50, maximum 500). Period filters match records that overlap the requested interval. The response includes <code>total</code> and <code>totalPages</code>. A missing active grant returns <code>403 FORBIDDEN</code>.</p><p>Fields such as <code>sourceText</code>, <code>confidenceScore</code> and <code>documentId</code> may be null; their presence depends on how the record was created. An API read is logged for records returned on the page.</p><h3>GET /api/v1/supply-chain/gaps</h3><p>Optional ISO <code>periodStart</code> and <code>periodEnd</code> narrow the interval. For each accessible supplier, the response identifies domains with no accessible records and domains containing only Estimated (Tier C) records. Gap analysis stays within the granted scope; it is not a view of all the supplier’s holdings.</p><p>These record-read and buyer routes use a configured 100-request-per-minute limit keyed by organisation, shared across its API keys. A limit breach returns <code>429 RATE_LIMITED</code>.</p></section>

          <section id="webhooks"><h2>Webhooks</h2><p>Subscribe under Settings → Webhooks to <code>record.certified</code>, <code>record.superseded</code>, <code>access.granted</code> or <code>access.revoked</code>. Deliveries are POST requests. Verify <code>X-Arbor-Signature</code> against the raw body with your signing secret before using the payload.</p><CopyCode label="Verify in Node.js" code={nodeExample} /><CopyCode label="Verify in Python" code={pythonExample} /><p>Return a 2xx response only after your receiver has accepted the event. Failed deliveries can be retried, so make the receiver safe to run more than once for the same event.</p></section>

          <section id="errors"><h2>Errors and next steps</h2><p>Error responses use an <code>error</code> message and generally a <code>code</code>. Common cases include <code>401 UNAUTHORIZED</code>, <code>403 FORBIDDEN</code>, <code>400 VALIDATION_ERROR</code>, <code>402 PLAN_LIMIT</code>, <code>409 IN_PROGRESS</code>, <code>422 IDEMPOTENCY_KEY_REUSED</code> and <code>429 RATE_LIMITED</code>. Check the status and body; do not assume every failed request is safe to repeat with a new idempotency key.</p><p>For a specific integration or a missing schema detail, contact <a href="mailto:hello@arbor.io">hello@arbor.io</a> with the endpoint and your use case. Never send the full API secret.</p></section>
        </div>
      </div>
    </div>
  )
}
