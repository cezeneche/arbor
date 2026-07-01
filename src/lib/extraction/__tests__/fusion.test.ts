import { collectFieldSamples, buildFusedFields, type FusedFieldResult } from '../fusion'
import type { ExtractedFieldResult } from '../types'

// Upgrade 1 — self-consistency confidence, TS side. Given k extraction runs of
// the same document, collectFieldSamples lines up each field's value across the
// runs (the payload sent to the brain's /fusion/fields), and buildFusedFields
// rebuilds the extracted fields using the consensus value and the *fused*
// confidence — so confidenceScore stops being the model's constant 1.0.

function field(p: Partial<ExtractedFieldResult>): ExtractedFieldResult {
  return {
    fieldName: 'f', rawValue: null, rawUnit: null, sourceText: '',
    confidenceScore: 1, flagged: false, flagReason: null, ...p,
  }
}

describe('collectFieldSamples', () => {
  it('aligns each field value across the k runs (null where a run missed it)', () => {
    const groups = collectFieldSamples([
      { fields: [field({ fieldName: 'weight', rawValue: '24500' }), field({ fieldName: 'origin', rawValue: 'India' })] },
      { fields: [field({ fieldName: 'weight', rawValue: '24,500' })] }, // origin missing this run
      { fields: [field({ fieldName: 'weight', rawValue: '24500' }), field({ fieldName: 'origin', rawValue: 'India' })] },
    ])
    const weight = groups.find(g => g.fieldName === 'weight')!
    expect(weight.samples).toEqual(['24500', '24,500', '24500'])
    const origin = groups.find(g => g.fieldName === 'origin')!
    expect(origin.samples).toEqual(['India', null, 'India'])
  })

  it('preserves first-seen field order across the union', () => {
    const groups = collectFieldSamples([
      { fields: [field({ fieldName: 'a' }), field({ fieldName: 'b' })] },
      { fields: [field({ fieldName: 'c' })] },
    ])
    expect(groups.map(g => g.fieldName)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildFusedFields', () => {
  const groups = collectFieldSamples([
    { fields: [field({ fieldName: 'weight', rawValue: '24500', rawUnit: 'KG', sourceText: 'Net 24500 KG', confidenceScore: 1 })] },
    { fields: [field({ fieldName: 'weight', rawValue: '24,500', rawUnit: 'kg', sourceText: 'x' })] },
    { fields: [field({ fieldName: 'weight', rawValue: '24500', rawUnit: 'KG', sourceText: 'Net 24500 KG' })] },
  ])

  const fused: FusedFieldResult[] = [
    { field_name: 'weight', consensus: '24500', agreement: 3, k: 3, posterior_mean: 0.8, ci_low: 0.3, ci_high: 1 },
  ]

  it('uses the fused posterior as confidenceScore (not the model 1.0)', () => {
    const [f] = buildFusedFields(groups, fused)
    expect(f.confidenceScore).toBe(0.8)
    expect(f.rawValue).toBe('24500')
    // Metadata comes from a run matching the consensus.
    expect(f.rawUnit).toBe('KG')
    expect(f.sourceText).toBe('Net 24500 KG')
  })

  it('flags a field the samples disagreed on', () => {
    const lowFused: FusedFieldResult[] = [
      { field_name: 'weight', consensus: '24500', agreement: 2, k: 3, posterior_mean: 0.6, ci_low: 0.2, ci_high: 0.9 },
    ]
    const [f] = buildFusedFields(groups, lowFused)
    expect(f.flagged).toBe(true)
    expect(f.flagReason).toMatch(/2\/3/)
  })

  it('does NOT flag unanimous agreement, even though its posterior (0.8) is below 0.85', () => {
    // The bug verification caught: at k=3 the max fused score is ~0.8, so an
    // absolute 0.85 threshold flagged every field. Unanimous = not flagged.
    const unanimous: FusedFieldResult[] = [
      { field_name: 'weight', consensus: '24500', agreement: 3, k: 3, posterior_mean: 0.8, ci_low: 0.3, ci_high: 1 },
    ]
    const [f] = buildFusedFields(groups, unanimous)
    expect(f.flagged).toBe(false)
    expect(f.flagReason).toBeNull()
    expect(f.confidenceScore).toBe(0.8) // posterior still varies for calibration
  })

  it('falls back to the representative field when the brain returned no fusion for it', () => {
    // No fused entry -> keep the representative sample's own confidence.
    const [f] = buildFusedFields(groups, [])
    expect(f.rawValue).toBe('24500')
    expect(f.confidenceScore).toBe(1) // representative sample's score
  })
})
