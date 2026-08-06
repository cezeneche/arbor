// Coverage of the dictionary against what the ingestion pipeline can actually
// store — not against a flat list of field names.
//
// The existing catalogue test checks that every name in NUMERIC_FIELDS has a
// definition. That is necessary but not sufficient: definitions are keyed on
// (fieldName, domain), so a field can be fully "covered" by name and still
// resolve to nothing because the domain the pipeline writes differs from the
// domain the catalogue assumed. That is exactly what happened in production —
// declared_weight was defined under COMPLIANCE and stored under LOGISTICS, so
// two of three live records exported with no agreed meaning.
//
// These tests reconstruct the real write path — document type → domain → the
// numeric fields that document yields — and assert a definition exists for every
// pair it can produce.

import { SEED_DEFINITIONS } from '../catalogue'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'
import { docTypeToDomain } from '@/lib/layer3/compulsory-fields'
import { NUMERIC_FIELDS } from '@/lib/review/review-policy'

/** Every (fieldName, domain) pair a confirmed document can write to the store. */
function storablePairs(): { documentType: string; fieldName: string; domain: string }[] {
  const pairs: { documentType: string; fieldName: string; domain: string }[] = []
  for (const [documentType, fields] of Object.entries(DOCUMENT_FIELD_DEFINITIONS)) {
    // The review UI derives the domain from this map at confirm time, so it is
    // the authority on what actually lands in the database.
    const domain = DOMAIN_BY_DOCUMENT_TYPE[documentType]
    if (!domain) continue
    for (const f of fields) {
      if (!NUMERIC_FIELDS.has(f.name)) continue
      pairs.push({ documentType, fieldName: f.name, domain })
    }
  }
  return pairs
}

describe('dictionary covers every storable (fieldName, domain) pair', () => {
  it('defines a wording for every pair the ingestion pipeline can write', () => {
    const defined = new Set(SEED_DEFINITIONS.map(d => `${d.domain} ${d.fieldName}`))
    const missing = storablePairs()
      .filter(p => !defined.has(`${p.domain} ${p.fieldName}`))
      .map(p => `${p.documentType}: ${p.fieldName} stored under ${p.domain}`)

    // Deduplicated for a readable failure message.
    expect([...new Set(missing)]).toEqual([])
  })

  it('has no definition for a pair the pipeline can never produce', () => {
    // A wording filed under a domain nothing writes to is dead weight and, worse,
    // looks like coverage while providing none.
    const storable = new Set(storablePairs().map(p => `${p.domain} ${p.fieldName}`))
    const orphaned = SEED_DEFINITIONS.filter(
      d => !storable.has(`${d.domain} ${d.fieldName}`),
    ).map(d => `${d.fieldName} defined under ${d.domain}`)

    expect(orphaned).toEqual([])
  })
})

describe('the two document-type → domain maps agree', () => {
  // DOMAIN_BY_DOCUMENT_TYPE (constants, write path) and DOC_TYPE_TO_DOMAIN
  // (layer3/compulsory-fields, read path) are duplicates that drifted. Whichever
  // domain is judged correct for a document type, the two must not disagree —
  // a record written under one and interpreted under the other is the defect.
  it('assigns each document type the same domain on the write and read paths', () => {
    const conflicts = Object.keys(DOMAIN_BY_DOCUMENT_TYPE)
      .map(docType => ({
        docType,
        write: DOMAIN_BY_DOCUMENT_TYPE[docType] as string,
        read: docTypeToDomain(docType),
      }))
      // Only compare where the read path has an opinion.
      .filter(r => r.read !== null && r.read !== r.write)
      .map(r => `${r.docType}: written as ${r.write}, read as ${r.read}`)

    expect(conflicts).toEqual([])
  })
})
