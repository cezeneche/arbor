import { selectReusableDocuments, describeDocument } from '../reusable-documents'

// A customs declaration uploaded last month is the same document a CBAM case
// needs this month. Re-uploading produces two records of one real-world
// document — exactly what a certified repository should never hold.

function doc(over: Partial<Parameters<typeof selectReusableDocuments>[0][number]> = {}) {
  return {
    id: 'doc-1',
    fileName: 'customs-entry.pdf',
    documentType: 'CUSTOMS_DECLARATION',
    status: 'ACCEPTED',
    submittedAt: new Date('2026-07-14T10:00:00Z'),
    ...over,
  }
}

describe('selectReusableDocuments', () => {
  it('offers a CBAM-relevant accepted document', () => {
    expect(selectReusableDocuments([doc()])).toHaveLength(1)
  })

  it('offers all three CBAM-relevant types', () => {
    const types = ['CUSTOMS_DECLARATION', 'SUPPLIER_INVOICE', 'CBAM_DECLARATION']
    const result = selectReusableDocuments(types.map(t => doc({ documentType: t })))
    expect(result).toHaveLength(3)
  })

  it('excludes documents that carry no CBAM data', () => {
    for (const t of ['ELECTRICITY_BILL', 'PRODUCTION_LOG', 'WASTE_RECORD']) {
      expect(selectReusableDocuments([doc({ documentType: t })])).toHaveLength(0)
    }
  })

  it('excludes a rejected document', () => {
    // No usable content — starting a case on it would never yield goods lines.
    expect(selectReusableDocuments([doc({ status: 'REJECTED' })])).toHaveLength(0)
  })

  it('excludes a document still being read', () => {
    // No usable content YET. Offering it invites a case that cannot complete.
    expect(selectReusableDocuments([doc({ status: 'EXTRACTING' })])).toHaveLength(0)
    expect(selectReusableDocuments([doc({ status: 'PENDING' })])).toHaveLength(0)
  })

  it('includes one still awaiting review', () => {
    // It has fields; the human has simply not confirmed them yet.
    expect(selectReusableDocuments([doc({ status: 'REVIEW_REQUIRED' })])).toHaveLength(1)
  })

  it('marks whether CBAM fields already exist', () => {
    // Drives whether the user is re-running extraction or reusing what is there.
    const [fresh] = selectReusableDocuments([doc()])
    expect(fresh.alreadyExtracted).toBe(false)

    const [done] = selectReusableDocuments([{ ...doc(), hasCbamFields: true }])
    expect(done.alreadyExtracted).toBe(true)
  })

  it('is case-insensitive about type and status', () => {
    expect(
      selectReusableDocuments([doc({ documentType: 'customs_declaration', status: 'accepted' })]),
    ).toHaveLength(1)
  })
})

describe('describeDocument', () => {
  it('reads as filename, kind and date', () => {
    const [d] = selectReusableDocuments([doc()])
    expect(describeDocument(d)).toBe('customs-entry.pdf · customs declaration · 2026-07-14')
  })

  it('handles a serialised date', () => {
    const [d] = selectReusableDocuments([doc({ submittedAt: '2026-07-14T10:00:00.000Z' })])
    expect(describeDocument(d)).toContain('2026-07-14')
  })
})
