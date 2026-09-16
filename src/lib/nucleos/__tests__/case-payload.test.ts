import { buildCasePayload } from '../case-payload'

// A realistic confirmed set from one customs declaration: two goods lines, one
// with a supplier emissions figure and one without.
function confirmed(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      importer_name: 'Midlands Steel Ltd',
      importer_eori: 'GB123456789000',
      origin_country: 'IN',
      entry_reference: 'MRN-2027-000123',
      'lines[0].cn_code': '72081000',
      'lines[0].description': 'Hot-rolled coil',
      'lines[0].net_mass_kg': '24000',
      'lines[0].direct_embedded_kgco2e': '43200',
      'lines[0].emissions_method': 'ACTUAL',
      'lines[0].production_route': 'BF_BOF',
      'lines[1].cn_code': '76011000',
      'lines[1].description': 'Unwrought aluminium',
      'lines[1].net_mass_kg': '5000',
      ...overrides,
    }),
  )
}

const PERIOD_END = new Date('2027-03-31T00:00:00Z')

describe('buildCasePayload', () => {
  it('builds a case, one shipment and one goods line per confirmed line', () => {
    const result = buildCasePayload({
      confirmed: confirmed(),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    })

    expect(result.problems).toEqual([])
    expect(result.payload).not.toBeNull()

    const p = result.payload!
    expect(p.case.importer_eori).toBe('GB123456789000')
    expect(p.case.importer_name).toBe('Midlands Steel Ltd')
    expect(p.case.reporting_year).toBe(2027)
    expect(p.case.reporting_quarter).toBe(1)
    expect(p.case.jurisdiction).toBe('UK')

    expect(p.shipment.origin_country).toBe('IN')
    // The MRN goes to entry_reference. It used to be sent as
    // customs_procedure, which stored a customs entry number as a procedure
    // code and left an uncloseable "entry reference missing" gap on the case.
    expect(p.shipment.entry_reference).toBe('MRN-2027-000123')
    expect(p.lines).toHaveLength(2)
    expect(p.lines[0]).toMatchObject({
      lineIndex: 0,
      cn_code: '72081000',
      product_description: 'Hot-rolled coil',
      net_mass_kg: 24000,
    })
    expect(p.lines[1]).toMatchObject({ lineIndex: 1, cn_code: '76011000', net_mass_kg: 5000 })
  })

  it('carries the emissions figure and method onto the line that has one', () => {
    const p = buildCasePayload({
      confirmed: confirmed(),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    }).payload!

    expect(p.lines[0].emissions).toEqual({
      direct_emissions_kgco2e: 43200,
      indirect_emissions_kgco2e: null,
      calculation_method: 'actual',
      production_route: 'BF_BOF',
    })
  })

  // A line with no supplier figure is not given one here. Choosing the default
  // is the engine's decision, made with the mark-up and recorded as a rejected
  // method — inventing a zero at this point would produce a line that declares
  // no emissions rather than one awaiting a figure.
  it('leaves a line with no supplier figure without an emissions record', () => {
    const p = buildCasePayload({
      confirmed: confirmed(),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    }).payload!

    expect(p.lines[1].emissions).toBeNull()
  })

  it('prefers a line-level origin over the document-level one', () => {
    const p = buildCasePayload({
      confirmed: confirmed({ 'lines[0].origin_country': 'TR' }),
      jurisdiction: 'EU',
      reportingPeriodEnd: PERIOD_END,
    }).payload!

    expect(p.lines[0].origin_country).toBe('TR')
    expect(p.lines[1].origin_country).toBe('IN')
  })

  // Nucleos requires an EORI to create a case, and a case attributed to the
  // wrong importer is worse than no case: it is a declaration filed against
  // somebody else's identity.
  it('refuses to build a case with no importer EORI', () => {
    const map = confirmed()
    map.delete('importer_eori')
    const result = buildCasePayload({
      confirmed: map,
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    })

    expect(result.payload).toBeNull()
    expect(result.problems.join(' ')).toMatch(/importer/i)
  })

  it('refuses to build a case with no goods line carrying both a code and a mass', () => {
    const map = new Map([
      ['importer_eori', 'GB123456789000'],
      ['lines[0].description', 'Something'],
    ])
    const result = buildCasePayload({
      confirmed: map,
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    })

    expect(result.payload).toBeNull()
    expect(result.problems.join(' ')).toMatch(/goods line/i)
  })

  it('drops an incomplete line but keeps the case when another line is usable', () => {
    const map = confirmed()
    map.delete('lines[1].net_mass_kg')
    const result = buildCasePayload({
      confirmed: map,
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    })

    expect(result.payload!.lines).toHaveLength(1)
    // Dropping a line silently would understate the declaration, so it is said.
    expect(result.problems.join(' ')).toMatch(/line 2/i)
  })

  // Nucleos's create endpoint validates quarter 1-4, so a period that cannot
  // produce one has to be resolved here rather than rejected over the wire.
  it('derives the quarter from the reporting period end', () => {
    for (const [iso, quarter] of [
      ['2027-01-31T00:00:00Z', 1],
      ['2027-04-01T00:00:00Z', 2],
      ['2027-09-30T00:00:00Z', 3],
      ['2027-12-31T00:00:00Z', 4],
    ] as const) {
      const p = buildCasePayload({
        confirmed: confirmed(),
        jurisdiction: 'UK',
        reportingPeriodEnd: new Date(iso),
      }).payload!
      expect(p.case.reporting_quarter).toBe(quarter)
    }
  })

  it('sends the import date as an ISO day when the document carried one', () => {
    const p = buildCasePayload({
      confirmed: confirmed({ import_date: '2027-02-14' }),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    }).payload!
    expect(p.shipment.import_date).toBe('2027-02-14')
  })

  // Null, not today. The service defaults to the day the case was opened, and a
  // wrong date that looks deliberate is worse than an obvious default.
  it('sends no import date rather than an invented one', () => {
    const p = buildCasePayload({
      confirmed: confirmed({ import_date: 'sometime in spring' }),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    }).payload!
    expect(p.shipment.import_date).toBeNull()
  })

  it('maps BOTH straight through — Nucleos has a case jurisdiction for it', () => {
    const p = buildCasePayload({
      confirmed: confirmed(),
      jurisdiction: 'BOTH',
      reportingPeriodEnd: PERIOD_END,
    }).payload!
    expect(p.case.jurisdiction).toBe('BOTH')
  })

  it('ignores a value that is not a number where a number is required', () => {
    const result = buildCasePayload({
      confirmed: confirmed({ 'lines[0].net_mass_kg': 'about 24 tonnes' }),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    })
    // Line 1 becomes unusable; line 2 still stands.
    expect(result.payload!.lines.map(l => l.lineIndex)).toEqual([1])
  })

  it('normalises the emissions method to the lower-case form Nucleos accepts', () => {
    const p = buildCasePayload({
      confirmed: confirmed({ 'lines[0].emissions_method': 'DEFAULT' }),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    }).payload!
    expect(p.lines[0].emissions?.calculation_method).toBe('default')
  })

  it('falls back to actual when a supplier figure arrives with no stated method', () => {
    const map = confirmed()
    map.delete('lines[0].emissions_method')
    const p = buildCasePayload({
      confirmed: map,
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    }).payload!
    expect(p.lines[0].emissions?.calculation_method).toBe('actual')
  })

  it('rejects an emissions method Nucleos does not accept rather than sending it', () => {
    const result = buildCasePayload({
      confirmed: confirmed({ 'lines[0].emissions_method': 'GUESSED' }),
      jurisdiction: 'UK',
      reportingPeriodEnd: PERIOD_END,
    })
    expect(result.payload!.lines[0].emissions?.calculation_method).toBe('actual')
    expect(result.problems.join(' ')).toMatch(/GUESSED/)
  })
})
