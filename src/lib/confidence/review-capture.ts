// Label capture from the review flow (Upgrade 1, minimal slice). Pure: no DB.
//
// At document confirmation we compare each field the reviewer confirmed against
// what the model originally extracted, emitting one GroundTruthLabel per
// AI-extracted field — the training signal POST /calibration/fit fits against.
//
// Captures every reviewed AI field, numeric or not: the model's correctness on
// a string identity field is as much calibration signal as on a mass reading,
// and identity is the plan's first kill-signal type. Fields the model never
// extracted (pure manual entry) carry no signal and are skipped.

import { buildGroundTruthLabel, type GroundTruthLabelInput } from './ground-truth'

export interface ExtractedFieldLite {
  fieldName: string
  rawValue: string | null
  /** The model's uncalibrated score for this field at extraction time. */
  confidenceScore: number
}

export interface ConfirmedFieldLite {
  fieldName: string
  confirmedValue: string
  domain: string
}

export interface BuildReviewLabelsInput {
  entityId: string
  documentId: string | null
  /** Typed DocumentType value, or the schema-on-read class for GENERIC docs. */
  documentClass: string
  extractedFields: ExtractedFieldLite[]
  confirmedFields: ConfirmedFieldLite[]
  /** fieldName -> the DataRecord id written for it, when one was (numeric fields). */
  recordIdByField?: Record<string, string | null>
}

export function buildReviewLabels(input: BuildReviewLabelsInput): GroundTruthLabelInput[] {
  const extractedByName = new Map(input.extractedFields.map(f => [f.fieldName, f]))
  const labels: GroundTruthLabelInput[] = []

  for (const confirmed of input.confirmedFields) {
    const extracted = extractedByName.get(confirmed.fieldName)
    if (!extracted) continue // no AI extraction for this field → no calibration signal

    labels.push(
      buildGroundTruthLabel({
        entityId: input.entityId,
        documentId: input.documentId,
        recordId: input.recordIdByField?.[confirmed.fieldName] ?? null,
        fieldName: confirmed.fieldName,
        documentClass: input.documentClass,
        domain: confirmed.domain,
        extractedValue: extracted.rawValue,
        confirmedValue: confirmed.confirmedValue,
        confidenceAtExtraction: extracted.confidenceScore,
      }),
    )
  }

  return labels
}
