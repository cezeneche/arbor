import { formatRecordsAsXML } from '../xml-formatter'
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

describe('formatRecordsAsXML', () => {
  it('produces a valid XML declaration header', () => {
    const xml = formatRecordsAsXML([record])
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  })

  it('wraps output in an ArborExport root element', () => {
    const xml = formatRecordsAsXML([record])
    expect(xml).toContain('<ArborExport')
    expect(xml).toContain('</ArborExport>')
  })

  it('always includes trustTier as an attribute on every Record element', () => {
    const xml = formatRecordsAsXML([record])
    expect(xml).toContain('trustTier="A"')
  })

  it('includes trustTier on every record when multiple records are present', () => {
    const records = [
      { ...record, id: 'r1', trustTier: 'A' },
      { ...record, id: 'r2', trustTier: 'B' },
      { ...record, id: 'r3', trustTier: 'C' },
    ] as ExportRecord[]
    const xml = formatRecordsAsXML(records)
    expect(xml).toContain('trustTier="A"')
    expect(xml).toContain('trustTier="B"')
    expect(xml).toContain('trustTier="C"')
  })

  it('sets the correct recordCount on the root element', () => {
    const xml = formatRecordsAsXML([record, { ...record, id: 'r2' }])
    expect(xml).toContain('recordCount="2"')
  })

  it('produces an empty ArborExport element for zero records', () => {
    const xml = formatRecordsAsXML([])
    expect(xml).toContain('recordCount="0"')
    expect(xml).not.toContain('<Record')
  })

  it('escapes XML special characters in field values', () => {
    const r: ExportRecord = { ...record, fieldName: 'energy & heat <peak>' }
    const xml = formatRecordsAsXML([r])
    expect(xml).toContain('energy &amp; heat &lt;peak&gt;')
    expect(xml).not.toContain('<peak>')
  })

  it('serialises Date objects to ISO strings', () => {
    const xml = formatRecordsAsXML([record])
    expect(xml).toContain('2026-01-01T00:00:00.000Z')
  })
})
