import { handOffCbamCase } from '../cbam-handoff'

// The handoff is the join between a certified Arbor confirmation and a Nucleos
// case. Its whole job under failure is to be honest: never undo the records,
// never open a second case, never report success without the id.

type LinkRow = {
  documentId: string
  nucleosCaseId: string | null
  status: string
  problems: string[]
  goodsLineCount: number
  jurisdiction: string
}

function fakeDb(seed: LinkRow[] = []) {
  const rows = new Map(seed.map(r => [r.documentId, r]))
  return {
    rows,
    cbamCaseLink: {
      findUnique: jest.fn(async ({ where }: { where: { documentId: string } }) =>
        rows.get(where.documentId) ?? null,
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { documentId: string }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          const existing = rows.get(where.documentId)
          const next = { ...(existing ?? create), ...(existing ? update : {}) } as LinkRow
          next.documentId = where.documentId
          rows.set(where.documentId, next)
          return next
        },
      ),
    },
  }
}

const CONFIRMED = new Map([
  ['importer_eori', 'GB123456789000'],
  ['importer_name', 'Midlands Steel Ltd'],
  ['origin_country', 'IN'],
  ['lines[0].cn_code', '72081000'],
  ['lines[0].net_mass_kg', '24000'],
])

function input(overrides: Partial<Parameters<typeof handOffCbamCase>[0]> = {}) {
  return {
    documentId: 'doc-1',
    entityId: 'ent-1',
    documentType: 'CUSTOMS_DECLARATION',
    jurisdiction: 'UK' as const,
    confirmed: CONFIRMED,
    reportingPeriodEnd: new Date('2027-03-31T00:00:00Z'),
    ...overrides,
  }
}

describe('handOffCbamCase', () => {
  it('creates a case and records the link', async () => {
    const db = fakeDb()
    const createCase = jest
      .fn()
      .mockResolvedValue({ caseId: 'case-1', goodsLineIds: ['gl-1'], problems: [] })

    const out = await handOffCbamCase(input(), { db: db as never, createCase })

    expect(out).toEqual({ attempted: true, caseId: 'case-1', status: 'CREATED', problems: [] })
    expect(db.rows.get('doc-1')).toMatchObject({
      nucleosCaseId: 'case-1',
      status: 'CREATED',
      goodsLineCount: 1,
    })
  })

  it('does nothing for a document type that produces no case', async () => {
    const db = fakeDb()
    const createCase = jest.fn()

    const out = await handOffCbamCase(input({ documentType: 'ELECTRICITY_BILL' }), {
      db: db as never,
      createCase,
    })

    expect(out.attempted).toBe(false)
    expect(out.status).toBe('SKIPPED')
    expect(createCase).not.toHaveBeenCalled()
    expect(db.cbamCaseLink.upsert).not.toHaveBeenCalled()
  })

  // Confirming twice must not file the same goods twice. Every total the
  // importer sees would be doubled and nothing would look wrong.
  it('returns the existing case instead of opening a second one', async () => {
    const db = fakeDb([
      {
        documentId: 'doc-1',
        nucleosCaseId: 'case-existing',
        status: 'CREATED',
        problems: [],
        goodsLineCount: 1,
        jurisdiction: 'UK',
      },
    ])
    const createCase = jest.fn()

    const out = await handOffCbamCase(input(), { db: db as never, createCase })

    expect(out.caseId).toBe('case-existing')
    expect(createCase).not.toHaveBeenCalled()
  })

  // A previous attempt that failed left a row with no case id. That is a retry,
  // not a duplicate, and it has to be allowed through.
  it('retries when the earlier attempt left no case', async () => {
    const db = fakeDb([
      {
        documentId: 'doc-1',
        nucleosCaseId: null,
        status: 'FAILED',
        problems: ['nucleos was down'],
        goodsLineCount: 0,
        jurisdiction: 'UK',
      },
    ])
    const createCase = jest
      .fn()
      .mockResolvedValue({ caseId: 'case-2', goodsLineIds: ['gl-1'], problems: [] })

    const out = await handOffCbamCase(input(), { db: db as never, createCase })

    expect(out.caseId).toBe('case-2')
    expect(db.rows.get('doc-1')).toMatchObject({ nucleosCaseId: 'case-2', status: 'CREATED' })
  })

  it('records a partial handoff as PARTIAL, with the problems kept verbatim', async () => {
    const db = fakeDb()
    const createCase = jest.fn().mockResolvedValue({
      caseId: 'case-1',
      goodsLineIds: [],
      problems: ['Goods line 1 (72081000) could not be added to the case: 422'],
    })

    const out = await handOffCbamCase(input(), { db: db as never, createCase })

    expect(out.status).toBe('PARTIAL')
    expect(out.caseId).toBe('case-1')
    expect(db.rows.get('doc-1')).toMatchObject({
      status: 'PARTIAL',
      problems: ['Goods line 1 (72081000) could not be added to the case: 422'],
    })
  })

  // The records are already committed and chained. A boundary that is down must
  // not throw back into a route that has finished writing.
  it('records a thrown boundary failure instead of propagating it', async () => {
    const db = fakeDb()
    const createCase = jest.fn().mockRejectedValue(new Error('Nucleos timed out'))

    const out = await handOffCbamCase(input(), { db: db as never, createCase })

    expect(out.status).toBe('FAILED')
    expect(out.caseId).toBeNull()
    expect(out.problems[0]).toMatch(/Nucleos timed out/)
    expect(out.problems[0]).toMatch(/figures are saved/i)
  })

  it('records a payload that cannot be assembled, and never calls the boundary', async () => {
    const db = fakeDb()
    const createCase = jest.fn()

    const out = await handOffCbamCase(
      input({ confirmed: new Map([['lines[0].cn_code', '72081000']]) }),
      { db: db as never, createCase },
    )

    expect(out.status).toBe('FAILED')
    expect(createCase).not.toHaveBeenCalled()
    expect(out.problems.join(' ')).toMatch(/importer/i)
    expect(db.rows.get('doc-1')).toMatchObject({ status: 'FAILED', nucleosCaseId: null })
  })

  it('stamps the entity’s jurisdiction on the case and on the link', async () => {
    const db = fakeDb()
    const createCase = jest
      .fn()
      .mockResolvedValue({ caseId: 'case-1', goodsLineIds: ['gl-1'], problems: [] })

    await handOffCbamCase(input({ jurisdiction: 'BOTH' }), { db: db as never, createCase })

    expect(createCase.mock.calls[0][0].case.jurisdiction).toBe('BOTH')
    expect(db.rows.get('doc-1')).toMatchObject({ jurisdiction: 'BOTH' })
  })
})
