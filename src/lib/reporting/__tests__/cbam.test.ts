import { buildCbamUkReturn, type CbamInput } from '../cbam-uk'
import { buildCbamEuXml } from '../cbam-eu-xml'

function makeCbamRecord(
  id: string,
  value: number,
  trustTier: 'A' | 'B' | 'C' = 'A',
): CbamInput['declarations'][0] {
  return {
    id,
    declarationReference: `MRN-2024-${id}`,
    commodityCode: '72041000',
    commodityDescription: 'Ferrous waste and scrap',
    countryOfOrigin: 'GB',
    importerName: 'Acme Ltd',
    declarantName: 'Acme Ltd',
    declaredWeight: 1000,
    embeddedEmissionsKgCo2e: value,
    calculationTier: 'TIER_2',
    trustTier,
    periodStart: new Date('2024-01-01'),
    periodEnd: new Date('2024-03-31'),
  }
}

const BASE_INPUT: CbamInput = {
  entityName: 'Acme Ltd',
  entityId: 'entity-1',
  quarter: 'Q1',
  year: 2024,
  declarations: [
    makeCbamRecord('d1', 5000, 'A'),
    makeCbamRecord('d2', 3000, 'B'),
  ],
}

// [EU Regulation 2023/1773 Art. 4(1)] CBAM quarterly return
describe('buildCbamUkReturn @regulatory', () => {
  it('returns correct quarter and year [EU 2023/1773 Art. 4(1)]', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    expect(result.quarter).toBe('Q1')
    expect(result.year).toBe(2024)
  })

  it('includes regulatory reference to EU 2023/1773', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    expect(result.regulatoryReference).toContain('2023/1773')
  })

  it('totalEmbeddedEmissionsKgCo2e is sum of all declarations', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    expect(result.totalEmbeddedEmissionsKgCo2e).toBe(8000)
  })

  it('entityName is preserved', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    expect(result.entityName).toBe('Acme Ltd')
  })

  it('all declarations are included in the return', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    expect(result.declarations).toHaveLength(2)
  })

  // [EU 2023/1773 Art. 4(1)] trust tier must be present on each declaration
  it('trust tier travels with each declaration [EU 2023/1773 Art. 4(1)]', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    for (const d of result.declarations) {
      expect(['A', 'B', 'C']).toContain(d.trustTier)
    }
  })

  it('Tier B declarations are flagged as requiring supplementary verification', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    const tierB = result.declarations.find((d) => d.trustTier === 'B')
    expect(tierB?.requiresVerification).toBe(true)
  })

  it('Tier A declarations do not require supplementary verification', () => {
    const result = buildCbamUkReturn(BASE_INPUT)
    const tierA = result.declarations.find((d) => d.trustTier === 'A')
    expect(tierA?.requiresVerification).toBe(false)
  })

  it('is a pure function', () => {
    const a = buildCbamUkReturn(BASE_INPUT)
    const b = buildCbamUkReturn(BASE_INPUT)
    expect(a.totalEmbeddedEmissionsKgCo2e).toBe(b.totalEmbeddedEmissionsKgCo2e)
  })
})

// [EU Regulation 2023/1773 Annex I] CBAM EU XML submission
describe('buildCbamEuXml @regulatory', () => {
  it('returns a non-empty XML string [EU 2023/1773 Annex I]', () => {
    const xml = buildCbamEuXml(BASE_INPUT)
    expect(typeof xml).toBe('string')
    expect(xml.length).toBeGreaterThan(0)
  })

  it('XML contains entity name', () => {
    const xml = buildCbamEuXml(BASE_INPUT)
    expect(xml).toContain('Acme Ltd')
  })

  it('XML contains reporting year', () => {
    const xml = buildCbamEuXml(BASE_INPUT)
    expect(xml).toContain('2024')
  })

  it('XML contains each commodity code [EU 2023/1773 Annex I §2]', () => {
    const xml = buildCbamEuXml(BASE_INPUT)
    expect(xml).toContain('72041000')
  })

  it('is a pure function', () => {
    const a = buildCbamEuXml(BASE_INPUT)
    const b = buildCbamEuXml(BASE_INPUT)
    expect(a).toBe(b)
  })
})
