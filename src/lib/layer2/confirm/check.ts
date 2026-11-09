// Whether a confirmation is admissible, before anything is written. Pure.
import { confirmFieldMessage, validateConfirmFields, type ConfirmFieldError } from '../confirm-validation'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { isCbamFieldName } from '@/lib/nucleos/cbam-fields'
import { missingCbamDocumentDate } from '@/lib/review/review-policy'
import type { ConfirmRequest } from './request'

/**
 * Every field that cannot be saved, and why. Empty when all can.
 *
 * Nothing is written until the whole payload is admissible. A confirmation is
 * the point at which a probabilistic extraction becomes a permanent chained
 * record, so a value that cannot be parsed, a period that runs backwards, a
 * field this document type does not have, or a unit that could never be
 * converted are all refusals — not fields to quietly drop.
 */
export function confirmFieldErrors(
  documentType: string,
  cbamDocument: boolean,
  fields: ConfirmRequest['fields'],
): ConfirmFieldError[] {
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[documentType] ?? []
  // A CBAM document's field names are generated, one set per goods line, so no
  // fixed definition list can contain them. Checking them against the customs
  // declaration's list rejected every one as a field Arbor does not read — which
  // is why no Nucleos-extracted document could be confirmed at all.
  const knownFieldNames = new Set(fieldDefs.map(f => f.name))

  const fieldErrors = validateConfirmFields(fields, {
    // Empty means "no definition on file", which the validator reads as "do not
    // check names". That is the right behaviour for a CBAM document: its names
    // are checked against the CBAM vocabulary below instead.
    knownFieldNames: cbamDocument ? new Set<string>() : knownFieldNames,
  })
  if (cbamDocument) {
    for (const field of fields) {
      if (!isCbamFieldName(field.fieldName) && !knownFieldNames.has(field.fieldName)) {
        fieldErrors.push({
          fieldName: field.fieldName,
          problem: 'unknown_field',
          message: 'This is not a field Arbor reads from this kind of document.',
        })
      }
    }
  }
  return fieldErrors
}

/**
 * Everything the reviewer confirmed, measurements and identifiers together.
 * The tier and the case are both decided from the effective document, so both
 * need the whole picture rather than the record-producing half of it.
 */
export function confirmedValuesOf(request: ConfirmRequest): Map<string, string> {
  return new Map<string, string>([
    ...(request.context ?? []).map(c => [c.fieldName, c.confirmedValue] as const),
    // Measured values win if a client sends a field in both lists, because
    // these are the ones that were validated and written.
    ...request.fields.map(f => [f.fieldName, f.confirmedValue] as const),
  ])
}

/**
 * The refusal for a CBAM document that does not date itself, or null.
 *
 * A CBAM case is filed for the quarter its period ends in, so a CBAM document
 * must date itself. Without a date the period fell back to the day of review
 * and the case to that quarter, silently. Refused here so the records and the
 * case get the same, right period, rather than the case being corrected later
 * under records that stay wrong.
 */
export function missingDocumentDateError(
  documentType: string,
  cbamDocument: boolean,
  confirmedValues: Map<string, string>,
): ConfirmFieldError | null {
  if (!cbamDocument || !missingCbamDocumentDate(documentType, Object.fromEntries(confirmedValues)))
    return null
  return {
    fieldName: 'import_date',
    problem: 'missing_document_date',
    message: confirmFieldMessage('missing_document_date'),
  }
}
