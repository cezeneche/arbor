import { evaluateAdmissibility } from '../admissibility'
import { buildExtractionPrompt } from '../prompts'
import type { ExtractedFieldResult } from '../types'

function field(
  fieldName: string,
  rawValue: string | null,
  confidenceScore = 0.95,
): ExtractedFieldResult {
  return {
    fieldName,
    rawValue,
    rawUnit: null,
    sourceText: `source text for ${fieldName}`,
    confidenceScore,
    flagged: confidenceScore < 0.85,
    flagReason: confidenceScore < 0.85 ? 'Low confidence' : null,
  }
}

// ── FERTILISER RECORD ────────────────────────────────────────────────────────

function baseFertiliserFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Green Farm Ltd',
    site_or_field_id: 'FIELD-01',
    product_name: 'Ammonium Nitrate 34.5%',
    nitrogen_content_percent: '34.5',
    quantity_applied_per_hectare: '200',
    application_rate_unit: 'kg/ha',
    total_quantity_applied: '2000',
    total_unit: 'kg',
    application_date: '2024-04-15',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility — fertiliser record', () => {
  it('all compulsory fields present → Tier A', () => {
    const result = evaluateAdmissibility('FERTILISER_RECORD', baseFertiliserFields(), 'Green Farm Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  // [Admissibility Spec 6.2] nitrogen_content_percent is compulsory —
  // N2O emissions calculated from N content; without it emissions calculation is impossible
  it('missing nitrogen_content_percent → CRITICAL flag → Tier B', () => {
    const fields = baseFertiliserFields({ nitrogen_content_percent: null })
    const result = evaluateAdmissibility('FERTILISER_RECORD', fields, 'Green Farm Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'nitrogen_content_percent' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('missing total_quantity_applied → CRITICAL flag → Tier B', () => {
    const fields = baseFertiliserFields().filter((f) => f.fieldName !== 'total_quantity_applied')
    const result = evaluateAdmissibility('FERTILISER_RECORD', fields, 'Green Farm Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'total_quantity_applied' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  // [Admissibility Spec 6.2] phosphorus and potassium are conditional on NPK products
  it('NPK product missing phosphorus_content_percent → WARNING flag', () => {
    const fields = baseFertiliserFields({ product_name: 'NPK 15-15-15' })
    const result = evaluateAdmissibility('FERTILISER_RECORD', fields, 'Green Farm Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'phosphorus_content_percent' && f.severity === 'WARNING',
    )
    expect(flag).toBeDefined()
  })

  // [Admissibility Spec 6.2] NPK product missing potassium_content_percent → WARNING flag
  it('NPK product missing potassium_content_percent → WARNING flag', () => {
    const fields = baseFertiliserFields({ product_name: 'NPK 15-15-15' })
    const result = evaluateAdmissibility('FERTILISER_RECORD', fields, 'Green Farm Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'potassium_content_percent' && f.severity === 'WARNING',
    )
    expect(flag).toBeDefined()
  })

  it('NPK product with all conditional fields → no NPK WARNING flags', () => {
    const fields = [
      ...baseFertiliserFields({ product_name: 'NPK 15-15-15' }),
      field('phosphorus_content_percent', '15'),
      field('potassium_content_percent', '15'),
    ]
    const result = evaluateAdmissibility('FERTILISER_RECORD', fields, 'Green Farm Ltd')
    const phosphorusFlag = result.flags.find(
      (f) =>
        f.fieldName === 'phosphorus_content_percent' &&
        f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    const potassiumFlag = result.flags.find(
      (f) =>
        f.fieldName === 'potassium_content_percent' &&
        f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(phosphorusFlag).toBeUndefined()
    expect(potassiumFlag).toBeUndefined()
  })

  it('non-NPK product missing phosphorus → no NPK WARNING flag', () => {
    const fields = baseFertiliserFields({ product_name: 'Ammonium Nitrate 34.5%' })
    const result = evaluateAdmissibility('FERTILISER_RECORD', fields, 'Green Farm Ltd')
    const flag = result.flags.find(
      (f) =>
        f.fieldName === 'phosphorus_content_percent' &&
        f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag).toBeUndefined()
  })
})

// ── CROP YIELD RECORD ────────────────────────────────────────────────────────

function baseCropYieldFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Green Farm Ltd',
    site_or_field_id: 'FIELD-01',
    crop_type: 'Wheat',
    area_hectares: '10',
    yield_quantity: '80',
    yield_unit: 'tonnes',
    harvest_date: '2024-08-20',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility — crop yield record', () => {
  it('all compulsory fields present → Tier A', () => {
    const result = evaluateAdmissibility('CROP_YIELD_RECORD', baseCropYieldFields(), 'Green Farm Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing harvest_date → CRITICAL flag → Tier B', () => {
    const fields = baseCropYieldFields({ harvest_date: null })
    const result = evaluateAdmissibility('CROP_YIELD_RECORD', fields, 'Green Farm Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'harvest_date' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('missing area_hectares → CRITICAL flag → Tier B', () => {
    const fields = baseCropYieldFields().filter((f) => f.fieldName !== 'area_hectares')
    const result = evaluateAdmissibility('CROP_YIELD_RECORD', fields, 'Green Farm Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'area_hectares' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('optional crop_variety absent → no CRITICAL flag', () => {
    const result = evaluateAdmissibility('CROP_YIELD_RECORD', baseCropYieldFields(), 'Green Farm Ltd')
    expect(result.flags.find((f) => f.fieldName === 'crop_variety' && f.severity === 'CRITICAL')).toBeUndefined()
  })
})

// ── LIVESTOCK RECORD ─────────────────────────────────────────────────────────

function baseLivestockFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Green Farm Ltd',
    site_name: 'Home Farm',
    species: 'CATTLE',
    average_herd_size: '150',
    period_start: '2024-01-01',
    period_end: '2024-12-31',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility — livestock record', () => {
  it('all compulsory fields, no feed_quantity → Tier A', () => {
    const result = evaluateAdmissibility('LIVESTOCK_RECORD', baseLivestockFields(), 'Green Farm Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('feed_quantity present without feed_unit → WARNING flag', () => {
    const fields = [
      ...baseLivestockFields(),
      field('feed_quantity', '50000'),
    ]
    const result = evaluateAdmissibility('LIVESTOCK_RECORD', fields, 'Green Farm Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'feed_unit' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('WARNING')
  })

  it('feed_quantity absent → no feed_unit WARNING', () => {
    const result = evaluateAdmissibility('LIVESTOCK_RECORD', baseLivestockFields(), 'Green Farm Ltd')
    const flag = result.flags.find((f) => f.fieldName === 'feed_unit')
    expect(flag).toBeUndefined()
  })

  it('feed_quantity and feed_unit both present → no MISSING_CONDITIONAL_FIELD flag', () => {
    const fields = [
      ...baseLivestockFields(),
      field('feed_quantity', '50000'),
      field('feed_unit', 'kg'),
    ]
    const result = evaluateAdmissibility('LIVESTOCK_RECORD', fields, 'Green Farm Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'feed_unit' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag).toBeUndefined()
  })

  it('missing average_herd_size → CRITICAL flag → Tier B', () => {
    const fields = baseLivestockFields().filter((f) => f.fieldName !== 'average_herd_size')
    const result = evaluateAdmissibility('LIVESTOCK_RECORD', fields, 'Green Farm Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'average_herd_size' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })
})

// ── LAND USE CERTIFICATE ──────────────────────────────────────────────────────

function fullLandUseCertFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Green Farm Ltd',
    land_parcel_reference: 'GB-LPIS-12345678',
    land_use_type: 'arable',
    area_hectares: '45.2',
    issuing_body: 'Rural Payments Agency',
    certificate_number: 'LUC-2024-001',
    issue_date: '2024-01-01',
    expiry_date: '2025-12-31',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility — land use certificate', () => {
  it('all compulsory fields present, valid expiry → Tier A', () => {
    const result = evaluateAdmissibility(
      'LAND_USE_CERTIFICATE',
      fullLandUseCertFields(),
      'Green Farm Ltd',
      new Date('2025-06-30'),
    )
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  // [Admissibility Spec §7.1] land_parcel_reference is compulsory — identifies the specific parcel
  it('missing land_parcel_reference → CRITICAL flag → Tier B', () => {
    const fields = fullLandUseCertFields({ land_parcel_reference: null })
    const result = evaluateAdmissibility('LAND_USE_CERTIFICATE', fields, 'Green Farm Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'land_parcel_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  // [Admissibility Spec §7.1] certificate expired before reporting period → CRITICAL EXPIRED_CERTIFICATE
  it('expired certificate → CRITICAL EXPIRED_CERTIFICATE flag → Tier B', () => {
    const fields = fullLandUseCertFields({ expiry_date: '2023-12-31' })
    const result = evaluateAdmissibility(
      'LAND_USE_CERTIFICATE',
      fields,
      'Green Farm Ltd',
      new Date('2024-06-30'),
    )
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'expiry_date' && f.flagType === 'EXPIRED_CERTIFICATE',
    )
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('CRITICAL')
  })

  // [Admissibility Spec §7.1] entity_name mismatch → WARNING ENTITY_MISMATCH
  it('entity_name mismatch → WARNING ENTITY_MISMATCH flag', () => {
    const fields = fullLandUseCertFields({ entity_name: 'Different Farm Co' })
    const result = evaluateAdmissibility('LAND_USE_CERTIFICATE', fields, 'Green Farm Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'entity_name' && f.flagType === 'ENTITY_MISMATCH',
    )
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('WARNING')
  })
})

// ── EXTRACTION PROMPTS — AGRICULTURAL TYPES ──────────────────────────────────

describe('buildExtractionPrompt — agricultural document types', () => {
  it('FERTILISER_RECORD prompt includes nitrogen_content guidance', () => {
    const prompt = buildExtractionPrompt('FERTILISER_RECORD', ['nitrogen_content_percent', 'product_name'])
    expect(prompt).toContain('nitrogen')
  })

  it('FERTILISER_RECORD prompt includes NPK conditional guidance', () => {
    const prompt = buildExtractionPrompt('FERTILISER_RECORD', ['phosphorus_content_percent', 'potassium_content_percent'])
    expect(prompt).toContain('NPK')
  })

  it('LIVESTOCK_RECORD prompt includes feed_unit conditional guidance', () => {
    const prompt = buildExtractionPrompt('LIVESTOCK_RECORD', ['feed_quantity', 'feed_unit'])
    expect(prompt).toContain('feed_unit')
  })

  it('CROP_YIELD_RECORD prompt includes harvest date guidance', () => {
    const prompt = buildExtractionPrompt('CROP_YIELD_RECORD', ['harvest_date'])
    expect(prompt).toContain('harvest')
  })
})
