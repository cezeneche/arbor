import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { extractDocument } from '@/lib/extraction/engine'
import { evaluateAdmissibility } from '@/lib/extraction/admissibility'
import { fetchDocumentAsBase64 } from '@/lib/storage-retrieval'
import { sendNotification } from '@/lib/notifications'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import type { ExtractedFieldResult } from '@/lib/extraction/types'
import type { Prisma } from '@prisma/client'

export const extractDocumentFunction = inngest.createFunction(
  {
    id: 'extract-document',
    retries: 2,
    concurrency: { limit: 5 },
    triggers: [{ event: 'document/uploaded' }],
  },
  async ({ event, step }) => {
    const { documentId, entityId, entityName, documentType, reportingPeriodEnd } = event.data as {
      documentId: string
      entityId: string
      entityName: string
      documentType: string
      reportingPeriodEnd?: string
    }

    const job = await step.run('create-extraction-job', async () => {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'EXTRACTING' },
      })
      return prisma.extractionJob.create({
        data: { documentId, status: 'RUNNING', startedAt: new Date() },
      })
    })

    const { base64, mediaType } = await step.run('fetch-document', async () => {
      const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } })
      return fetchDocumentAsBase64(doc.blobUrl)
    })

    const extractionResult = await step.run('run-extraction', async () => {
      return extractDocument({ documentBase64: base64, mediaType, documentType, entityName })
    })

    if (!extractionResult.success) {
      await step.run('mark-failed', async () => {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: extractionResult.extractionNotes,
          },
        })
        await prisma.document.update({ where: { id: documentId }, data: { status: 'REJECTED' } })
      })
      return { success: false }
    }

    const admissibility = evaluateAdmissibility(
      documentType,
      extractionResult.fields,
      entityName,
      reportingPeriodEnd ? new Date(reportingPeriodEnd) : undefined,
    )

    await step.run('store-extracted-fields', async () => {
      const defs = DOCUMENT_FIELD_DEFINITIONS[documentType] ?? []
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
          rawOutput: extractionResult as unknown as Prisma.InputJsonValue,
          extractedFields: {
            create: extractionResult.fields.map((f: ExtractedFieldResult) => {
              const def = defs.find((d) => d.name === f.fieldName)
              return {
                fieldName: f.fieldName,
                admissibility:
                  def?.admissibility === 'compulsory'
                    ? 'COMPULSORY'
                    : def?.admissibility === 'conditional'
                      ? 'CONDITIONAL'
                      : 'OPTIONAL',
                rawValue: f.rawValue,
                rawUnit: f.rawUnit,
                sourceText: f.sourceText,
                confidenceScore: f.confidenceScore,
                flagged: f.flagged,
                flagReason: f.flagReason,
              }
            }),
          },
        },
      })
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'REVIEW_REQUIRED' },
      })
    })

    await step.run('send-notification', async () => {
      await sendNotification({
        entityId,
        type: 'EXTRACTION_COMPLETE',
        payload: {
          documentId,
          documentType,
          tier: admissibility.tier,
          flagCount: admissibility.flags.length,
          criticalCount: admissibility.criticalCount,
        },
      })
    })

    return { success: true, jobId: job.id, tier: admissibility.tier }
  },
)
