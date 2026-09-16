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
