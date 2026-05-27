export interface ExtractionInput {
  documentBase64: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
  documentType: string
  entityName: string
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
}
