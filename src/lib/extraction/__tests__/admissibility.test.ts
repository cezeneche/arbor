import { evaluateAdmissibility } from '../admissibility'
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

function fullElectricityBillFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    account_holder_name: 'Acme Ltd',
    site_address: '1 Industrial Way',
    meter_reference: 'S1234567890',
    period_start: '2024-01-01',
    period_end: '2024-03-31',
    total_consumption_kwh: '150000',
    read_type: 'ACTUAL',
    supplier_name: 'British Gas',
    invoice_number: 'INV-001',
    invoice_date: '2024-04-01',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  generic (Core 3, schema-on-read)', () => {
  it('OTHER document type with arbitrary fields → Tier B, no critical flags', () => {
    const result = evaluateAdmissibility(
      'OTHER',
      [field('monthly_rent', '4500'), field('landlord_name', 'Estates Ltd')],
      'Acme Ltd',
    )
    expect(result.tier).toBe('B')
    expect(result.criticalCount).toBe(0)
  })

  it('an unknown document type (no spec) → Tier B', () => {
    const result = evaluateAdmissibility('LEASE_AGREEMENT', [field('term_years', '5')], 'Acme Ltd')
    expect(result.tier).toBe('B')
  })
})

describe('evaluateAdmissibility  -  electricity bill', () => {
  it('ACTUAL read with all compulsory fields → Tier A', () => {
    const result = evaluateAdmissibility(
      'ELECTRICITY_BILL',
      fullElectricityBillFields(),
      'Acme Ltd',
    )
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('ESTIMATED read → Tier B with CRITICAL flag', () => {
    const result = evaluateAdmissibility(
      'ELECTRICITY_BILL',
      fullElectricityBillFields({ read_type: 'ESTIMATED' }),
      'Acme Ltd',
    )
    expect(result.tier).toBe('B')
    expect(result.criticalCount).toBeGreaterThan(0)
    const flag = result.flags.find((f) => f.fieldName === 'read_type')
    expect(flag?.severity).toBe('CRITICAL')
  })

  it('missing compulsory field → Tier B with CRITICAL flag', () => {
    const fields = fullElectricityBillFields()
    const withoutMeter = fields.filter((f) => f.fieldName !== 'meter_reference')
    const result = evaluateAdmissibility('ELECTRICITY_BILL', withoutMeter, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const gap = result.flags.find(
      (f) => f.fieldName === 'meter_reference' && f.severity === 'CRITICAL',
    )
    expect(gap).toBeDefined()
  })
})

describe('evaluateAdmissibility  -  customs declaration / CBAM', () => {
  it('6-digit commodity code → CRITICAL CODE_INSUFFICIENT flag', () => {
    const fields = [
      field('importer_name', 'Acme Ltd'),
      field('commodity_code', '720811'),
      field('commodity_description', 'Hot-rolled steel'),
      field('country_of_origin', 'DE'),
      field('country_of_dispatch', 'DE'),
      field('declared_weight', '5000'),
      field('weight_unit', 'kg'),
      field('declaration_reference', 'MRN123456'),
      field('declaration_date', '2024-01-15'),
    ]
    const result = evaluateAdmissibility('CUSTOMS_DECLARATION', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find((f) => f.flagType === 'CODE_INSUFFICIENT')
    expect(flag?.severity).toBe('CRITICAL')
  })

  it('8-digit commodity code → no CODE_INSUFFICIENT flag', () => {
    const fields = [
      field('importer_name', 'Acme Ltd'),
      field('commodity_code', '72081010'),
      field('commodity_description', 'Hot-rolled steel'),
      field('country_of_origin', 'DE'),
      field('country_of_dispatch', 'DE'),
      field('declared_weight', '5000'),
      field('weight_unit', 'kg'),
      field('declaration_reference', 'MRN123456'),
      field('declaration_date', '2024-01-15'),
    ]
    const result = evaluateAdmissibility('CUSTOMS_DECLARATION', fields, 'Acme Ltd')
    expect(result.flags.find((f) => f.flagType === 'CODE_INSUFFICIENT')).toBeUndefined()
  })
})

describe('evaluateAdmissibility  -  CBAM declaration', () => {
  it('TIER_1 without supporting_data_reference → CRITICAL flag', () => {
    const fields = [
      field('declarant_name', 'Acme Ltd'),
      field('commodity_code', '72081010'),
      field('commodity_description', 'Hot-rolled steel'),
      field('country_of_origin', 'UA'),
      field('production_period_start', '2024-01-01'),
      field('production_period_end', '2024-03-31'),
      field('quantity_tonnes', '500'),
      field('embedded_emissions_tco2e', '950'),
      field('embedded_emissions_per_tonne', '1.9'),
      field('calculation_tier', 'TIER_1'),
      field('calculation_methodology', 'Direct measurement'),
      field('supporting_data_reference', null),
    ]
    const result = evaluateAdmissibility('CBAM_DECLARATION', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'supporting_data_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
    expect(result.tier).toBe('B')
  })

  it('TIER_3 without supporting_data_reference → no critical flag for missing reference', () => {
    const fields = [
      field('declarant_name', 'Acme Ltd'),
      field('commodity_code', '72081010'),
      field('commodity_description', 'Hot-rolled steel'),
      field('country_of_origin', 'UA'),
      field('production_period_start', '2024-01-01'),
      field('production_period_end', '2024-03-31'),
      field('quantity_tonnes', '500'),
      field('embedded_emissions_tco2e', '950'),
      field('embedded_emissions_per_tonne', '1.9'),
      field('calculation_tier', 'TIER_3'),
      field('calculation_methodology', 'Default factor'),
    ]
    const result = evaluateAdmissibility('CBAM_DECLARATION', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'supporting_data_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeUndefined()
  })
})

describe('evaluateAdmissibility  -  certificates', () => {
  it('expired certificate → CRITICAL EXPIRED_CERTIFICATE flag', () => {
    const fields = [
      field('certificate_holder_name', 'Acme Ltd'),
      field('certificate_type', 'ORGANIC'),
      field('issuing_body', 'Control Union'),
      field('certificate_number', 'ORG-2023-001'),
      field('scope_of_certification', 'Organic wheat production'),
      field('issue_date', '2023-01-01'),
      field('expiry_date', '2023-12-31'),
    ]
    const reportingPeriodEnd = new Date('2024-03-31')
    const result = evaluateAdmissibility(
      'PRODUCT_CERTIFICATE',
      fields,
      'Acme Ltd',
      reportingPeriodEnd,
    )
    const flag = result.flags.find((f) => f.flagType === 'EXPIRED_CERTIFICATE')
    expect(flag?.severity).toBe('CRITICAL')
    expect(result.tier).toBe('B')
  })

  it('valid certificate → no EXPIRED_CERTIFICATE flag', () => {
    const fields = [
      field('certificate_holder_name', 'Acme Ltd'),
      field('certificate_type', 'ORGANIC'),
      field('issuing_body', 'Control Union'),
      field('certificate_number', 'ORG-2024-001'),
      field('scope_of_certification', 'Organic wheat production'),
      field('issue_date', '2024-01-01'),
      field('expiry_date', '2024-12-31'),
    ]
    const reportingPeriodEnd = new Date('2024-03-31')
    const result = evaluateAdmissibility(
      'PRODUCT_CERTIFICATE',
      fields,
      'Acme Ltd',
      reportingPeriodEnd,
    )
    expect(result.flags.find((f) => f.flagType === 'EXPIRED_CERTIFICATE')).toBeUndefined()
  })
})

describe('evaluateAdmissibility  -  supplier questionnaire', () => {
  it('always returns Tier B regardless of field completeness', () => {
    const fields = [
      field('supplier_name', 'Supplier Co'),
      field('responding_entity', 'Supplier Co'),
      field('reporting_period_start', '2024-01-01'),
      field('reporting_period_end', '2024-12-31'),
      field('response_completeness', 'COMPLETE'),
      field('methodology_stated', 'GHG Protocol'),
    ]
    const result = evaluateAdmissibility('SUPPLIER_QUESTIONNAIRE', fields, 'Supplier Co')
    expect(result.tier).toBe('B')
  })
})

describe('evaluateAdmissibility  -  low confidence', () => {
  it('field with confidence below 0.85 → WARNING flag', () => {
    const fields = [
      ...fullElectricityBillFields(),
      field('total_consumption_kwh', '150000', 0.72),
    ]
    const result = evaluateAdmissibility('ELECTRICITY_BILL', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'total_consumption_kwh' && f.flagType === 'LOW_CONFIDENCE',
    )
    expect(flag?.severity).toBe('WARNING')
  })
})

// ── 3.2 Delivery Note ────────────────────────────────────────────────────────

function fullDeliveryNoteFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    shipper_name: 'Acme Ltd',
    consignee_name: 'UK Steel Importer Ltd',
    delivery_date: '2024-02-15',
    delivery_note_reference: 'DN-2024-00789',
    line_items: JSON.stringify([
      { description: 'Hot-rolled steel coil, grade S355', quantity: 5000, unit: 'kg' },
    ]),
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  delivery note (3.2)', () => {
  it('all compulsory fields → Tier A', () => {
    // Admissibility spec §3.2: all compulsory fields with ≥1 line item → Tier A
    const result = evaluateAdmissibility('DELIVERY_NOTE', fullDeliveryNoteFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing delivery_note_reference → Tier B with CRITICAL flag', () => {
    // Admissibility spec §3.2: delivery_note_reference is compulsory
    const fields = fullDeliveryNoteFields({ delivery_note_reference: null })
    const result = evaluateAdmissibility('DELIVERY_NOTE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'delivery_note_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('empty line_items array → Tier B with CRITICAL flag', () => {
    // Admissibility spec §3.2: "Compulsory  -  min 1 item"
    const fields = fullDeliveryNoteFields({ line_items: '[]' })
    const result = evaluateAdmissibility('DELIVERY_NOTE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find((f) => f.fieldName === 'line_items' && f.severity === 'CRITICAL')
    expect(flag).toBeDefined()
  })
})

// ── 3.3 Customs Declaration (comprehensive) ───────────────────────────────────

function fullCustomsDeclarationFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    importer_name: 'Acme Ltd',
    commodity_code: '72081010',
    commodity_description: 'Hot-rolled steel coil, flat-rolled',
    country_of_origin: 'DE',
    country_of_dispatch: 'DE',
    declared_weight: '5000',
    weight_unit: 'kg',
    declaration_reference: 'MRN22GB000000000001X',
    declaration_date: '2024-01-15',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  customs declaration (3.3)', () => {
  it('all compulsory fields, 8-digit CN code → Tier A', () => {
    // Admissibility spec §3.3: all compulsory fields + valid 8-digit code → Tier A
    const result = evaluateAdmissibility(
      'CUSTOMS_DECLARATION',
      fullCustomsDeclarationFields(),
      'Acme Ltd',
    )
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing declaration_reference → Tier B with CRITICAL flag', () => {
    // Admissibility spec §3.3: declaration_reference (MRN) is compulsory
    const fields = fullCustomsDeclarationFields({ declaration_reference: null })
    const result = evaluateAdmissibility('CUSTOMS_DECLARATION', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'declaration_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('currency absent when declared_value present → WARNING', () => {
    // Admissibility spec §3.3: currency conditional on declared_value
    const fields = [...fullCustomsDeclarationFields(), field('declared_value', '250000')]
    const result = evaluateAdmissibility('CUSTOMS_DECLARATION', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'currency' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('currency not flagged when declared_value is absent', () => {
    // Conditional only activates when declared_value is present
    const result = evaluateAdmissibility(
      'CUSTOMS_DECLARATION',
      fullCustomsDeclarationFields(),
      'Acme Ltd',
    )
    expect(result.flags.find((f) => f.fieldName === 'currency')).toBeUndefined()
  })

  it('importer_name mismatch → WARNING entity mismatch flag', () => {
    // Universal quality check: entity name must match registered entity
    const fields = fullCustomsDeclarationFields({ importer_name: 'Different Importer GmbH' })
    const result = evaluateAdmissibility('CUSTOMS_DECLARATION', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'importer_name' && f.flagType === 'ENTITY_MISMATCH',
    )
    expect(flag?.severity).toBe('WARNING')
  })
})

// ── 2.4 Process Data Sheet ────────────────────────────────────────────────────

function fullProcessDataSheetFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Acme Ltd',
    site_name: 'Sheffield Steelworks',
    process_type: 'Electric arc furnace steelmaking',
    period_start: '2024-01-01',
    period_end: '2024-03-31',
    inputs: JSON.stringify([
      { type: 'Scrap steel', quantity: 1000, unit: 'tonnes' },
      { type: 'Electricity', quantity: 400, unit: 'MWh' },
    ]),
    outputs: JSON.stringify([
      { type: 'Crude steel', quantity: 920, unit: 'tonnes' },
    ]),
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  process data sheet (2.4)', () => {
  it('all compulsory fields with valid inputs and outputs → Tier A', () => {
    // Admissibility spec §2.4: all compulsory fields with ≥1 input and ≥1 output → Tier A
    const result = evaluateAdmissibility(
      'PROCESS_DATA_SHEET',
      fullProcessDataSheetFields(),
      'Acme Ltd',
    )
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing process_type → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.4: process_type is compulsory
    const fields = fullProcessDataSheetFields({ process_type: null })
    const result = evaluateAdmissibility('PROCESS_DATA_SHEET', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'process_type' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('empty inputs array → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.4: "Compulsory  -  min 1 input"
    const fields = fullProcessDataSheetFields({ inputs: '[]' })
    const result = evaluateAdmissibility('PROCESS_DATA_SHEET', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find((f) => f.fieldName === 'inputs' && f.severity === 'CRITICAL')
    expect(flag).toBeDefined()
  })

  it('empty outputs array → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.4: "Compulsory  -  min 1 output"
    const fields = fullProcessDataSheetFields({ outputs: '[]' })
    const result = evaluateAdmissibility('PROCESS_DATA_SHEET', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find((f) => f.fieldName === 'outputs' && f.severity === 'CRITICAL')
    expect(flag).toBeDefined()
  })

  it('energy_unit absent when energy_consumption present → WARNING', () => {
    // Admissibility spec §2.4: energy_unit conditional on energy_consumption
    const fields = [
      ...fullProcessDataSheetFields(),
      field('energy_consumption', '1440'),
    ]
    const result = evaluateAdmissibility('PROCESS_DATA_SHEET', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'energy_unit' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('energy_unit not flagged when energy_consumption is absent', () => {
    // Conditional only activates when energy_consumption is present
    const result = evaluateAdmissibility(
      'PROCESS_DATA_SHEET',
      fullProcessDataSheetFields(),
      'Acme Ltd',
    )
    expect(result.flags.find((f) => f.fieldName === 'energy_unit')).toBeUndefined()
  })
})

// ── 3.1 Freight Invoice ───────────────────────────────────────────────────────

function fullFreightInvoiceFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    carrier_name: 'Maersk Line',
    shipper_name: 'Acme Ltd',
    consignee_name: 'UK Steel Importer Ltd',
    origin_city: 'Hamburg',
    origin_country: 'DE',
    destination_city: 'Immingham',
    destination_country: 'GB',
    mode_of_transport: 'SEA',
    shipment_weight: '5000',
    weight_unit: 'kg',
    shipment_date: '2024-02-01',
    invoice_number: 'MRK-2024-00456',
    invoice_date: '2024-02-05',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  freight invoice (3.1)', () => {
  it('all compulsory fields, SEA mode → Tier A', () => {
    // Admissibility spec §3.1: all compulsory fields → Tier A for non-MULTIMODAL
    const result = evaluateAdmissibility(
      'FREIGHT_INVOICE',
      fullFreightInvoiceFields(),
      'Acme Ltd',
    )
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing invoice_number → Tier B with CRITICAL flag', () => {
    // Admissibility spec §3.1: invoice_number is compulsory
    const fields = fullFreightInvoiceFields({ invoice_number: null })
    const result = evaluateAdmissibility('FREIGHT_INVOICE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'invoice_number' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('missing shipment_weight → Tier B with CRITICAL flag', () => {
    // Admissibility spec §3.1: shipment_weight is compulsory
    const fields = fullFreightInvoiceFields({ shipment_weight: null })
    const result = evaluateAdmissibility('FREIGHT_INVOICE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'shipment_weight' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('MULTIMODAL mode without leg breakdown → WARNING for missing conditional', () => {
    // Admissibility spec §3.1: MULTIMODAL requires leg-level breakdown for Tier A emissions calc
    const fields = fullFreightInvoiceFields({ mode_of_transport: 'MULTIMODAL' })
    const result = evaluateAdmissibility('FREIGHT_INVOICE', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) =>
        f.fieldName === 'multimodal_leg_breakdown' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('ROAD mode without leg breakdown → no MISSING_CONDITIONAL_FIELD flag', () => {
    // Conditional only activates for MULTIMODAL
    const fields = fullFreightInvoiceFields({ mode_of_transport: 'ROAD' })
    const result = evaluateAdmissibility('FREIGHT_INVOICE', fields, 'Acme Ltd')
    expect(
      result.flags.find((f) => f.fieldName === 'multimodal_leg_breakdown'),
    ).toBeUndefined()
  })
})

// ── 2.2 Material Intake Record ────────────────────────────────────────────────

function fullMaterialIntakeFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    receiving_entity: 'Acme Ltd',
    receiving_site: 'Sheffield Steelworks',
    supplier_name: 'UK Steel Supplies Ltd',
    material_type: 'Scrap steel',
    material_specification: 'Heavy melting steel, Grade 1A, 6-8mm thickness',
    quantity: '50000',
    unit: 'kg',
    delivery_date: '2024-02-15',
    delivery_note_reference: 'DN-2024-00123',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  material intake record (2.2)', () => {
  it('all compulsory fields present → Tier A', () => {
    // Admissibility spec §2.2: all compulsory fields sufficient for Tier A
    const result = evaluateAdmissibility('MATERIAL_INTAKE', fullMaterialIntakeFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing delivery_note_reference → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.2: delivery_note_reference is compulsory
    const fields = fullMaterialIntakeFields({ delivery_note_reference: null })
    const result = evaluateAdmissibility('MATERIAL_INTAKE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'delivery_note_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('missing material_specification → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.2: material_specification is compulsory
    const fields = fullMaterialIntakeFields({ material_specification: null })
    const result = evaluateAdmissibility('MATERIAL_INTAKE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'material_specification' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('receiving_entity mismatch → WARNING entity mismatch flag', () => {
    // Universal quality check: entity name must match registered entity
    const fields = fullMaterialIntakeFields({ receiving_entity: 'Different Company Ltd' })
    const result = evaluateAdmissibility('MATERIAL_INTAKE', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'receiving_entity' && f.flagType === 'ENTITY_MISMATCH',
    )
    expect(flag?.severity).toBe('WARNING')
  })
})

// ── 1.2 Gas Bill ─────────────────────────────────────────────────────────────

function fullGasBillFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    account_holder_name: 'Acme Ltd',
    site_address: '1 Industrial Way, Sheffield',
    meter_reference: 'M1234567890',
    period_start: '2024-01-01',
    period_end: '2024-03-31',
    total_consumption_kwh: '250000',
    read_type: 'ACTUAL',
    supplier_name: 'British Gas Business',
    invoice_number: 'GAS-INV-001',
    invoice_date: '2024-04-01',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  gas bill (1.2)', () => {
  it('ACTUAL read with all compulsory fields → Tier A', () => {
    // Admissibility spec §1.2: all compulsory fields, read_type = ACTUAL → Tier A
    const result = evaluateAdmissibility('GAS_BILL', fullGasBillFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('ESTIMATED read → Tier B with CRITICAL flag', () => {
    // Admissibility spec §1.2: read_type = ESTIMATED → Tier B regardless of other fields
    const result = evaluateAdmissibility(
      'GAS_BILL',
      fullGasBillFields({ read_type: 'ESTIMATED' }),
      'Acme Ltd',
    )
    expect(result.tier).toBe('B')
    const flag = result.flags.find((f) => f.fieldName === 'read_type')
    expect(flag?.severity).toBe('CRITICAL')
  })

  it('missing meter_reference → Tier B with CRITICAL flag', () => {
    // Admissibility spec §1.2: meter_reference (MPRN or serial) is compulsory
    const fields = fullGasBillFields().filter((f) => f.fieldName !== 'meter_reference')
    const result = evaluateAdmissibility('GAS_BILL', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'meter_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('calorific_value present without calorific_value_unit → WARNING', () => {
    // Admissibility spec §1.2: calorific_value_unit conditional on calorific_value
    const fields = [
      ...fullGasBillFields(),
      field('total_consumption_m3', '8000'),
      field('calorific_value', '39.3'),
    ]
    const result = evaluateAdmissibility('GAS_BILL', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'calorific_value_unit' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('calorific_value_unit not flagged when calorific_value is absent', () => {
    // Conditional only activates when calorific_value is present
    const result = evaluateAdmissibility('GAS_BILL', fullGasBillFields(), 'Acme Ltd')
    expect(result.flags.find((f) => f.fieldName === 'calorific_value_unit')).toBeUndefined()
  })
})

// ── 1.3 Fuel Purchase Receipt ─────────────────────────────────────────────────

function fullFuelReceiptFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    purchaser_name: 'Acme Ltd',
    fuel_type: 'DIESEL',
    quantity: '5000',
    unit: 'LITRES',
    purchase_date: '2024-02-15',
    supplier_name: 'Shell UK',
    receipt_or_invoice_number: 'SHL-2024-001',
    use_type: 'STATIONARY_COMBUSTION',
    site_or_vehicle_reference: 'Sheffield Steelworks  -  Boiler Room 1',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  fuel purchase receipt (1.3)', () => {
  it('all compulsory fields present → Tier A', () => {
    // Admissibility spec §1.3: all compulsory fields sufficient for Tier A
    const result = evaluateAdmissibility('FUEL_RECEIPT', fullFuelReceiptFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('fuel_type OTHER without description → Tier B with CRITICAL GENERIC_VALUE flag', () => {
    // Admissibility spec §1.3: fuel_type = OTHER requires text description
    const fields = fullFuelReceiptFields({ fuel_type: 'OTHER' })
    const result = evaluateAdmissibility('FUEL_RECEIPT', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'fuel_type' && f.flagType === 'GENERIC_VALUE',
    )
    expect(flag?.severity).toBe('CRITICAL')
  })

  it('STATIONARY_COMBUSTION without site_or_vehicle_reference → WARNING', () => {
    // Admissibility spec §1.3: site_or_vehicle_reference conditional on use_type
    const fields = fullFuelReceiptFields({ site_or_vehicle_reference: null })
    const result = evaluateAdmissibility('FUEL_RECEIPT', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) =>
        f.fieldName === 'site_or_vehicle_reference' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('TRANSPORT without site_or_vehicle_reference → WARNING', () => {
    // Admissibility spec §1.3: site_or_vehicle_reference conditional on TRANSPORT use_type too
    const fields = fullFuelReceiptFields({ use_type: 'TRANSPORT', site_or_vehicle_reference: null })
    const result = evaluateAdmissibility('FUEL_RECEIPT', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) =>
        f.fieldName === 'site_or_vehicle_reference' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('purchaser_name mismatch → WARNING entity mismatch flag', () => {
    // Universal quality check: entity name must match registered entity
    const fields = fullFuelReceiptFields({ purchaser_name: 'Different Company Ltd' })
    const result = evaluateAdmissibility('FUEL_RECEIPT', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'purchaser_name' && f.flagType === 'ENTITY_MISMATCH',
    )
    expect(flag?.severity).toBe('WARNING')
  })
})

// ── 2.1 Production Log ────────────────────────────────────────────────────────

function fullProductionLogFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Acme Ltd',
    site_name: 'Sheffield Steelworks',
    product_type: 'Steel',
    product_specification: 'Hot-rolled coil, grade S355, 6mm',
    quantity_produced: '1200',
    unit: 'tonnes',
    period_start: '2024-01-01',
    period_end: '2024-01-31',
    process_stage: 'Electric arc furnace',
    log_or_batch_reference: 'BATCH-2024-001',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  production log (2.1)', () => {
  it('all compulsory fields → Tier A', () => {
    // Admissibility spec §2.1: all compulsory fields sufficient for Tier A
    const result = evaluateAdmissibility('PRODUCTION_LOG', fullProductionLogFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing log_or_batch_reference → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.1: log_or_batch_reference is compulsory
    const fields = fullProductionLogFields({ log_or_batch_reference: null })
    const result = evaluateAdmissibility('PRODUCTION_LOG', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'log_or_batch_reference' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('missing product_specification → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.1: product_specification (grade/composition) is compulsory
    const fields = fullProductionLogFields({ product_specification: null })
    const result = evaluateAdmissibility('PRODUCTION_LOG', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'product_specification' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('energy_consumption_total present without energy_unit → WARNING', () => {
    // Admissibility spec §2.1: energy_unit conditional on energy_consumption_total
    const fields = [...fullProductionLogFields(), field('energy_consumption_total', '1440')]
    const result = evaluateAdmissibility('PRODUCTION_LOG', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'energy_unit' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('energy_unit not flagged when energy_consumption_total is absent', () => {
    // Conditional only activates when energy_consumption_total is present
    const result = evaluateAdmissibility('PRODUCTION_LOG', fullProductionLogFields(), 'Acme Ltd')
    expect(result.flags.find((f) => f.fieldName === 'energy_unit')).toBeUndefined()
  })
})

// ── 4.1 Supplier Invoice ──────────────────────────────────────────────────────

function fullSupplierInvoiceFields(
  overrides: Record<string, string | null> = {},
): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    supplier_name: 'UK Steel Supplies Ltd',
    buyer_name: 'Acme Ltd',
    invoice_number: 'INV-2024-00456',
    invoice_date: '2024-02-20',
    line_items: JSON.stringify([
      {
        description: 'Heavy melting steel scrap, Grade 1A',
        quantity: 50000,
        unit: 'kg',
        unit_price: 0.32,
      },
    ]),
    currency: 'GBP',
    total_value: '16000',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  supplier invoice (4.1)', () => {
  it('all compulsory fields with valid line items → Tier A', () => {
    // Admissibility spec §4.1: all compulsory fields with ≥1 line item → Tier A
    const result = evaluateAdmissibility('SUPPLIER_INVOICE', fullSupplierInvoiceFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing invoice_number → Tier B with CRITICAL flag', () => {
    // Admissibility spec §4.1: invoice_number is compulsory
    const fields = fullSupplierInvoiceFields({ invoice_number: null })
    const result = evaluateAdmissibility('SUPPLIER_INVOICE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'invoice_number' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('empty line_items array → Tier B with CRITICAL flag', () => {
    // Admissibility spec §4.1: "Compulsory  -  min 1 line"
    const fields = fullSupplierInvoiceFields({ line_items: '[]' })
    const result = evaluateAdmissibility('SUPPLIER_INVOICE', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'line_items' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('buyer_name mismatch → WARNING entity mismatch flag', () => {
    // Universal quality check: entity name must match registered entity
    const fields = fullSupplierInvoiceFields({ buyer_name: 'Different Company Ltd' })
    const result = evaluateAdmissibility('SUPPLIER_INVOICE', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'buyer_name' && f.flagType === 'ENTITY_MISMATCH',
    )
    expect(flag?.severity).toBe('WARNING')
  })
})

// ── 2.3 Bill of Materials ─────────────────────────────────────────────────────

function fullBomFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Acme Ltd',
    product_type: 'Steel beam',
    product_specification: 'Universal beam UB 203x133x25, grade S355',
    bom_version: 'v2.1',
    effective_date: '2024-01-01',
    line_items: JSON.stringify([{ material_name: 'Steel billet', quantity: 25.8, unit: 'kg' }]),
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  bill of materials (2.3)', () => {
  it('all compulsory fields with valid line items → Tier A', () => {
    // Admissibility spec §2.3: all compulsory fields with ≥1 line item → Tier A
    const result = evaluateAdmissibility('BILL_OF_MATERIALS', fullBomFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing bom_version → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.3: bom_version is compulsory
    const fields = fullBomFields({ bom_version: null })
    const result = evaluateAdmissibility('BILL_OF_MATERIALS', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'bom_version' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('empty line_items array → Tier B with CRITICAL flag', () => {
    // Admissibility spec §2.3: "Empty line_items array → not admissible"
    const fields = fullBomFields({ line_items: '[]' })
    const result = evaluateAdmissibility('BILL_OF_MATERIALS', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'line_items' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('total_mass_unit absent when total_mass_per_unit present → WARNING', () => {
    // Admissibility spec §2.3: total_mass_unit conditional on total_mass_per_unit
    const fields = [...fullBomFields(), field('total_mass_per_unit', '25.8')]
    const result = evaluateAdmissibility('BILL_OF_MATERIALS', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'total_mass_unit' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag?.severity).toBe('WARNING')
  })

  it('total_mass_unit not flagged when total_mass_per_unit is absent', () => {
    // Conditional only activates when total_mass_per_unit is present
    const result = evaluateAdmissibility('BILL_OF_MATERIALS', fullBomFields(), 'Acme Ltd')
    expect(result.flags.find((f) => f.fieldName === 'total_mass_unit')).toBeUndefined()
  })
})

// ── CARBON FOOTPRINT REPORT ───────────────────────────────────────────────────

function fullCarbonFootprintFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    entity_name: 'Acme Ltd',
    report_title: 'Carbon Footprint Report FY2024',
    methodology: 'GHG Protocol Corporate Standard',
    system_boundary: 'Operational control  -  Scope 1 and 2',
    data_year: '2024',
    publication_date: '2025-03-31',
    total_co2e: '12500',
    total_co2e_unit: 'tCO2e',
    preparer_name: 'ERM Ltd',
    assurance_level: 'NONE',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  carbon footprint report', () => {
  // [GHG Protocol Corporate Standard Chapter 5] all compulsory fields required for Tier A
  it('all compulsory fields, assurance_level NONE → Tier A', () => {
    const result = evaluateAdmissibility('CARBON_FOOTPRINT_REPORT', fullCarbonFootprintFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing total_co2e → CRITICAL flag → Tier B', () => {
    const fields = fullCarbonFootprintFields({ total_co2e: null })
    const result = evaluateAdmissibility('CARBON_FOOTPRINT_REPORT', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'total_co2e' && f.severity === 'CRITICAL',
    )
    expect(flag).toBeDefined()
  })

  it('missing methodology → CRITICAL flag → Tier B', () => {
    const fields = fullCarbonFootprintFields({ methodology: null })
    const result = evaluateAdmissibility('CARBON_FOOTPRINT_REPORT', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    expect(result.flags.find((f) => f.fieldName === 'methodology' && f.severity === 'CRITICAL')).toBeDefined()
  })

  // [GHG Protocol Corporate Standard §9.4] third-party assurance requires naming the assurance body
  it('assurance_level LIMITED without assurance_body → WARNING MISSING_CONDITIONAL_FIELD', () => {
    const fields = fullCarbonFootprintFields({ assurance_level: 'LIMITED' })
    const result = evaluateAdmissibility('CARBON_FOOTPRINT_REPORT', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'assurance_body' && f.flagType === 'MISSING_CONDITIONAL_FIELD',
    )
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('WARNING')
  })

  it('assurance_level NONE  -  assurance_body not required → no MISSING_CONDITIONAL_FIELD', () => {
    const result = evaluateAdmissibility('CARBON_FOOTPRINT_REPORT', fullCarbonFootprintFields(), 'Acme Ltd')
    expect(result.flags.find((f) => f.fieldName === 'assurance_body' && f.flagType === 'MISSING_CONDITIONAL_FIELD')).toBeUndefined()
  })

  it('entity_name mismatch → WARNING ENTITY_MISMATCH flag', () => {
    const fields = fullCarbonFootprintFields({ entity_name: 'Wrong Company PLC' })
    const result = evaluateAdmissibility('CARBON_FOOTPRINT_REPORT', fields, 'Acme Ltd')
    const flag = result.flags.find(
      (f) => f.fieldName === 'entity_name' && f.flagType === 'ENTITY_MISMATCH',
    )
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('WARNING')
  })
})

// ── CHAIN OF CUSTODY ──────────────────────────────────────────────────────────

function fullChainOfCustodyFields(overrides: Record<string, string | null> = {}): ExtractedFieldResult[] {
  const defaults: Record<string, string> = {
    document_reference: 'COC-2024-001',
    product_type: 'Recycled steel scrap',
    custody_stages: JSON.stringify([
      { stage: 1, entity: 'UK Steel Scrap Merchants Ltd', location: 'Sheffield', date: '2024-01-10' },
      { stage: 2, entity: 'Acme Ltd', location: 'Rotherham', date: '2024-01-15' },
    ]),
    origin_entity: 'UK Steel Scrap Merchants Ltd',
    final_entity: 'Acme Ltd',
    certification_standard: 'ISO 14001',
  }
  return Object.entries({ ...defaults, ...overrides }).map(([k, v]) => field(k, v))
}

describe('evaluateAdmissibility  -  chain of custody', () => {
  // [Admissibility Spec §8.3] custody_stages must contain at least 2 entries (origin + destination)
  it('two custody stages → Tier A', () => {
    const result = evaluateAdmissibility('CHAIN_OF_CUSTODY', fullChainOfCustodyFields(), 'Acme Ltd')
    expect(result.tier).toBe('A')
    expect(result.criticalCount).toBe(0)
  })

  it('missing custody_stages → CRITICAL COMPLETENESS_GAP → Tier B', () => {
    const fields = fullChainOfCustodyFields({ custody_stages: null })
    const result = evaluateAdmissibility('CHAIN_OF_CUSTODY', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    expect(result.flags.find((f) => f.fieldName === 'custody_stages' && f.severity === 'CRITICAL')).toBeDefined()
  })

  // [Admissibility Spec §8.3] fewer than 2 stages cannot establish chain of custody  -  not admissible
  it('custody_stages with only 1 entry → CRITICAL COMPLETENESS_GAP → Tier B', () => {
    const oneStage = JSON.stringify([
      { stage: 1, entity: 'Acme Ltd', location: 'Rotherham', date: '2024-01-15' },
    ])
    const fields = fullChainOfCustodyFields({ custody_stages: oneStage })
    const result = evaluateAdmissibility('CHAIN_OF_CUSTODY', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    const flag = result.flags.find(
      (f) => f.fieldName === 'custody_stages' && f.flagType === 'COMPLETENESS_GAP',
    )
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('CRITICAL')
  })

  it('custody_stages empty array → CRITICAL COMPLETENESS_GAP → Tier B', () => {
    const fields = fullChainOfCustodyFields({ custody_stages: '[]' })
    const result = evaluateAdmissibility('CHAIN_OF_CUSTODY', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    expect(result.flags.find((f) => f.fieldName === 'custody_stages' && f.severity === 'CRITICAL')).toBeDefined()
  })

  it('missing document_reference → CRITICAL → Tier B', () => {
    const fields = fullChainOfCustodyFields({ document_reference: null })
    const result = evaluateAdmissibility('CHAIN_OF_CUSTODY', fields, 'Acme Ltd')
    expect(result.tier).toBe('B')
    expect(result.flags.find((f) => f.fieldName === 'document_reference' && f.severity === 'CRITICAL')).toBeDefined()
  })
})
