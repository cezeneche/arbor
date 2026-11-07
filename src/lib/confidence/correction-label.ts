// A supplier correcting a machine-read value from Review is the same signal as a
// reviewer correcting it before it was saved, so it becomes a review label that
// calibration, the accuracy monitor and the relearning extractor all read.
//
// Built from what the model actually extracted for that field and how sure it
// was (the document's latest extraction), not from the stored record: a record
// confirmed in review carries confidence 1.0, which would teach calibration
// nothing. When the model never read the field there is nothing to learn from.
import type { DataDomain, GroundTruthSource } from '@prisma/client'
import { buildGroundTruthLabel } from './ground-truth'

export interface CorrectionLabelStore {
  document: {
    findUnique(args: {
      where: { id: string }
      select: {
        documentType: true
        extractionJobs: {
          orderBy: { completedAt: 'desc' }
          take: 1
          select: {
            documentClass: true
            extractorVersion: true
            extractedFields: {
              where: { fieldName: string }
              select: { rawValue: true; confidenceScore: true }
            }
          }
        }
      }
    }): Promise<{
      documentType: string
      extractionJobs: {
        documentClass: string | null
        extractorVersion: string | null
        extractedFields: { rawValue: string | null; confidenceScore: number }[]
      }[]
    } | null>
  }
  groundTruthLabel: {
    create(args: {
      data: {
        entityId: string
        documentId: string | null
        recordId: string | null
        fieldName: string
        documentClass: string
        domain: DataDomain
        extractedValue: string | null
        confirmedValue: string | null
        wasCorrect: boolean
        confidenceAtExtraction: number
        source: GroundTruthSource
        expectedInformationGain: number | null
        lowInformation: boolean | null
        extractorVersion: string | null
      }
      select: { id: true }
    }): Promise<{ id: string }>
  }
}

export async function captureCorrectionLabel(
  db: CorrectionLabelStore,
  input: {
    entityId: string
    documentId: string
    fieldName: string
    domain: string
    newRecordId: string
    correctedValue: number
  },
): Promise<boolean> {
  const document = await db.document.findUnique({
    where: { id: input.documentId },
    select: {
      documentType: true,
      extractionJobs: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: {
          documentClass: true,
          extractorVersion: true,
          extractedFields: {
            where: { fieldName: input.fieldName },
            select: { rawValue: true, confidenceScore: true },
          },
        },
      },
    },
  })
  const job = document?.extractionJobs[0]
  const extracted = job?.extractedFields[0]
  if (!document || !job || !extracted) return false

  const label = buildGroundTruthLabel({
    entityId: input.entityId,
    documentId: input.documentId,
    recordId: input.newRecordId,
    fieldName: input.fieldName,
    documentClass: job.documentClass ?? document.documentType,
    domain: input.domain,
    extractedValue: extracted.rawValue,
    confirmedValue: String(input.correctedValue),
    confidenceAtExtraction: extracted.confidenceScore,
    extractorVersion: job.extractorVersion,
  })
  await db.groundTruthLabel.create({
    data: {
      ...label,
      domain: label.domain as DataDomain,
      source: label.source as GroundTruthSource,
    },
    select: { id: true },
  })
  return true
}
