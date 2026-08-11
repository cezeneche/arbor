// Documents already in Arbor that a CBAM case can be built from.
//
// A customs declaration uploaded last month is the same document a CBAM case
// needs this month. Making the user upload it again produces a second copy of
// the same evidence, with its own extraction and its own audit trail — two
// records of one real-world document, which is exactly what a certified
// repository should never hold.
//
// So the case flow offers both: upload something new, or point at what is
// already here.

import { CBAM_RELEVANT_DOCUMENT_TYPES } from './cbam-relevance'

/** Statuses a document must have reached before it can back a CBAM case. */
const USABLE_STATUSES = new Set(['REVIEW_REQUIRED', 'ACCEPTED'])

export interface DocumentSummary {
  id: string
  fileName: string
  documentType: string
  status: string
  submittedAt: string | Date
}

export interface ReusableDocument extends DocumentSummary {
  /** True when this document has already produced CBAM fields. */
  alreadyExtracted: boolean
}

/**
 * Which of an entity's documents can back a CBAM case.
 *
 * Rejected and still-extracting documents are excluded: one has no usable
 * content, the other has none *yet*, and offering either invites the user to
 * start a case on something that will never produce goods lines.
 */
export function selectReusableDocuments(
  documents: (DocumentSummary & { hasCbamFields?: boolean })[],
): ReusableDocument[] {
  return documents
    .filter(d => CBAM_RELEVANT_DOCUMENT_TYPES.has(String(d.documentType).toUpperCase()))
    .filter(d => USABLE_STATUSES.has(String(d.status).toUpperCase()))
    .map(d => ({
      id: d.id,
      fileName: d.fileName,
      documentType: d.documentType,
      status: d.status,
      submittedAt: d.submittedAt,
      alreadyExtracted: Boolean(d.hasCbamFields),
    }))
}

/** How a document reads in the picker. */
export function describeDocument(doc: ReusableDocument): string {
  const type = doc.documentType.replace(/_/g, ' ').toLowerCase()
  const when =
    doc.submittedAt instanceof Date
      ? doc.submittedAt.toISOString().slice(0, 10)
      : String(doc.submittedAt).slice(0, 10)
  return `${doc.fileName} · ${type} · ${when}`
}
