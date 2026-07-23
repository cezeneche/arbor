import { buildBuyerLabel } from '../buyer-signal'

// Buyer-side learning signal (pure; no DB). A buyer viewing a shared record can
// confirm it looks right or dispute it. Either becomes a GroundTruthLabel tagged
// with a buyer source, so it is recorded and drives the correction loop — but is
// distinguishable from the data owner's authoritative review labels.

const base = {
  entityId: 'supplier_1',
  documentId: 'doc_1',
  recordId: 'rec_1',
  fieldName: 'declared_weight',
  documentClass: 'CUSTOMS_DECLARATION',
  domain: 'LOGISTICS',
  confidenceAtExtraction: 0.8,
  extractorVersion: 'claude-sonnet-4-6+v1',
}

describe('buildBuyerLabel', () => {
  it('maps a dispute to a BUYER_DISPUTED, wasCorrect=false label with the buyer’s suggestion', () => {
    const label = buildBuyerLabel({ ...base, decision: 'dispute', recordValue: '1000', suggestedValue: '100' })
    expect(label).toMatchObject({
      source: 'BUYER_DISPUTED',
      wasCorrect: false,
      extractedValue: '1000',
      confirmedValue: '100',
      recordId: 'rec_1',
      entityId: 'supplier_1',
      extractorVersion: 'claude-sonnet-4-6+v1',
    })
  })

  it('a dispute without a suggested value still records the disagreement (confirmedValue null)', () => {
    const label = buildBuyerLabel({ ...base, decision: 'dispute', recordValue: '1000' })
    expect(label.source).toBe('BUYER_DISPUTED')
    expect(label.wasCorrect).toBe(false)
    expect(label.confirmedValue).toBeNull()
  })

  it('maps a confirm to a BUYER_CONFIRMED, wasCorrect=true label vouching for the value', () => {
    const label = buildBuyerLabel({ ...base, decision: 'confirm', recordValue: '1000' })
    expect(label).toMatchObject({
      source: 'BUYER_CONFIRMED',
      wasCorrect: true,
      extractedValue: '1000',
      confirmedValue: '1000',
    })
  })

  it('carries no review-UI ranking signal (buyer labels are not review-ranked)', () => {
    const label = buildBuyerLabel({ ...base, decision: 'confirm', recordValue: '1000' })
    expect(label.expectedInformationGain).toBeNull()
    expect(label.lowInformation).toBeNull()
  })

  it('clamps an out-of-range confidence into [0,1]', () => {
    const label = buildBuyerLabel({ ...base, decision: 'confirm', recordValue: '1', confidenceAtExtraction: 1.4 })
    expect(label.confidenceAtExtraction).toBe(1)
  })

  it('defaults extractorVersion to null when the record has none', () => {
    const { extractorVersion, ...noVersion } = base
    void extractorVersion
    const label = buildBuyerLabel({ ...noVersion, decision: 'dispute', recordValue: '1000' })
    expect(label.extractorVersion).toBeNull()
  })
})
