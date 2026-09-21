import { explainGap, presentGaps } from '../gap-vocabulary'

describe('explainGap', () => {
  it('says what is missing and where, in plain English', () => {
    expect(explainGap('case:importer_eori_missing', 'blocking')).toEqual({
      raw: 'case:importer_eori_missing',
      what: 'the importer’s EORI number',
      where: 'This case',
      severity: 'blocking',
    })
  })

  it('reads the part of the case from the token’s prefix', () => {
    expect(explainGap('shipment:abc-123:origin_country_missing', 'blocking').where).toBe(
      'A consignment',
    )
    expect(explainGap('goods_line:abc-123:cn_code_missing', 'blocking').where).toBe(
      'A goods line',
    )
  })

  // The token is what a support conversation needs, and what a user needs is a
  // sentence. Both, never one instead of the other.
  it('always keeps the raw token', () => {
    const g = explainGap('goods_line:x:cn_code_missing', 'blocking')
    expect(g.raw).toBe('goods_line:x:cn_code_missing')
  })

  // A vocabulary that dropped what it did not know would hide the gap that is
  // blocking the return, leaving the user with a refusal and no reason.
  it('still explains a token it does not recognise', () => {
    const g = explainGap('goods_line:x:some_new_field_missing', 'blocking')
    expect(g.what).toBe('some new field')
    expect(g.raw).toBe('goods_line:x:some_new_field_missing')
  })
})

describe('presentGaps', () => {
  it('separates blocking gaps from advisory ones', () => {
    const gaps = presentGaps({
      missing: ['case:importer_eori_missing'],
      warnings: ['goods_line:x:installation_id_missing'],
      blocking: true,
    })

    expect(gaps.blocking).toHaveLength(1)
    expect(gaps.advisory).toHaveLength(1)
    expect(gaps.blocksReturn).toBe(true)
  })

  it('says the return is blocked when anything is missing', () => {
    const gaps = presentGaps({ missing: ['case:reporting_year_missing'], warnings: [] })
    expect(gaps.summary).toMatch(/cannot be produced/)
  })

  it('says an advisory gap does not stop the return', () => {
    const gaps = presentGaps({ missing: [], warnings: ['goods_line:x:incoterm_missing'] })
    expect(gaps.blocksReturn).toBe(false)
    expect(gaps.summary).toMatch(/does not stop|stops your return/)
  })

  it('has nothing to say about a clean case', () => {
    const gaps = presentGaps({ missing: [], warnings: [] })
    expect(gaps.summary).toBeNull()
    expect(gaps.blocksReturn).toBe(false)
  })

  // The case endpoint sets open_gaps to null when the check itself failed.
  it('treats a missing block as no gaps rather than throwing', () => {
    expect(presentGaps(null).blocksReturn).toBe(false)
    expect(presentGaps(undefined).blocking).toEqual([])
  })
})

// The summary counts the blocking gaps, and the case page listed blocking and
// advisory together beneath it: "1 thing still missing" above three bullets,
// which reads as a miscount and hides which one actually stops the return.
describe('the summary and the lists agree', () => {
  const mixed = presentGaps({
    missing: ['goods_line:abc:missing_emissions'],
    warnings: ['shipment:def:incoterm_missing', 'goods_line:abc:installation_id_missing'],
  })

  it('counts only what stops the return', () => {
    expect(mixed.blocking).toHaveLength(1)
    expect(mixed.advisory).toHaveLength(2)
    expect(mixed.summary).toContain('1 thing still missing')
  })

  it('says "it" when one thing is missing, not "they"', () => {
    expect(mixed.summary).toContain('until it is filled in')
  })

  it('says "they" when more than one is', () => {
    const several = presentGaps({ missing: ['a:b:missing_emissions', 'c:d:missing_emissions'] })
    expect(several.summary).toContain('2 things still missing')
    expect(several.summary).toContain('until they are filled in')
  })
})
