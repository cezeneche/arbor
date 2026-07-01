import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { extractDocumentWithConsistency, detectLanguage, assessImageQuality } from '@/lib/extraction/engine'
import { evaluateAdmissibility } from '@/lib/extraction/admissibility'
import { fetchDocumentAsBase64 } from '@/lib/storage-retrieval'
import { sendNotification } from '@/lib/notifications'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { MIN_EXTRACTABLE_QUALITY } from '@/lib/extraction/types'
import type { ExtractedFieldResult } from '@/lib/extraction/types'
import { shouldAutoAccept } from '@/lib/review/review-policy'
import { autoAcceptDocument } from '@/lib/layer2/auto-accept'
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

    // Gap 1 — cheap pre-calls before committing to full extraction.
    const detectedLanguage = await step.run('detect-language', async () => {
      const { language } = await detectLanguage(base64, mediaType)
      return language
    })

    const quality = await step.run('assess-image-quality', async () => {
      return assessImageQuality(base64, mediaType)
    })

    // Below the floor, do not attempt extraction — ask the user to re-upload.
    if (quality.quality < MIN_EXTRACTABLE_QUALITY) {
      await step.run('reject-low-quality', async () => {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            detectedLanguage,
            imageQualityScore: quality.quality,
            imageQualityIssues: quality.issues as unknown as Prisma.InputJsonValue,
            errorMessage:
              'Image quality too low for reliable extraction. Upload a clearer version of this document.',
          },
        })
        await prisma.document.update({ where: { id: documentId }, data: { status: 'REVIEW_REQUIRED' } })
      })
      return { success: false, reason: 'low_quality', quality: quality.quality }
    }

    const extractionResult = await step.run('run-extraction', async () => {
      return extractDocumentWithConsistency({ documentBase64: base64, mediaType, documentType, entityName, detectedLanguage })
    })

    if (!extractionResult.success) {
      await step.run('mark-failed', async () => {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: extractionResult.extractionNotes,
            detectedLanguage,
            imageQualityScore: quality.quality,
            // Persist the raw model response on failure too — without it, a parse
            // failure leaves nothing to debug (this is exactly what bit us).
            rawOutput: extractionResult as unknown as Prisma.InputJsonValue,
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
      { detectedLanguage, imageQualityScore: quality.quality },
    )

    await step.run('store-extracted-fields', async () => {
      const defs = DOCUMENT_FIELD_DEFINITIONS[documentType] ?? []
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
          detectedLanguage,
          imageQualityScore: quality.quality,
          imageQualityIssues: quality.issues as unknown as Prisma.InputJsonValue,
          documentClass: extractionResult.documentClass ?? null,
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

    // Core 4 — low-stakes documents with no critical flags are auto-accepted as
    // Tier B (Declared) so a record exists immediately. High-stakes types and any
    // document with a critical flag stay in REVIEW_REQUIRED for per-document review.
    let autoAcceptedCount = 0
    if (shouldAutoAccept(documentType, admissibility.criticalCount)) {
      autoAcceptedCount = await step.run('auto-accept-low-stakes', async () => {
        const ids = await autoAcceptDocument(documentId)
        return ids.length
      })
    }

    await step.run('send-notification', async () => {
      await sendNotification({
        entityId,
        type: 'EXTRACTION_COMPLETE',
        payload: {
          documentId,
          documentType,
          // Auto-accepted records are written as Tier B (Declared).
          tier: autoAcceptedCount > 0 ? 'B' : admissibility.tier,
          flagCount: admissibility.flags.length,
          criticalCount: admissibility.criticalCount,
        },
      })
    })

    return { success: true, jobId: job.id, tier: admissibility.tier, autoAcceptedCount }
  },
)
