/**
 * "Ask your records": what the endpoint actually asks the database for.
 *
 * The parser and the answer are mocked; the point is the retrieval between
 * them — that every supplier read stays inside the grants, in the query rather
 * than after a capped one, and that what is searched is what the user is told.
 */

const buyer = { user: { id: 'user-1', entityId: 'buyer-1' } }

jest.mock('@/lib/auth-helpers', () => ({
  requireAuth: jest.fn(async () => ({ session: buyer, response: null })),
}))
jest.mock('@/lib/rate-limit-guard', () => ({ enforceBuyerApiLimit: jest.fn(async () => null) }))

const recordFindMany = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: {
    dataAccessGrant: {
      findMany: jest.fn(async () => [
        {
          grantorEntityId: 'sup-a',
          grantorEntity: { legalName: 'Acme Steel Ltd' },
          domain: 'ENERGY',
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-12-31'),
          fieldNames: null,
        },
      ]),
    },
    entity: { findUnique: jest.fn(async () => ({ entityType: 'BUYER', legalName: 'Buyer Ltd' })) },
    dataRecord: { findMany: (args: unknown) => recordFindMany(args) },
  },
}))

const parse = jest.fn()
jest.mock('@/lib/query-interpreter/nl-parser', () => ({
  parseNlQuery: (...args: unknown[]) => parse(...args),
}))
jest.mock('@/lib/query-interpreter/answer', () => ({
  composeAnswer: jest.fn(async () => 'An answer.'),
  answerWithoutModel: jest.fn(() => 'A fallback.'),
}))

import { POST } from '../nl/route'

const ask = (question: string) =>
  POST(
    new Request('http://arbor.test/api/query/nl', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }) as never,
  )

const granted = {
  OR: [
    {
      entityId: 'sup-a',
      domain: 'ENERGY',
      periodEnd: { gte: new Date('2026-01-01') },
      periodStart: { lte: new Date('2026-12-31') },
    },
  ],
}

beforeEach(() => {
  recordFindMany.mockReset()
  recordFindMany.mockResolvedValue([])
  parse.mockReset()
})

/** The findMany call that is not the vocabulary lookup. */
const retrieval = () => recordFindMany.mock.calls.map(c => c[0]).filter(a => !a.distinct?.includes('unit'))

describe('POST /api/query/nl', () => {
  it('reads supplier records inside the grants, in the query itself', async () => {
    parse.mockResolvedValue({ interpretation: 'x', isCalculation: false, queryType: 'supply_chain' })
    await ask('supplier energy')
    const [args] = retrieval()
    expect(args.where.AND[0]).toEqual(granted)
    expect(args.take).toBe(201)
  })

  it('builds the vocabulary from the grants, not from every supplier record', async () => {
    parse.mockResolvedValue({ interpretation: 'x', isCalculation: false, queryType: 'entity' })
    await ask('anything')
    const vocab = recordFindMany.mock.calls.map(c => c[0]).find(a => a.distinct?.includes('unit'))
    expect(vocab.where.OR).toEqual([{ entityId: 'buyer-1' }, ...granted.OR])
  })

  it('makes a gap statement about a supplier only from records the grant covers', async () => {
    parse.mockResolvedValue({ interpretation: 'x', isCalculation: false, queryType: 'gap' })
    await ask('what is missing')
    const supplierRead = retrieval().find(a => a.where.AND)
    expect(supplierRead.where.AND[0]).toEqual(granted)
  })

  it('applies the period and status to a history question', async () => {
    parse.mockResolvedValue({
      interpretation: 'x',
      isCalculation: false,
      queryType: 'historical',
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      trustTier: 'A',
    })
    await ask('verified history for 2025')
    const [args] = retrieval()
    expect(args.where).toMatchObject({
      trustTier: 'A',
      periodEnd: { gte: new Date('2025-01-01') },
      periodStart: { lte: new Date('2025-12-31') },
    })
  })

  it('answers plainly when a named supplier is not one the caller can see', async () => {
    parse.mockResolvedValue({
      interpretation: 'x',
      isCalculation: false,
      queryType: 'supply_chain',
      supplierName: 'Brighton Metals',
    })
    const res = await ask("Brighton Metals' energy")
    const body = await res.json()
    expect(body.data?.answer ?? body.answer).toMatch(
      /no shared data from a supplier called “Brighton Metals”/,
    )
    expect(retrieval()).toHaveLength(0)
  })

  it('tells the user what was searched, from the filters that ran', async () => {
    parse.mockResolvedValue({
      interpretation: 'the model’s own account',
      isCalculation: false,
      queryType: 'supply_chain',
      supplierName: 'acme steel',
      domain: 'ENERGY',
    })
    const res = await ask('acme energy')
    const body = await res.json()
    expect(body.data?.scope ?? body.scope).toBe('Acme Steel Ltd · Energy · any period · any status')
  })
})
