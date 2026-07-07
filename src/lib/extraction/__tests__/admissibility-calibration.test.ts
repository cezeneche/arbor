import { evaluateAdmissibility } from '../admissibility'
import type { ExtractedFieldResult } from '../types'

// Layer 1 confidence calibration.
// Claude is systematically over-confident on non-English and degraded documents.
// The threshold check applies a penalty so borderline fields are flagged for review.
// The penalty is applied only for the threshold comparison — the stored
// confidenceScore on each field remains the raw AI-reported value.

function field(overrides: Partial<ExtractedFieldResult>): ExtractedFieldResult {
  return {
    fieldName: 'total_consumption_kwh',
    rawValue: '1234',
    rawUnit: 'kWh',
    sourceText: 'Total: 1234 kWh',
    confidenceScore: 0.95,
    flagged: false,
    flagReason: null,
    ...overrides,
  }
}

// A complete English electricity bill at high confidence — Tier A baseline.
function completeBill(confidence: number): ExtractedFieldResult[] {
  return [
    field({ fieldName: 'account_holder_name', rawValue: 'Acme Steel Ltd', confidenceScore: confidence }),
    field({ fieldName: 'site_address', rawValue: '1 Mill Road', confidenceScore: confidence }),
    field({ fieldName: 'meter_reference', rawValue: 'MPAN-123', confidenceScore: confidence }),
    field({ fieldName: 'period_start', rawValue: '2026-01-01', confidenceScore: confidence }),
    field({ fieldName: 'period_end', rawValue: '2026-03-31', confidenceScore: confidence }),
    field({ fieldName: 'total_consumption_kwh', rawValue: '1234', confidenceScore: confidence }),
    field({ fieldName: 'read_type', rawValue: 'ACTUAL', confidenceScore: confidence }),
    field({ fieldName: 'supplier_name', rawValue: 'PowerCo', confidenceScore: confidence }),
    field({ fieldName: 'invoice_number', rawValue: 'INV-1', confidenceScore: confidence }),
    field({ fieldName: 'invoice_date', rawValue: '2026-04-01', confidenceScore: confidence }),
  ]
}

describe('evaluateAdmissibility — confidence calibration', () => {
  it('does not flag a high-confidence English document (no calibration)', () => {
    const result = evaluateAdmissibility('ELECTRICITY_BILL', completeBill(0.95), 'Acme Steel Ltd')
    expect(result.flags.filter((f) => f.flagType === 'LOW_CONFIDENCE')).toHaveLength(0)
    expect(result.tier).toBe('A')
  })

  it('does not flag a 0.88 field on an English document', () => {
    // 0.88 ≥ 0.85, no penalty for English → no LOW_CONFIDENCE flag
    const result = evaluateAdmissibility('ELECTRICITY_BILL', completeBill(0.88), 'Acme Steel Ltd', undefined, {
      detectedLanguage: 'en',
    })
    expect(result.flags.filter((f) => f.flagType === 'LOW_CONFIDENCE')).toHaveLength(0)
  })

  it('flags a 0.88 field on a non-English document after the -0.05 penalty', () => {
    // 0.88 - 0.05 = 0.83 < 0.85 → LOW_CONFIDENCE flag fires
    const result = evaluateAdmissibility('ELECTRICITY_BILL', completeBill(0.88), 'Acme Steel Ltd', undefined, {
      detectedLanguage: 'de',
    })
    expect(result.flags.filter((f) => f.flagType === 'LOW_CONFIDENCE').length).toBeGreaterThan(0)
  })

  it('applies an additional penalty for low image quality', () => {
    // 0.93 English with quality 3 → 0.93 - 0.05 = 0.88 ≥ 0.85, still clear
    const clean = evaluateAdmissibility('ELECTRICITY_BILL', completeBill(0.93), 'Acme Steel Ltd', undefined, {
      detectedLanguage: 'en',
      imageQualityScore: 3,
    })
    expect(clean.flags.filter((f) => f.flagType === 'LOW_CONFIDENCE')).toHaveLength(0)

    // 0.93 non-English with quality 3 → 0.93 - 0.05 - 0.05 = 0.83 < 0.85 → flagged
    const degraded = evaluateAdmissibility('ELECTRICITY_BILL', completeBill(0.93), 'Acme Steel Ltd', undefined, {
      detectedLanguage: 'fr',
      imageQualityScore: 3,
    })
    expect(degraded.flags.filter((f) => f.flagType === 'LOW_CONFIDENCE').length).toBeGreaterThan(0)
  })

  it('does not mutate the raw confidence in the reported flag message', () => {
    // The flag message reports the adjusted score used for comparison, but
    // the calibration must never alter the field objects passed in.
    const fields = completeBill(0.88)
    evaluateAdmissibility('ELECTRICITY_BILL', fields, 'Acme Steel Ltd', undefined, { detectedLanguage: 'de' })
    expect(fields.every((f) => f.confidenceScore === 0.88)).toBe(true)
  })
})
