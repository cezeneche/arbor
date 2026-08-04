// Trust tier already cannot be stripped from an export (PRD §21.2). The agreed
// definition has to be equally unstrippable: a buyer's system that receives
// "480000 MJ" and no statement of what was counted is back to the fragmented
// spreadsheet the platform exists to replace.
//
// These tests pin the guarantee at the formatter boundary — the last place data
// leaves the platform — so a future edit cannot quietly drop the columns.

import { formatRecordsAsCSV, type ExportRecord } from '../csv-formatter'
import { formatRecordsAsXML } from '../xml-formatter'

const record: ExportRecord = {
  id: 'rec-1',
  domain: 'ENERGY',
  fieldName: 'total_consumption_kwh',
  value: 480000,
  unit: 'mj',
  trustTier: 'A',
  confidenceScore: 0.95,
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
  periodEnd: new Date('2026-03-31T23:59:59.000Z'),
  extractionMethod: 'DOCUMENT_AI',
  documentId: 'doc-123',
  definition: {
    fieldDefinitionId: 'def-1',
    version: 1,
    label: 'Energy used',
    definition: 'The total electricity your site drew from the supply network.',
    boundary: 'Includes all metered supply. Excludes on-site generation.',
    canonicalUnit: 'mj',
    sourceStandard: 'Arbor Admissibility Spec v1.0',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  },
  agreement: {
    status: 'AGREED',
    label: 'Agreed with your customer',
    agreedVersion: 1,
    agreedAt: new Date('2026-02-01T00:00:00.000Z'),
  },
}

describe('CSV export carries the agreed definition', () => {
  it('names the definition columns in the header', () => {
    const header = formatRecordsAsCSV([record]).split('\r\n')[0]
    expect(header).toContain('definitionVersion')
    expect(header).toContain('definitionLabel')
    expect(header).toContain('definitionBoundary')
    expect(header).toContain('definitionAgreement')
  })

  it('writes the wording and the boundary into the row', () => {
    const csv = formatRecordsAsCSV([record])
    expect(csv).toContain('Energy used')
    expect(csv).toContain('Excludes on-site generation')
  })

  it('writes the agreement state, not just the definition', () => {
    // The distinction that matters: Arbor said this, AND the buyer agreed it.
    expect(formatRecordsAsCSV([record])).toContain('AGREED')
  })

  it('quotes definition text containing commas so the CSV stays valid', () => {
    const withComma: ExportRecord = {
      ...record,
      definition: { ...record.definition!, boundary: 'Includes metered supply, all of it. Excludes exports.' },
    }
    const row = formatRecordsAsCSV([withComma]).split('\r\n')[1]
    expect(row).toContain('"Includes metered supply, all of it. Excludes exports."')
  })

  it('emits empty definition cells but a NONE agreement for an ungoverned field', () => {
    // Honest absence, and the row keeps its shape so the file still parses.
    const undefinedField: ExportRecord = { ...record, definition: null, agreement: undefined }
    const lines = formatRecordsAsCSV([undefinedField]).split('\r\n')
    const headerCount = lines[0].split(',').length
    expect(lines[1].split(',').length).toBe(headerCount)
    expect(lines[1]).toContain('NONE')
  })

  it('still exports records that were never decorated at all', () => {
    // Backwards compatible: a caller that has not wired the decorator yet gets a
    // valid file, not a crash.
    const bare = { ...record }
    delete (bare as Partial<ExportRecord>).definition
    delete (bare as Partial<ExportRecord>).agreement
    const lines = formatRecordsAsCSV([bare]).split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1].split(',').length).toBe(lines[0].split(',').length)
  })
})

describe('XML export carries the agreed definition', () => {
  it('nests a Definition element with the wording and boundary', () => {
    const xml = formatRecordsAsXML([record])
    expect(xml).toContain('<Definition')
    expect(xml).toContain('<Label>Energy used</Label>')
    expect(xml).toContain('Excludes on-site generation')
  })

  it('carries the agreement state as an attribute on the definition', () => {
    expect(formatRecordsAsXML([record])).toContain('agreement="AGREED"')
  })

  it('escapes definition text so an ampersand cannot break the document', () => {
    const risky: ExportRecord = {
      ...record,
      definition: { ...record.definition!, label: 'Waste & water' },
    }
    const xml = formatRecordsAsXML([risky])
    expect(xml).toContain('Waste &amp; water')
    expect(xml).not.toContain('Waste & water')
  })

  it('states explicitly that an ungoverned field has no agreed definition', () => {
    const undefinedField: ExportRecord = { ...record, definition: null, agreement: undefined }
    const xml = formatRecordsAsXML([undefinedField])
    expect(xml).toContain('<Definition agreement="NONE" governed="false"')
  })
})
