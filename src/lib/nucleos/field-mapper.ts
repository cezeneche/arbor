// Nucleos extraction result → Arbor ExtractedField rows.
//
// Everything here is a DRAFT. Nothing sets a provenance tier: only a human
// action in Arbor's Review screen does that, exactly as for every other document
// type. This mapper's whole job is to present what Nucleos found in the shape
// Arbor's Review screen already knows how to display.
//
// Nucleos's flag strings pass through verbatim. They are the anti-hallucination
// signals a reviewer acts on — `arbiter_conflict:*` says two extractors
// disagreed and which, `repair_failed:*` says a gap could not be filled. Rewriting
// them into something tidier leaves the reviewer with "there was an issue".
//
// Three rules here come from the first real customs declaration to reach
// production, which produced six rows, four of them empty and confident, all six
// carrying the same flag about a seventh field, and a seven-digit CN code that
// nothing objected to. Each is marked below.

import type { CbamExtractionResult } from './contract'

/** Below this, Arbor flags a field for human review (PRD §13, Layer 1). */
const CONFIDENCE_THRESHOLD = 0.85

export interface ExtractedFieldRow {
  fieldName: string
  admissibility: 'COMPULSORY' | 'CONDITIONAL' | 'OPTIONAL'
  rawValue: string | null
  rawUnit: string | null
  sourceText: string
  confidenceScore: number
  flagged: boolean
  flagReason: string | null
}

function hasValue(raw: string | null): boolean {
  return raw !== null && raw.trim() !== ''
}

/**
 * Document flags that name a field, e.g. `repair_failed:invoice_date`.
 *
 * These describe one field, so smearing them across every row tells a reviewer
 * scanning six identical flags nothing about any of them. Extracting the name
 * lets the flag land where it belongs.
 */
const FIELD_NAMING_FLAG = /^(repair_failed|arbiter_conflict):(.+)$/

function fieldNamedBy(flag: string): string | null {
  const m = flag.match(FIELD_NAMING_FLAG)
  return m ? m[2].trim() : null
}

function buildRow(
  fieldName: string,
  rawValue: string | null,
  rawUnit: string | null,
  sourceText: string | null,
  confidence: number,
  fieldFlags: string[],
  documentFlags: string[],
): ExtractedFieldRow {
  const reasons = [...fieldFlags, ...documentFlags]
  const present = hasValue(rawValue)

  // A field with no value is not a confident field. 0.96 beside an empty box is
  // the most misleading thing this screen can show — it invites a reviewer to
  // confirm a value that is not there. The field is still written, because a
  // missing compulsory field is exactly what a reviewer needs to see.
  const effectiveConfidence = present ? confidence : 0
  if (!present) {
    reasons.push('value_not_found:the document was read but this field was not found')
  }

  if (present && confidence < CONFIDENCE_THRESHOLD) {
    reasons.push(`confidence_below_threshold:${confidence.toFixed(2)}`)
  }
  if (present && (!sourceText || !sourceText.trim())) {
    // A reviewer confirms a value against the text it came from. Without that
    // text there is nothing to confirm, so the field cannot honestly become
    // Verified however confident the extractor was.
    reasons.push('no_source_text:cannot be confirmed against the document')
  }

  return {
    fieldName,
    admissibility: 'OPTIONAL',
    rawValue: present ? rawValue : null,
    rawUnit,
    sourceText: sourceText ?? '',
    confidenceScore: effectiveConfidence,
    flagged: reasons.length > 0,
    flagReason: reasons.length > 0 ? reasons.join('; ') : null,
  }
}

/**
 * Whether a CN code is a full 8-digit commodity code.
 *
 * A 6-digit code is the HS heading, not a CN code, and cannot carry a CBAM
 * default value or a sector. The admissibility spec makes this a critical flag.
 * Arbor already had that rule, but it looks for a field called `commodity_code`
 * and Nucleos emits `lines[N].cn_code`, so it never fired on a CBAM document.
 */
function cnCodeFlag(code: string | null): string | null {
  if (!hasValue(code)) return null
  const digits = (code as string).replace(/\D/g, '')
  if (digits.length === 8) return null
  return (
    `cn_code_not_8_digit:${code} has ${digits.length} digits; ` +
    'CBAM needs the full 8-digit CN code'
  )
}

export function toExtractedFieldRows(result: CbamExtractionResult): ExtractedFieldRow[] {
  const allDocumentFlags = [...(result.flags ?? [])]

  // Split once: flags that name a field are routed to it, the rest apply to
  // everything confirmed from this document (source_truncated genuinely does).
  const targetedFlags = new Map<string, string[]>()
  const generalFlags: string[] = []
  for (const flag of allDocumentFlags) {
    const target = fieldNamedBy(flag)
    if (target) {
      targetedFlags.set(target, [...(targetedFlags.get(target) ?? []), flag])
    } else {
      generalFlags.push(flag)
    }
  }

  const rows: ExtractedFieldRow[] = []
  const seen = new Set<string>()

  for (const field of result.fields ?? []) {
    seen.add(field.field_name)
    rows.push(
      buildRow(
        field.field_name,
        field.raw_value ?? null,
        field.raw_unit ?? null,
        field.source_text ?? null,
        field.confidence ?? 0,
        [...(field.flags ?? []), ...(targetedFlags.get(field.field_name) ?? [])],
        generalFlags,
      ),
    )
  }

  // A flag naming a field that produced no row at all is the only record that
  // the field was sought and not found. Dropping it would make the field simply
  // not appear, which reads as "not applicable" rather than "missing".
  for (const [fieldName, flags] of targetedFlags) {
    if (seen.has(fieldName)) continue
    rows.push(buildRow(fieldName, null, null, null, 0, flags, generalFlags))
  }

  for (const line of result.lines ?? []) {
    const prefix = `lines[${line.line_index}]`
    const lineFlags = [...(line.flags ?? [])]

    const scalars: [string, unknown, string | null][] = [
      ['cn_code', line.cn_code, null],
      ['description', line.description, null],
      ['net_mass_kg', line.net_mass_kg, 'kg'],
      ['origin_country', line.origin_country, null],
      ['production_route', line.production_route, null],
      ['installation_id', line.installation_id, null],
      ['installation_name', line.installation_name, null],
      ['direct_embedded_kgco2e', line.direct_embedded_kgco2e, 'kgCO2e'],
      ['indirect_embedded_kgco2e', line.indirect_embedded_kgco2e, 'kgCO2e'],
      ['emissions_method', line.emissions_method, null],
    ]

    for (const [name, value, unit] of scalars) {
      if (value === null || value === undefined) continue

      const extra = [...lineFlags]
      if (name === 'cn_code') {
        const flag = cnCodeFlag(String(value))
        if (flag) extra.push(flag)
      }

      rows.push(
        buildRow(
          `${prefix}.${name}`,
          String(value),
          unit,
          // Goods-line values arrive without a per-value snippet; the line's own
          // flags and the document flags still travel, and the reviewer sees the
          // source document alongside.
          null,
          1,
          extra,
          generalFlags,
        ),
      )
    }
  }

  return rows
}
