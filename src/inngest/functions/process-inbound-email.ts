import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { put } from '@vercel/blob'
import { getSystemUser } from '@/lib/layer2/system-actor'

// Gap 8.4 — process an inbound email forwarded by the email provider (Postmark /
// SendGrid inbound parse). Attachments become Document records and are sent
// through the standard extraction pipeline. Unknown tokens are silently dropped
// to prevent enumeration.
interface InboundAttachment {
  name: string
  contentType: string
  contentBase64: string
}

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png'])

export const processInboundEmailFunction = inngest.createFunction(
  { id: 'process-inbound-email', retries: 2, concurrency: { limit: 5 }, triggers: [{ event: 'email/inbound' }] },
  async ({ event, step }) => {
    const { entityToken, attachments } = event.data as {
      entityToken: string
      fromEmail?: string
      attachments: InboundAttachment[]
    }

    const entity = await step.run('resolve-entity', async () =>
      prisma.entity.findUnique({ where: { uploadEmailToken: entityToken }, select: { id: true, legalName: true } }),
    )
    if (!entity) return { dropped: true, reason: 'unknown_token' }

    // The email has no human to pick a document type; default to OTHER and let
    // the reviewer reclassify. Each attachment is a separate document + job.
    const created: string[] = []
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i]
      if (!ALLOWED.has(att.contentType)) continue

      const docId = await step.run(`store-attachment-${i}`, async () => {
        const systemUser = await getSystemUser(entity.id)
        const buffer = Buffer.from(att.contentBase64, 'base64')
        const ext = att.contentType === 'application/pdf' ? 'pdf' : att.contentType === 'image/png' ? 'png' : 'jpg'
        const blob = await put(`documents/${entity.id}/${Date.now()}-${i}.${ext}`, buffer, {
          access: 'public',
          contentType: att.contentType,
        })
        const doc = await prisma.document.create({
          data: {
            entityId: entity.id,
            fileName: att.name,
            fileType: att.contentType,
            documentType: 'OTHER',
            blobUrl: blob.url,
            submittedById: systemUser.id,
            status: 'PENDING',
          },
          select: { id: true },
        })
        return doc.id
      })
      created.push(docId)

      await step.sendEvent(`extract-${i}`, {
        name: 'document/uploaded',
        data: {
          documentId: docId,
          entityId: entity.id,
          entityName: entity.legalName,
          documentType: 'OTHER',
        },
      })
    }

    return { entityId: entity.id, documentsCreated: created.length }
  },
)
