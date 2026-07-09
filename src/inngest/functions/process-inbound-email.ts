import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { getSystemUser } from '@/lib/layer2/system-actor'
import { storeDocumentBytes } from '@/lib/storage'
import { selectInboundAttachments, type RawInboundAttachment } from '@/lib/upload/inbound-attachments'
import { DOCUMENT_MAX_BYTES, MAX_INBOUND_ATTACHMENTS } from '@/lib/constants'

// process an inbound email forwarded by the email provider (Postmark /
// SendGrid inbound parse). Attachments become Document records and are sent
// through the standard extraction pipeline. Unknown tokens are silently dropped
// to prevent enumeration.
export const processInboundEmailFunction = inngest.createFunction(
  { id: 'process-inbound-email', retries: 2, concurrency: { limit: 5 }, triggers: [{ event: 'email/inbound' }] },
  async ({ event, step }) => {
    const { entityToken, attachments } = event.data as {
      entityToken: string
      fromEmail?: string
      attachments: RawInboundAttachment[]
    }

    const entity = await step.run('resolve-entity', async () =>
      prisma.entity.findUnique({ where: { uploadEmailToken: entityToken }, select: { id: true, legalName: true } }),
    )
    if (!entity) return { dropped: true, reason: 'unknown_token' }

    // The provider's declared contentType is attacker-controlled, so validate by
    // magic bytes and cap size/count before storing anything (same as the browser
    // upload path). Rejected attachments are simply dropped.
    const accepted = selectInboundAttachments(attachments ?? [], {
      maxCount: MAX_INBOUND_ATTACHMENTS,
      maxBytes: DOCUMENT_MAX_BYTES,
    })

    // The email has no human to pick a document type; default to OTHER and let
    // the reviewer reclassify. Each attachment is a separate document + job.
    const created: string[] = []
    for (let i = 0; i < accepted.length; i++) {
      const att = accepted[i]

      const docId = await step.run(`store-attachment-${i}`, async () => {
        const systemUser = await getSystemUser(entity.id)
        // Private bucket (bearer-token retrieval) — never public blob storage.
        const { url } = await storeDocumentBytes(att.bytes, entity.id, att.type)
        const doc = await prisma.document.create({
          data: {
            entityId: entity.id,
            fileName: att.name,
            fileType: att.type,
            documentType: 'OTHER',
            blobUrl: url,
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
