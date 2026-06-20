export interface ExtractionInput {
  documentBase64: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
  documentType: string
  entityName: string
  /** ISO 639-1 code from the language-detection pre-call; calibrates the prompt. */
  detectedLanguage?: string | null
}

export interface ExtractedFieldResult {
  fieldName: string
  rawValue: string | null
  rawUnit: string | null
  sourceText: string
  confidenceScore: number
  flagged: boolean
  flagReason: string | null
}

export interface ExtractionResult {
  success: boolean
  fields: ExtractedFieldResult[]
  documentTypeConfirmed: string
  extractionNotes: string
  rawResponse: string
  /** Set when the document was detected as non-English. Surfaced in the review UI. */
  languageNote: string | null
}

// Gap 1 — result of the cheap language-detection pre-call.
export interface LanguageDetectionResult {
  /** ISO 639-1 code, or 'unknown' if detection failed or was ambiguous. */
  language: string
}

// Gap 1 — result of the image quality pre-call (images only; PDFs skip this).
export interface QualityAssessmentResult {
  /** 1 (unreadable) to 5 (clear). */
  quality: number
  issues: string[]
}

/** Below this score, extraction is not attempted — the user is asked to re-upload. */
export const MIN_EXTRACTABLE_QUALITY = 2
/** At or below this score, a degraded-image warning is surfaced in the review UI. */
export const DEGRADED_QUALITY_THRESHOLD = 4
