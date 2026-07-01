// Core 3 — Broader document taxonomy (schema-on-read).
// The GENERIC ingestion path: when a document has no admissibility spec (type is
// OTHER or unknown), the extractor returns whatever key/value fields it finds plus
// a best-guess documentClass. These are pure Layer 1 helpers — no DB, no AI calls.

import { DOCUMENT_FIELD_DEFINITIONS } from './field-definitions'
import { parseLooseJson } from './parse-json'
import type { ExtractedFieldResult } from './types'

/** True when the document type has no fixed admissibility spec to validate against. */
export function isGenericExtraction(documentType: string): boolean {
  return documentType === 'OTHER' || !(documentType in DOCUMENT_FIELD_DEFINITIONS)
}

export function buildGenericExtractionPrompt(): string {
  return `This document does not match any known template. First, identify what kind of document it is. Then extract every labelled value you can find as a key/value pair.

Return this exact JSON structure with no other text:
{
  "documentClass": "a short lower_snake_case guess at the document kind (e.g. lease_agreement, payroll_summary, lab_report, insurance_certificate, training_record, waste_transfer_note)",
  "extractionNotes": "observations about the document",
  "fields": [
    {
      "fieldName": "lower_snake_case label for the value",
      "rawValue": "value exactly as written, or null",
      "rawUnit": "unit exactly as written, or null",
      "sourceText": "exact verbatim text containing this value",
      "confidenceScore": 0.95,
      "flagged": false,
      "flagReason": null
    }
  ]
}

Use clear, stable snake_case fieldNames so the same field in a similar document maps consistently. Extract numeric quantities together with their units. Never invent a field that is not present in the document.`
}

export interface GenericExtractionParse {
  success: boolean
  documentClass: string | null
  fields: ExtractedFieldResult[]
  notes: string
}

export function parseGenericExtractionResponse(rawText: string): GenericExtractionParse {
  try {
    const parsed = parseLooseJson(rawText) as {
      documentClass?: string
      extractionNotes?: string
      fields?: ExtractedFieldResult[]
    }
    return {
      success: true,
      documentClass: typeof parsed.documentClass === 'string' ? parsed.documentClass : null,
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
      notes: parsed.extractionNotes ?? '',
    }
  } catch {
    return {
      success: false,
      documentClass: null,
      fields: [],
      notes: 'Could not parse generic extraction response as JSON',
    }
  }
}
