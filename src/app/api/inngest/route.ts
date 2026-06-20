import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { extractDocumentFunction } from '@/inngest/functions/extract-document'
import { checkCertificateExpiryFunction } from '@/inngest/functions/check-certificate-expiry'
import { deliverWebhookFunction } from '@/inngest/functions/deliver-webhook'
import { processInboundEmailFunction } from '@/inngest/functions/process-inbound-email'
import { syncIntegrationFunction, syncCdsDailyFunction } from '@/inngest/functions/sync-integrations'
import { weeklyReviewDigestFunction } from '@/inngest/functions/weekly-review-digest'
import { parseInboundRequestFunction } from '@/inngest/functions/parse-inbound-request'

export const runtime = 'nodejs'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    extractDocumentFunction,
    checkCertificateExpiryFunction,
    deliverWebhookFunction,
    processInboundEmailFunction,
    syncIntegrationFunction,
    syncCdsDailyFunction,
    weeklyReviewDigestFunction,
    parseInboundRequestFunction,
  ],
})
