import {
  applySupplierSubmission,
  buildSupplierDisplayContext,
  SupplierSubmissionError,
} from '../supplier-request'

// This flow has its own shape, deliberately not Arbor's DataRequest. A
// DataRequest asks for certified records the supplier already holds and
// summarises them; this asks for an intensity that has to be multiplied into a
// mass-weighted total. Reusing that assembly would break quietly — the number
// would still look like a number.

const LINE = {
  goodsLineId: 'gl-1',
  cnCode: '72071111',
  netMassKg: 24500,
  goodsDescription: 'Semi-finished iron billets',
  originCountry: 'TR',
}

describe('applySupplierSubmission', () => {
  it('multiplies the intensity into a total', () => {
    // 1.8 tCO2e/t × 24500 kg = 44100 kgCO2e, because 1 tCO2e/t is 1 kgCO2e/kg.
    const applied = applySupplierSubmission(
      { see_tco2e_per_t: 1.8, production_route: 'BF_BOF' },
      LINE,
    )
    expect(applied.directEmbeddedKgco2e).toBeCloseTo(44100)
  })

  it('never treats the submitted figure as a total', () => {
    // The failure this whole module exists to prevent: taking 1.8 as the total
    // understates a 24.5-tonne consignment by a factor of 24,500.
    const applied = applySupplierSubmission(
      { see_tco2e_per_t: 1.8, production_route: 'BF_BOF' },
      LINE,
    )
    expect(applied.directEmbeddedKgco2e).not.toBe(1.8)
  })

  it('preserves the intensity as submitted, for the audit trail', () => {
    const applied = applySupplierSubmission(
      { see_tco2e_per_t: 1.8, production_route: 'EAF' },
      LINE,
    )
    expect(applied.seeTco2ePerT).toBe(1.8)
    expect(applied.netMassKg).toBe(24500)
  })

  it('requires a production route', () => {
    // Annex VI defaults are differentiated by route, so without it the figure
    // cannot be checked against the right default.
    expect(() =>
      applySupplierSubmission({ see_tco2e_per_t: 1.8, production_route: '  ' }, LINE),
    ).toThrow(SupplierSubmissionError)
  })

  it('rejects a non-positive intensity', () => {
    for (const value of [0, -1, Number.NaN]) {
      expect(() =>
        applySupplierSubmission({ see_tco2e_per_t: value, production_route: 'EAF' }, LINE),
      ).toThrow(SupplierSubmissionError)
    }
  })

  it('rejects a line with no usable mass rather than producing zero', () => {
    // A zero total would read as "measured, and it is zero".
    expect(() =>
      applySupplierSubmission(
        { see_tco2e_per_t: 1.8, production_route: 'EAF' },
        { ...LINE, netMassKg: 0 },
      ),
    ).toThrow(/net mass/i)
  })

  it('normalises an optional installation name', () => {
    expect(
      applySupplierSubmission(
        { see_tco2e_per_t: 1.8, production_route: 'EAF', installation_name: '  Gemlik  ' },
        LINE,
      ).installationName,
    ).toBe('Gemlik')
    expect(
      applySupplierSubmission({ see_tco2e_per_t: 1.8, production_route: 'EAF' }, LINE)
        .installationName,
    ).toBeNull()
  })
})

describe('buildSupplierDisplayContext', () => {
  it('carries everything needed to identify the shipment', () => {
    // The supplier has no Arbor account. A supplier who cannot tell which
    // shipment is being asked about will not answer.
    const ctx = buildSupplierDisplayContext(LINE, 'Northern Steel Stockholders Ltd', 'Q1 2027')
    expect(ctx.importer_name).toBe('Northern Steel Stockholders Ltd')
    expect(ctx.cn_code).toBe('72071111')
    expect(ctx.net_mass_kg).toBe(24500)
    expect(ctx.origin_country).toBe('TR')
    expect(ctx.reporting_period).toBe('Q1 2027')
  })

  it('nulls optional context rather than omitting the keys', () => {
    const ctx = buildSupplierDisplayContext(
      { goodsLineId: 'gl-2', cnCode: '76011000', netMassKg: 12000 },
      'Midlands Extrusions Ltd',
    )
    expect(ctx.goods_description).toBeNull()
    expect(ctx.reporting_period).toBeNull()
  })
})
