import {
  extractRequestToken,
  parseRequestResponse,
  matchRequestToRecords,
  type MatchRecord,
  type ParsedRequest,
} from '../inbound-parse'

describe('extractRequestToken', () => {
  it('extracts the token from a requests- address', () => {
    expect(extractRequestToken('requests-abc123@arbor.io')).toBe('abc123')
  })
  it('does not match an upload- address', () => {
    expect(extractRequestToken('upload-abc123@arbor.io')).toBeNull()
  })
  it('returns null for an unrelated address', () => {
    expect(extractRequestToken('hello@arbor.io')).toBeNull()
  })
})

describe('parseRequestResponse', () => {
  it('parses a well-formed structured response', () => {
    const raw = JSON.stringify({ domain: 'ENERGY', fields: ['total_consumption_kwh'], periodStart: '2026-01-01', periodEnd: '2026-03-31' })
    expect(parseRequestResponse(raw)).toEqual({
      domain: 'ENERGY',
      fields: ['total_consumption_kwh'],
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
    })
  })
  it('defaults missing keys safely', () => {
    expect(parseRequestResponse('{}')).toEqual({ domain: null, fields: [], periodStart: null, periodEnd: null })
  })
  it('returns null on non-JSON', () => {
    expect(parseRequestResponse('nope')).toBeNull()
  })
})

function rec(over: Partial<MatchRecord>): MatchRecord {
  return {
    id: 'r1',
    domain: 'ENERGY',
    fieldName: 'total_consumption_kwh',
    value: 1000,
    unit: 'mj',
    trustTier: 'A',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-03-31T00:00:00.000Z',
    ...over,
  }
}

describe('matchRequestToRecords', () => {
  const parsed: ParsedRequest = { domain: 'ENERGY', fields: ['total_consumption_kwh'], periodStart: '2026-01-01', periodEnd: '2026-12-31' }

  it('is covered when every requested field has a matching record', () => {
    const res = matchRequestToRecords(parsed, [rec({ id: 'e1' })])
    expect(res.covered).toBe(true)
    expect(res.missingFields).toEqual([])
    expect(res.answers).toHaveLength(1)
    expect(res.answers[0].recordIds).toEqual(['e1'])
  })

  it('is not covered when a requested field has no record', () => {
    const res = matchRequestToRecords(
      { ...parsed, fields: ['total_consumption_kwh', 'quantity_m3'] },
      [rec({ id: 'e1' })],
    )
    expect(res.covered).toBe(false)
    expect(res.missingFields).toEqual(['quantity_m3'])
  })

  it('excludes records in a different domain', () => {
    const res = matchRequestToRecords(parsed, [rec({ id: 'p1', domain: 'PRODUCTION' })])
    expect(res.covered).toBe(false)
    expect(res.missingFields).toEqual(['total_consumption_kwh'])
  })

  it('excludes records outside the requested period', () => {
    const res = matchRequestToRecords(parsed, [
      rec({ id: 'old', periodStart: '2024-01-01', periodEnd: '2024-03-31' }),
    ])
    expect(res.covered).toBe(false)
  })

  it('with no specific fields, is covered when any in-scope record exists', () => {
    const res = matchRequestToRecords({ ...parsed, fields: [] }, [rec({ id: 'e1' })])
    expect(res.covered).toBe(true)
    expect(res.answers.length).toBeGreaterThan(0)
  })

  it('with no specific fields and no records, is not covered', () => {
    const res = matchRequestToRecords({ ...parsed, fields: [] }, [])
    expect(res.covered).toBe(false)
  })

  it('assembles multiple records for the same field into one answer', () => {
    const res = matchRequestToRecords(parsed, [rec({ id: 'q1' }), rec({ id: 'q2' })])
    expect(res.answers[0].recordIds).toEqual(['q1', 'q2'])
    expect(res.answers[0].records).toHaveLength(2)
  })
})
