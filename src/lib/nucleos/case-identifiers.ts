// The identifiers a CBAM case still needs after its document was confirmed.
//
// A case cannot be opened without the importer's EORI, and a goods line cannot
// be declared without its commodity code. When either was missing at
// confirmation, the handoff used to fail and be retried with the same stored
// input until the sweep gave up — while the confirm route, rightly, refused a
// second confirmation. So the handoff now waits, and the user supplies what is
// missing here.
//
// Identifiers only. A weight or an emissions figure is a certified record, and
// supplying one here would put a number on the return that was never confirmed
// against the document. And gaps only: a value the reviewer confirmed cannot be
// overwritten by a later form.
//
// Pure. No I/O.

import { goodsLineFieldName, parseGoodsLineFieldName } from './cbam-fields'

export interface CaseIdentifierNeed {
  fieldName: string
  label: string
}

export interface CaseIdentifierAmendment {
  fieldName: string
  value: string
}

export interface AmendResult {
  /** The confirmed values with the amendments applied; null when any was refused. */
  confirmed: Map<string, string> | null
  errors: { fieldName: string; message: string }[]
}

const has = (m: ReadonlyMap<string, string>, key: string) => (m.get(key) ?? '').trim() !== ''

/** What the case is missing that a person can supply. */
export function missingCaseIdentifiers(confirmed: ReadonlyMap<string, string>): CaseIdentifierNeed[] {
  const needs: CaseIdentifierNeed[] = []
  if (!has(confirmed, 'importer_eori')) needs.push({ fieldName: 'importer_eori', label: 'Importer EORI' })

  const lines = new Set<number>()
  for (const name of confirmed.keys()) {
    const ref = parseGoodsLineFieldName(name)
    if (ref) lines.add(ref.lineIndex)
  }
  for (const i of [...lines].sort((a, b) => a - b)) {
    // Only a line whose weight was certified can reach the case once coded.
    if (!has(confirmed, goodsLineFieldName(i, 'net_mass_kg'))) continue
    if (!has(confirmed, goodsLineFieldName(i, 'cn_code'))) {
      needs.push({ fieldName: goodsLineFieldName(i, 'cn_code'), label: `Commodity code for goods line ${i + 1}` })
    }
  }
  return needs
}

// An EORI is a two-letter country code and up to fifteen further characters.
const EORI = /^[A-Z]{2}[A-Z0-9]{1,15}$/

function normalise(fieldName: string, raw: string): { value: string } | { message: string } {
  if (fieldName === 'importer_eori') {
    const value = raw.replace(/\s+/g, '').toUpperCase()
    return EORI.test(value)
      ? { value }
      : { message: 'An EORI starts with two letters for the country, then up to 15 letters or digits.' }
  }
  const value = raw.replace(/[\s.]/g, '')
  return /^\d{8}$/.test(value)
    ? { value }
    : { message: 'A commodity code for CBAM has eight digits. A six-digit heading is not enough.' }
}

export function amendCaseIdentifiers(
  confirmed: ReadonlyMap<string, string>,
  amendments: readonly CaseIdentifierAmendment[],
): AmendResult {
  if (amendments.length === 0) {
    return { confirmed: null, errors: [{ fieldName: '', message: 'Nothing was entered.' }] }
  }
  const askable = new Set(missingCaseIdentifiers(confirmed).map(n => n.fieldName))
  const next = new Map(confirmed)
  const errors: AmendResult['errors'] = []

  for (const { fieldName, value } of amendments) {
    if (has(confirmed, fieldName)) {
      errors.push({ fieldName, message: 'This was already confirmed from the document and cannot be changed here.' })
      continue
    }
    if (!askable.has(fieldName)) {
      errors.push({ fieldName, message: 'This is not something the case is waiting for.' })
      continue
    }
    const result = normalise(fieldName, value)
    if ('message' in result) {
      errors.push({ fieldName, message: result.message })
      continue
    }
    next.set(fieldName, result.value)
  }

  return errors.length > 0 ? { confirmed: null, errors } : { confirmed: next, errors: [] }
}
