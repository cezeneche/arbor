import { formatRecordsAsCSV } from '../csv-formatter'
import type { ExportRecord } from '../csv-formatter'

const record: ExportRecord = {
  id: 'rec-1',
  domain: 'ENERGY',
  fieldName: 'electricity_kwh',
  value: 12500.5,
  unit: 'kWh',
  trustTier: 'A',
  confidenceScore: 0.95,
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
  periodEnd: new Date('2026-03-31T23:59:59.000Z'),
  extractionMethod: 'DOCUMENT_AI',
  documentId: 'doc-123',
}

describe('formatRecordsAsCSV', () => {
  it('produces a header row as the first line', () => {
    // The definition columns are part of the contract, not an optional annex:
    // the agreed wording travels with every record exactly as trust tier does.
    const csv = formatRecordsAsCSV([record])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'id,domain,fieldName,value,unit,trustTier,confidenceScore,periodStart,periodEnd,extractionMethod,sourceDocumentId,' +
        'definitionVersion,definitionLabel,definitionText,definitionBoundary,definitionSource,definitionAgreement,definitionAgreedVersion',
    )
  })

  it('always includes trustTier in the output', () => {
    const csv = formatRecordsAsCSV([record])
    expect(csv).toContain('A')
  })

  it('produces one data row per record', () => {
    const csv = formatRecordsAsCSV([record, { ...record, id: 'rec-2' }])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3) // header + 2 data rows
  })

  it('returns header only for an empty array', () => {
    const csv = formatRecordsAsCSV([])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(1)
  })

  it('escapes commas inside field values', () => {
    const r: ExportRecord = { ...record, fieldName: 'energy,heat' }
    const csv = formatRecordsAsCSV([r])
    expect(csv).toContain('"energy,heat"')
  })

  it('escapes double-quotes inside field values', () => {
    const r: ExportRecord = { ...record, fieldName: 'energy "peak"' }
    const csv = formatRecordsAsCSV([r])
    expect(csv).toContain('"energy ""peak"""')
  })

  it('writes empty string for null documentId', () => {
    const r: ExportRecord = { ...record, documentId: null }
    const csv = formatRecordsAsCSV([r])
    const lines = csv.split('\r\n')
    expect(lines[1]).toMatch(/,$/)
  })

  it('serialises Date objects to ISO strings', () => {
    const csv = formatRecordsAsCSV([record])
    expect(csv).toContain('2026-01-01T00:00:00.000Z')
  })
})
