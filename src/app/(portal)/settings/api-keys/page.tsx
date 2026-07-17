import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { ApiKeyManager } from './ApiKeyManager'
import { BenchmarkConsentToggle } from './BenchmarkConsentToggle'
import { SettingsBreadcrumb } from '../SettingsBreadcrumb'

export default async function ApiKeysPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const entityId = getSessionUser(session).entityId as string

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { allowBenchmarkAggregation: true },
  })

  const keys = await prisma.apiKey.findMany({
    where: { entityId, isActive: true },
    select: { id: true, label: true, lastUsed: true, createdAt: true, scope: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const serialised = keys.map(k => ({
    ...k,
    lastUsed: k.lastUsed?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
    expiresAt: k.expiresAt?.toISOString() ?? null,
  }))

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'https://your-arbor-instance.com'

  return (
    <div>
      <SettingsBreadcrumb current="Integrations & API keys" />
      <div style={{ marginBottom: spacing[5] }}>
        <h1
          style={textStyles.pageTitle}
        >
          Integrations &amp; API keys
        </h1>
        <p
          style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}
        >
          Connect your accounting or ERP system to push data into arbor automatically.
          Create an API key and configure your system to POST to the ingest endpoint below.
        </p>
      </div>

      {/* Endpoint reference */}
      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[3],
          marginBottom: spacing[4],
        }}
      >
        <p
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.textSecondary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            margin: `0 0 ${spacing[2]}`,
          }}
        >
          Integration endpoints
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[
            {
              label: 'Push operational data',
              method: 'POST',
              path: '/api/v1/ingest',
              description: 'Send structured records from your ERP or accounting system. Returns per-record status. Records are created as Declared (Tier B). Submit supporting documents to upgrade to Verified.',
            },
            {
              label: 'Read your records',
              method: 'GET',
              path: '/api/v1/records',
              description: 'Query your stored records. Supports domain, tier, and period filters. Returns JSON, CSV, or XML.',
            },
          ].map(ep => (
            <div key={ep.path}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span
                  style={{
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.medium,
                    color: colours.navy,
                    backgroundColor: colours.background,
                    border: `1px solid ${colours.border}`,
                    borderRadius: '3px',
                    padding: '2px 6px',
                    fontFamily: 'monospace',
                  }}
                >
                  {ep.method}
                </span>
                <code
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textPrimary,
                  }}
                >
                  {baseUrl}{ep.path}
                </code>
              </div>
              <p
                style={{
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  margin: 0,
                  lineHeight: '1.5',
                }}
              >
                {ep.description}
              </p>
            </div>
          ))}
        </div>

        {/* Curl example */}
        <div style={{ marginTop: spacing[3] }}>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.textSecondary,
              letterSpacing: typography.tracking.wider,
              textTransform: 'uppercase',
              margin: `0 0 8px`,
            }}
          >
            Example request
          </p>
          <pre
            style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              backgroundColor: colours.background,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              padding: '12px 14px',
              margin: 0,
              overflowX: 'auto',
              lineHeight: '1.6',
              whiteSpace: 'pre',
            }}
          >{`curl -X POST ${baseUrl}/api/v1/ingest \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "idempotencyKey": "xero-sync-2026-Q1",
    "records": [
      {
        "domain": "ENERGY",
        "fieldName": "total_consumption_kwh",
        "value": 14820,
        "unit": "kWh",
        "periodStart": "2026-01-01T00:00:00Z",
        "periodEnd": "2026-03-31T23:59:59Z",
        "sourceSystem": "Xero"
      }
    ]
  }'`}</pre>
        </div>
      </div>

      <p style={{ ...textStyles.sectionSubtitle, margin: `0 0 ${spacing[4]}` }}>
        Read the full <a href="/docs/api" style={{ color: colours.navy }}>API reference</a>, including buyer query endpoints. Set up event callbacks in <a href="/settings/webhooks" style={{ color: colours.navy }}>Webhooks</a>.
      </p>

      <ApiKeyManager initialKeys={serialised} />

      {/* Data sharing / sector benchmarks consent */}
      <div style={{ marginTop: spacing[4] }}>
        <BenchmarkConsentToggle initialValue={entity?.allowBenchmarkAggregation ?? false} />
      </div>
    </div>
  )
}
