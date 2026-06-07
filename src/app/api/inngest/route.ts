import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { extractDocumentFunction } from '@/inngest/functions/extract-document'
import { checkCertificateExpiryFunction } from '@/inngest/functions/check-certificate-expiry'

export const runtime = 'nodejs'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [extractDocumentFunction, checkCertificateExpiryFunction],
})
