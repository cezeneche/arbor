import { groupRecordsByDocument, type RecordRow } from '../group-records'

// each stored record is one field; the constraint check needs a
// document's fields together. This regroups them.

function row(documentId: string, fieldName: string, value: number, sector: string | null = 'steel'): RecordRow {
  return { documentId, fieldName, value, sector }
}

describe('groupRecordsByDocument', () => {
  it('collects a document’s fields into one bag with its sector', () => {
    const grouped = groupRecordsByDocument([
      row('doc1', 'quantity_tonnes', 100),
      row('doc1', 'embedded_emissions_tco2e', 200),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toEqual({
      id: 'doc1',
      sector: 'steel',
      fields: { quantity_tonnes: 100, embedded_emissions_tco2e: 200 },
    })
  })

  it('separates fields across documents', () => {
    const grouped = groupRecordsByDocument([
      row('doc1', 'quantity_tonnes', 100),
      row('doc2', 'quantity_tonnes', 50, 'cement'),
    ])
    expect(grouped.map(g => g.id).sort()).toEqual(['doc1', 'doc2'])
    expect(grouped.find(g => g.id === 'doc2')!.sector).toBe('cement')
  })

  it('keeps the first non-null sector for a document', () => {
    const grouped = groupRecordsByDocument([
      row('doc1', 'a', 1, null),
      row('doc1', 'b', 2, 'aluminium'),
    ])
    expect(grouped[0].sector).toBe('aluminium')
  })
})
