// Upgrade 1 — self-consistency confidence (TS side). Pure: no DB, no network.
//
// Layer 1 runs the extraction k times at temperature > 0. These helpers line up
// each field's value across the runs (the payload for the brain's
// /fusion/fields), then rebuild the extracted fields from the brain's response —
// using the consensus value and the *fused* posterior as confidenceScore, so
// confidence stops being the model's constant 1.0 and starts carrying signal.

import { valuesMatch } from '@/lib/confidence/ground-truth'
import type { ExtractedFieldResult } from './types'

export interface FieldSampleGroup {
  fieldName: string
  /** Each run's value for this field, aligned to run order (null = absent that run). */
  samples: (string | null)[]
  /** Each run's full field object (null = absent that run), for metadata. */
  perSample: (ExtractedFieldResult | null)[]
}

/** The brain's /fusion/fields response shape for one field. */
export interface FusedFieldResult {
  field_name: string
  consensus: string | null
  agreement: number
  k: number
  posterior_mean: number
  ci_low: number
  ci_high: number
}

/** Line up each field's value across the k runs (union of field names, first-seen order). */
export function collectFieldSamples(
  results: { fields: ExtractedFieldResult[] }[],
): FieldSampleGroup[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const r of results) {
    for (const f of r.fields) {
      if (!seen.has(f.fieldName)) {
        seen.add(f.fieldName)
        names.push(f.fieldName)
      }
    }
  }
  return names.map(fieldName => {
    const perSample = results.map(r => r.fields.find(f => f.fieldName === fieldName) ?? null)
    return { fieldName, perSample, samples: perSample.map(f => f?.rawValue ?? null) }
  })
}

/** A representative run for a field — prefer one whose value matches the consensus. */
function pickRepresentative(
  group: FieldSampleGroup,
  consensus: string | null,
): ExtractedFieldResult | null {
  for (const f of group.perSample) {
    if (f && valuesMatch(f.rawValue, consensus)) return f
  }
  for (const f of group.perSample) {
    if (f) return f
  }
  return null
}

/**
 * Rebuild extracted fields from the brain's fusion. Each field takes the
 * consensus value + fused posterior as its confidence; metadata (unit, source
 * text) comes from a run that matches the consensus. Fields the brain didn't
 * fuse fall back to their representative run unchanged (fail-soft).
 */
export function buildFusedFields(
  groups: FieldSampleGroup[],
  fused: FusedFieldResult[],
): ExtractedFieldResult[] {
  const byName = new Map(fused.map(f => [f.field_name, f]))
  return groups.map(group => {
    const f = byName.get(group.fieldName)
    const representative = pickRepresentative(group, f?.consensus ?? null)

    if (!f) {
      // No fusion available for this field — keep the representative run as-is.
      return (
        representative ?? {
          fieldName: group.fieldName,
          rawValue: null,
          rawUnit: null,
          sourceText: '',
          confidenceScore: 0,
          flagged: true,
          flagReason: 'Field not found in document',
        }
      )
    }

    // Flag on genuine model uncertainty — the samples disagreed — not on the
    // Beta-smoothed absolute score (unanimous agreement caps at ~0.8 at k=3, so
    // an absolute threshold would flag everything). The posterior is still the
    // (varying) confidence the calibration layer learns from.
    const flagged = f.agreement < f.k
    const flagReason = flagged ? `Extraction samples disagreed (${f.agreement}/${f.k})` : null

    return {
      fieldName: group.fieldName,
      rawValue: f.consensus,
      rawUnit: representative?.rawUnit ?? null,
      sourceText: representative?.sourceText ?? '',
      confidenceScore: f.posterior_mean,
      flagged,
      flagReason,
    }
  })
}
