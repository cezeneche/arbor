import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'

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
