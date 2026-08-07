import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'
import { NUMERIC_FIELDS } from '@/lib/review/review-policy'

// Layer 3 — read-only reference. Derives, per data domain, the set of compulsory
// field names from the admissibility definitions. This reads Layer 1 constants
// only; it runs no extraction and writes nothing. Used to report which compulsory
// fields are absent from records already in the database.
//
// This module used to keep its own document-type → domain table. It drifted from
// the one the review UI writes with (customs declarations were written as
// LOGISTICS and read as COMPLIANCE), which meant records were interpreted under a
// domain they were never stored in — and, once definitions arrived, resolved to no
// agreed meaning at all. There is now exactly one map, in constants, and
// catalogue-coverage.test.ts fails if a storable field/domain pair loses its
// definition.

export function docTypeToDomain(docType: string): string | null {
  return DOMAIN_BY_DOCUMENT_TYPE[docType] ?? null
}

/**
 * Compulsory fields, per document type, restricted to those that can actually
 * become records.
 *
 * Two rules, both learned from a metric that told a company with two clean
 * documents it was missing 110 compulsory fields:
 *
 *  - Compulsory-ness belongs to a *document type*, not a domain. Unioning a
 *    domain's document types marks a freight invoice as missing bill-of-lading
 *    fields and an electricity bill as missing REGO certificate fields.
 *  - A DataRecord holds a number. Compulsory text fields — account holder,
 *    site address, supplier name — are collected and checked at ingest, but
 *    can never appear here, so counting their absence is counting nothing.
 */
export function getCompulsoryStorableFieldsByDocumentType(): Record<string, string[]> {
  const byType: Record<string, string[]> = {}
  for (const [docType, defs] of Object.entries(DOCUMENT_FIELD_DEFINITIONS)) {
    const fields = defs
      .filter(d => d.admissibility === 'compulsory' && NUMERIC_FIELDS.has(d.name))
      .map(d => d.name)
    byType[docType] = [...new Set(fields)]
  }
  return byType
}

/**
 * What this record set can honestly be held to: the compulsory storable fields
 * of the document types actually submitted. Records with no document behind
 * them expect nothing — manual entry has no admissibility spec to fail.
 */
export function expectedFieldsFor(
  documentTypes: (string | null | undefined)[],
  byType: Record<string, string[]>,
): string[] {
  const expected = new Set<string>()
  for (const docType of documentTypes) {
    if (!docType) continue
    for (const field of byType[docType] ?? []) expected.add(field)
  }
  return [...expected]
}

export function getCompulsoryFieldsByDomain(): Record<string, string[]> {
  const byDomain: Record<string, string[]> = {}
  for (const [docType, defs] of Object.entries(DOCUMENT_FIELD_DEFINITIONS)) {
    const domain = docTypeToDomain(docType)
    if (!domain) continue
    if (!byDomain[domain]) byDomain[domain] = []
    for (const d of defs) {
      if (d.admissibility === 'compulsory' && !byDomain[domain].includes(d.name)) {
        byDomain[domain].push(d.name)
      }
    }
  }
  return byDomain
}
