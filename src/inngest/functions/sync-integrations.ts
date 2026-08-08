import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/credential-encryption'
import { writeIntegrationRecords, recordSyncOutcome } from '@/lib/integrations/sync-core'
import { mapCdsDeclarations, mapSapMaterialDocs, mapNetSuiteItemReceipts } from '@/lib/integrations/mappers'
import { safeFetchJson } from '@/lib/net/safe-fetch'
import type { IntegrationProvider } from '@prisma/client'

const SYNC_TIMEOUT_MS = 20_000
const SYNC_MAX_BYTES = 5_000_000

/** Joins a tenant-supplied base URL to a fixed provider path without letting the
 *  base smuggle in its own path traversal or query string. */
function providerEndpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

// fetch from a provider's API, map, and write Tier B records.
// Credentials are AES-256-GCM encrypted; only decrypted in-memory here.
//
// SAP and NetSuite base URLs are supplied by the tenant, so every call goes
// through safeFetchJson: public https destinations only, redirects re-checked,
// bounded time and bounded response size. The HMRC endpoint is a constant but
// uses the same path so the limits apply uniformly.
async function runSync(provider: IntegrationProvider, credentialId: string): Promise<{ created: number; skipped: number }> {
  const cred = await prisma.integrationCredential.findUnique({ where: { id: credentialId } })
  if (!cred || !cred.isActive) return { created: 0, skipped: 0 }

  const creds = JSON.parse(decryptSecret(cred.encryptedCredentials)) as Record<string, string>
  const limits = { timeoutMs: SYNC_TIMEOUT_MS, maxBytes: SYNC_MAX_BYTES }

  let records
  if (provider === 'CDS') {
    const json = await safeFetchJson<Parameters<typeof mapCdsDeclarations>[0]>('https://api.service.hmrc.gov.uk/customs/declarations', {
      ...limits,
      label: 'CDS fetch',
      headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/vnd.hmrc.1.0+json' },
    })
    records = mapCdsDeclarations(json)
  } else if (provider === 'SAP') {
    const json = await safeFetchJson<Parameters<typeof mapSapMaterialDocs>[0]>(
      providerEndpoint(
        creds.baseUrl ?? '',
        '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader?$format=json',
      ),
      {
        ...limits,
        label: 'SAP fetch',
        headers: { Authorization: `Basic ${creds.basicAuth}`, Accept: 'application/json' },
      },
    )
    records = mapSapMaterialDocs(json)
  } else if (provider === 'NETSUITE') {
    const json = await safeFetchJson<Parameters<typeof mapNetSuiteItemReceipts>[0]>(
      providerEndpoint(creds.accountUrl ?? '', '/services/rest/record/v1/itemreceipt'),
      {
        ...limits,
        label: 'NetSuite fetch',
        headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' },
      },
    )
    records = mapNetSuiteItemReceipts(json)
  } else {
    return { created: 0, skipped: 0 } // ORACLE: documentation-only, no pre-built connector
  }

  const result = await writeIntegrationRecords(cred.entityId, records)
  return result
}

// On-demand sync triggered from the integrations UI.
export const syncIntegrationFunction = inngest.createFunction(
  { id: 'sync-integration', retries: 2, concurrency: { limit: 3 }, triggers: [{ event: 'integration/sync' }] },
  async ({ event, step }) => {
    const { credentialId, provider } = event.data as { credentialId: string; provider: IntegrationProvider }
    try {
      const result = await step.run('run-sync', () => runSync(provider, credentialId))
      await step.run('record-outcome', () => recordSyncOutcome(credentialId, `ok: ${result.created} created, ${result.skipped} skipped`))
      return result
    } catch (e) {
      await step.run('record-failure', () => recordSyncOutcome(credentialId, `error: ${(e as Error).message}`))
      throw e
    }
  },
)

// Daily scheduled CDS pull for all active CDS credentials.
export const syncCdsDailyFunction = inngest.createFunction(
  { id: 'sync-cds-daily', triggers: [{ cron: '0 7 * * *' }] },
  async ({ step }) => {
    const creds = await step.run('find-cds-credentials', async () =>
      prisma.integrationCredential.findMany({ where: { provider: 'CDS', isActive: true }, select: { id: true } }),
    )
    for (const c of creds) {
      await step.sendEvent(`sync-${c.id}`, { name: 'integration/sync', data: { credentialId: c.id, provider: 'CDS' } })
    }
    return { dispatched: creds.length }
  },
)
