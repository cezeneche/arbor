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

  if (confidence < CONFIDENCE_THRESHOLD) {
    reasons.push(`confidence_below_threshold:${confidence.toFixed(2)}`)
  }
  if (!sourceText || !sourceText.trim()) {
    // A reviewer confirms a value against the text it came from. Without that
    // text there is nothing to confirm, so the field cannot honestly become
    // Verified however confident the extractor was.
    reasons.push('no_source_text:cannot be confirmed against the document')
  }

  return {
    fieldName,
    admissibility: 'OPTIONAL',
    rawValue,
    rawUnit,
    sourceText: sourceText ?? '',
    confidenceScore: confidence,
    flagged: reasons.length > 0,
    flagReason: reasons.length > 0 ? reasons.join('; ') : null,
  }
}

export function toExtractedFieldRows(result: CbamExtractionResult): ExtractedFieldRow[] {
  const documentFlags = [...(result.flags ?? [])]
  const rows: ExtractedFieldRow[] = []

  for (const field of result.fields ?? []) {
    rows.push(
      buildRow(
        field.field_name,
        field.raw_value ?? null,
        field.raw_unit ?? null,
        field.source_text ?? null,
        field.confidence ?? 0,
        [...(field.flags ?? [])],
        documentFlags,
      ),
    )
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
          lineFlags,
          documentFlags,
        ),
      )
    }
  }

  return rows
}
