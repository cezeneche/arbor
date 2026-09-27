// What Arbor read from a document, as evidence Nucleos files against the case.
// Pure.
//
// "Why this number?" reads this back: the value on the case, the text on the
// document it came from, how confident the reading was, and whether a person
// corrected it. Keyed to Nucleos's own goods-line ids, because a case gathers
// lines from several documents and "lines[0]" of two of them are different
// goods; identifiers the whole document states are keyed to the case.

import type { EvidenceAtom } from './contract'
import { isCbamFieldName, isCbamNumericFieldName, parseGoodsLineFieldName } from './cbam-fields'

/** One field as extraction read it, kept at confirmation. */
export interface ReadField {
  fieldName: string
  extractedValue: string | null
  sourceText: string | null
  confidence: number
}

const SNIPPET_MAX = 1000

function toNumber(raw: string | null | undefined): number {
  const cleaned = String(raw ?? '').replace(/[\s,]/g, '')
  return cleaned === '' ? NaN : Number(cleaned)
}

// "24 500" read and "24500" confirmed are one figure, not a correction.
function sameValue(a: string | null | undefined, b: string | null | undefined, numeric: boolean): boolean {
  if (numeric) {
    const x = toNumber(a)
    const y = toNumber(b)
    if (Number.isFinite(x) && Number.isFinite(y)) return x === y
  }
  return (a ?? '').trim() === (b ?? '').trim()
}

export function buildCaseEvidence(input: {
  readFields: readonly ReadField[]
  /** Field name → the value confirmed on review. */
  confirmed: Readonly<Record<string, string>>
  /** Line index in the document → the Nucleos goods line it became. */
  lineIds: Readonly<Record<string, string>>
}): EvidenceAtom[] {
  const atoms: EvidenceAtom[] = []
  for (const read of input.readFields) {
    const snippet = (read.sourceText ?? '').trim()
    if (!snippet || !isCbamFieldName(read.fieldName)) continue

    const ref = parseGoodsLineFieldName(read.fieldName)
    let field: string
    if (ref) {
      const goodsLineId = input.lineIds[String(ref.lineIndex)]
      if (!goodsLineId) continue
      field = `goods_lines.${goodsLineId}.${ref.field}`
    } else {
      field = `case.${read.fieldName}`
    }

    // A measured quantity travels as a number; an identifier stays text however
    // numeric it looks — a CN code is eight digits, not a quantity.
    const isNumeric = isCbamNumericFieldName(read.fieldName)
    const confirmed = input.confirmed[read.fieldName]
    const raw = confirmed ?? read.extractedValue
    const corrected = confirmed !== undefined && !sameValue(confirmed, read.extractedValue, isNumeric)
    const numeric = isNumeric ? toNumber(raw) : NaN

    atoms.push({
      field,
      value: Number.isFinite(numeric) ? numeric : raw,
      source: corrected ? 'arbor_reviewer_corrected' : 'arbor_extraction',
      confidence: corrected ? 1 : Math.min(1, Math.max(0, read.confidence)),
      snippet: snippet.slice(0, SNIPPET_MAX),
    })
  }
  return atoms
}
