import { buildCsrdE1Disclosure, type CsrdInput } from '../csrd'

function makeRecord(
  id: string,
  domain: string,
  fieldName: string,
  value: number,
  unit: string,
  trustTier: 'A' | 'B' | 'C' = 'A',
  scope3Category: number | null = null,
): CsrdInput['dataRecords'][0] {
  return {
    id,
    domain,
    fieldName,
    value,
    unit,
    trustTier,
    scope3Category,
    periodStart: new Date('2024-01-01'),
    periodEnd: new Date('2024-12-31'),
  }
}

const BASE_INPUT: CsrdInput = {
  entityName: 'Acme Ltd',
  reportingYear: 2024,
  dataRecords: [
    makeRecord('r1', 'ENERGY', 'total_consumption_kwh', 150000, 'kWh'),
    makeRecord('r2', 'FREIGHT', 'shipment_weight', 500, 'tonnes'),
  ],
}

// [EU 2023/2772 Commission Delegated Regulation — ESRS E1 Climate Change]
describe('buildCsrdE1Disclosure @regulatory', () => {
  it('returns disclosure with entityName and reportingYear [EU 2023/2772 ESRS E1]', () => {
    const disclosure = buildCsrdE1Disclosure(BASE_INPUT)
    expect(disclosure.entityName).toBe('Acme Ltd')
    expect(disclosure.reportingYear).toBe(2024)
  })

  it('standard reference is ESRS E1 [EU 2023/2772]', () => {
    const disclosure = buildCsrdE1Disclosure(BASE_INPUT)
    expect(disclosure.standard).toBe('ESRS E1')
    expect(disclosure.regulatoryReference).toContain('EU 2023/2772')
  })

  it('trust tier travels with every mapped data point [EU 2023/2772 Art. 8]', () => {
    const disclosure = buildCsrdE1Disclosure(BASE_INPUT)
    for (const record of disclosure.dataPoints) {
      expect(['A', 'B', 'C']).toContain(record.trustTier)
    }
  })

  it('all input records appear as data points', () => {
    const disclosure = buildCsrdE1Disclosure(BASE_INPUT)
    expect(disclosure.dataPoints).toHaveLength(2)
  })

  it('Tier B data points are flagged as estimated [EU 2023/2772 §4.3]', () => {
    const input: CsrdInput = {
      ...BASE_INPUT,
      dataRecords: [makeRecord('r1', 'ENERGY', 'total_consumption_kwh', 150000, 'kWh', 'B')],
    }
    const disclosure = buildCsrdE1Disclosure(input)
    const dp = disclosure.dataPoints[0]
    expect(dp.isEstimated).toBe(true)
  })

  it('Tier A data points are not flagged as estimated', () => {
    const disclosure = buildCsrdE1Disclosure(BASE_INPUT)
    const tierA = disclosure.dataPoints.find((d) => d.trustTier === 'A')
    expect(tierA?.isEstimated).toBe(false)
  })

  it('Tier C data points are flagged as estimated', () => {
    const input: CsrdInput = {
      ...BASE_INPUT,
      dataRecords: [makeRecord('r1', 'ENERGY', 'total_consumption_kwh', 0, 'kWh', 'C')],
    }
    const disclosure = buildCsrdE1Disclosure(input)
    expect(disclosure.dataPoints[0].isEstimated).toBe(true)
  })

  it('empty records → empty data points', () => {
    const disclosure = buildCsrdE1Disclosure({ ...BASE_INPUT, dataRecords: [] })
    expect(disclosure.dataPoints).toHaveLength(0)
  })

  it('is a pure function — same inputs return same outputs', () => {
    const a = buildCsrdE1Disclosure(BASE_INPUT)
    const b = buildCsrdE1Disclosure(BASE_INPUT)
    expect(a.dataPoints.length).toBe(b.dataPoints.length)
    expect(a.reportingYear).toBe(b.reportingYear)
  })
})
