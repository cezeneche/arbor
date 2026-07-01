import { classifyFieldType } from '../field-types'
import { buildCalibrationSamples, type GroundTruthRow } from '../calibration-client'

// The brain calibrates each "group" independently. The plan's kill signal
// tracks Expected Calibration Error for three field types specifically —
// supplier identity, mass, and emissions intensity — so we coarse-map raw field
// names onto those types, and fall back to the field name itself otherwise.
// These pure transforms are what the offline calibration job posts to the brain.

describe('classifyFieldType — kill-signal field types', () => {
  it('maps party-name fields to supplier_identity', () => {
    expect(classifyFieldType('supplier_name')).toBe('supplier_identity')
    expect(classifyFieldType('account_holder_name')).toBe('supplier_identity')
    expect(classifyFieldType('holder_name')).toBe('supplier_identity')
  })

  it('maps weight/mass fields to mass', () => {
    expect(classifyFieldType('shipment_weight')).toBe('mass')
    expect(classifyFieldType('declared_weight')).toBe('mass')
    expect(classifyFieldType('gross_weight')).toBe('mass')
    expect(classifyFieldType('quantity_tonnes')).toBe('mass')
  })

  it('maps per-tonne / factor emissions fields to emissions_intensity', () => {
    expect(classifyFieldType('embedded_emissions_per_tonne')).toBe('emissions_intensity')
    expect(classifyFieldType('factor_value')).toBe('emissions_intensity')
  })

  it('returns null for a field with no coarse type', () => {
    expect(classifyFieldType('invoice_number')).toBeNull()
  })
})

describe('buildCalibrationSamples', () => {
  const rows: GroundTruthRow[] = [
    { fieldName: 'supplier_name', documentClass: 'ELECTRICITY_BILL', confidenceAtExtraction: 0.9, wasCorrect: true },
    { fieldName: 'supplier_name', documentClass: 'GAS_BILL', confidenceAtExtraction: 0.7, wasCorrect: false },
    { fieldName: 'invoice_number', documentClass: 'GAS_BILL', confidenceAtExtraction: 0.6, wasCorrect: true },
  ]

  it('by fieldType, merges known types across document classes and falls back to field name', () => {
    const samples = buildCalibrationSamples(rows, 'fieldType')
    // Both supplier_name rows collapse into one supplier_identity group...
    const supplier = samples.filter(s => s.group === 'supplier_identity')
    expect(supplier).toHaveLength(2)
    // ...and the uncategorised field keeps its own name as the group.
    expect(samples.find(s => s.group === 'invoice_number')).toBeDefined()
  })

  it('passes score and correctness straight through', () => {
    const [first] = buildCalibrationSamples(rows, 'fieldType')
    expect(first.score).toBe(0.9)
    expect(first.correct).toBe(true)
  })

  it('by fieldName, groups strictly by the raw field', () => {
    const samples = buildCalibrationSamples(rows, 'fieldName')
    expect(samples.filter(s => s.group === 'supplier_name')).toHaveLength(2)
  })

  it('by documentClass, groups by the source document class', () => {
    const samples = buildCalibrationSamples(rows, 'documentClass')
    expect(samples.filter(s => s.group === 'GAS_BILL')).toHaveLength(2)
  })
})
