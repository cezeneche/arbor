/**
 * @jest-environment node
 */

// What the confirm route does, answer by answer. Written against the 672-line
// route before it was split (code review R4, "split it once it is covered by
// a test"), so the split had to keep every one of these passing unchanged.

import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

const state = {
  document: null as Row | null,
  priors: [] as Row[], // other documents' active records, for the duplicate check
  own: [] as Row[], // this document's earlier records
  matching: [] as Row[], // what the supersede query inside the transaction finds
  claimCount: 1,
  capacity: { allowed: true } as { allowed: boolean; reason?: string },
}

const calls = {
  written: [] as Row[],
  superseded: [] as Row[],
  withdrawn: [] as Row[],
  supersedeQueries: 0,
  enqueued: [] as Row[],
  ranHandoff: [] as string[],
  labels: [] as Row[],
  noticeScopes: [] as unknown[],
  webhooks: [] as unknown[][],
  tierInput: null as Row | null,
}

let tier: 'A' | 'B' = 'B'

jest.mock('@/lib/auth-helpers', () => ({
  requireWriteAccess: async () => ({ session: { user: { id: 'user-1', entityId: 'entity-1' } } }),
}))
jest.mock('@/lib/session', () => ({ getSessionUser: (s: { user: unknown }) => s.user }))
jest.mock('@/lib/plan-guard', () => ({ assertRecordCapacity: async () => state.capacity }))
jest.mock('@/lib/validation/cross-validation', () => ({ runCrossValidation: async () => {} }))
jest.mock('@/lib/constraints/run-constraint-validation', () => ({ runConstraintValidation: async () => {} }))
jest.mock('@/lib/layer3/grant-access', () => ({ findActiveGranteeEntityIds: async () => ['buyer-1'] }))
jest.mock('@/lib/webhooks/dispatch', () => ({
  dispatchWebhook: async (...a: unknown[]) => {
    calls.webhooks.push(a)
  },
}))
jest.mock('@/lib/supersession-notice', () => ({
  notifyBuyersOfSupersession: async (_entityId: string, scopes: unknown) => {
    calls.noticeScopes.push(scopes)
  },
}))
jest.mock('@/lib/layer2/review-tier', () => ({
  reviewTier: (input: Row) => {
    calls.tierInput = input
    return tier
  },
}))
jest.mock('@/lib/layer2/record-writer', () => ({
  writeRecordWithAuditEntry: async (_tx: unknown, record: Row) => {
    calls.written.push(record)
    return { recordId: `new-${calls.written.length}` }
  },
}))
jest.mock('@/lib/layer2/audit-append', () => ({
  appendAuditEntry: async (_tx: unknown, entry: Row) => {
    calls.withdrawn.push(entry)
  },
}))
jest.mock('@/lib/layer2/cbam-handoff', () => ({
  enqueueCbamHandoff: async (_tx: unknown, handoff: Row) => {
    calls.enqueued.push(handoff)
  },
  runCbamHandoff: async (documentId: string) => {
    calls.ranHandoff.push(documentId)
    return { attempted: true, caseId: 'case-1', status: 'CREATED', problems: [], needs: [] }
  },
}))

const tx = {
  document: { updateMany: async () => ({ count: state.claimCount }) },
  dataRecord: {
    findMany: async (args: { where: Row }) => {
      if (args.where.documentId) return state.own
      calls.supersedeQueries++
      return state.matching
    },
    updateMany: async (args: Row) => {
      calls.superseded.push(args)
      return { count: 1 }
    },
    update: async () => ({}),
  },
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    document: { findUnique: async () => state.document },
    entity: { findUnique: async () => ({ legalName: 'Acme Steel Ltd', cbamJurisdiction: 'UK' }) },
    dataRecord: { findMany: async () => state.priors },
    groundTruthLabel: {
      createMany: async (args: { data: Row[] }) => {
        calls.labels.push(...args.data)
        return { count: args.data.length }
      },
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  },
}))

import { POST } from '../route'

const JAN = { periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-01-31T23:59:59.999Z' }
const kwh = (value = '1200') => ({
  fieldName: 'total_consumption_kwh',
  confirmedValue: value,
  confirmedUnit: 'kWh',
  domain: 'ENERGY',
  ...JAN,
})

function electricityBill(overrides: Row = {}): Row {
  return {
    id: 'doc-1',
    entityId: 'entity-1',
    documentType: 'ELECTRICITY_BILL',
    status: 'REVIEW_REQUIRED',
    autoAcceptedAt: null,
    extractionJobs: [],
    ...overrides,
  }
}

async function confirm(body: unknown) {
  const res = await POST(
    new NextRequest('http://arbor.test/api/documents/doc-1/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'doc-1' }) },
  )
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  state.document = electricityBill()
  state.priors = []
  state.own = []
  state.matching = []
  state.claimCount = 1
  state.capacity = { allowed: true }
  for (const list of Object.values(calls)) if (Array.isArray(list)) list.length = 0
  calls.supersedeQueries = 0
  calls.tierInput = null
  tier = 'B'
})

describe('refusals before anything is written', () => {
  it('refuses a body that is not a confirmation', async () => {
    expect((await confirm({ fields: [] })).body.code).toBe('VALIDATION_ERROR')
  })

  it('refuses a document that does not exist, or belongs to someone else', async () => {
    state.document = null
    expect((await confirm({ fields: [kwh()] })).status).toBe(404)
    state.document = electricityBill({ entityId: 'entity-2' })
    expect((await confirm({ fields: [kwh()] })).status).toBe(403)
  })

  it('refuses a document already confirmed by a person, or withdrawn', async () => {
    state.document = electricityBill({ status: 'ACCEPTED' })
    expect((await confirm({ fields: [kwh()] })).body.code).toBe('ALREADY_CONFIRMED')
    state.document = electricityBill({ status: 'WITHDRAWN' })
    expect((await confirm({ fields: [kwh()] })).body.code).toBe('DOCUMENT_WITHDRAWN')
  })

  it('reopens an auto-accepted document for its first human confirmation', async () => {
    state.document = electricityBill({ status: 'ACCEPTED', autoAcceptedAt: new Date() })
    expect((await confirm({ fields: [kwh()] })).status).toBe(200)
  })

  it('refuses a field the document type does not have, naming it', async () => {
    const { status, body } = await confirm({ fields: [{ ...kwh(), fieldName: 'shoe_size' }] })
    expect(status).toBe(400)
    expect(body.code).toBe('FIELD_VALIDATION_ERROR')
    expect(body.fields.map((f: Row) => f.fieldName)).toEqual(['shoe_size'])
  })

  it('refuses a value that does not parse', async () => {
    const { body } = await confirm({ fields: [kwh('twelve hundred')] })
    expect(body.code).toBe('FIELD_VALIDATION_ERROR')
  })

  it('refuses a CBAM document without an import date', async () => {
    state.document = electricityBill({ documentType: 'CUSTOMS_DECLARATION' })
    const { body } = await confirm({
      fields: [
        {
          fieldName: 'lines[0].net_mass_kg',
          confirmedValue: '24500',
          confirmedUnit: 'kg',
          domain: 'LOGISTICS',
          ...JAN,
        },
      ],
    })
    expect(body.code).toBe('FIELD_VALIDATION_ERROR')
    expect(body.fields[0].problem).toBe('missing_document_date')
  })

  it('refuses a CBAM field name outside the CBAM vocabulary', async () => {
    state.document = electricityBill({ documentType: 'CUSTOMS_DECLARATION' })
    const { body } = await confirm({
      fields: [{ fieldName: 'lines[0].shoe_size', confirmedValue: '9', domain: 'LOGISTICS', ...JAN }],
      context: [{ fieldName: 'import_date', confirmedValue: '2026-01-15' }],
    })
    expect(body.fields.map((f: Row) => f.problem)).toContain('unknown_field')
  })
})

describe('duplicates', () => {
  const existing = {
    id: 'prior-1',
    fieldName: 'total_consumption_kwh',
    domain: 'ENERGY',
    value: 4000,
    unit: 'MJ',
    periodStart: new Date(JAN.periodStart),
    periodEnd: new Date(JAN.periodEnd),
  }

  it('asks before duplicating, quoting what already exists', async () => {
    state.priors = [existing]
    const { status, body } = await confirm({ fields: [kwh()] })
    expect(status).toBe(409)
    expect(body.code).toBe('DUPLICATE_RECORDS')
    expect(body.duplicates.length).toBeGreaterThan(0)
    expect(calls.written).toEqual([])
  })

  it('replaces: supersedes the prior record and tells buyers', async () => {
    state.priors = [existing]
    state.matching = [{ id: 'prior-1' }]
    const { status } = await confirm({ fields: [kwh()], onDuplicate: 'replace' })
    expect(status).toBe(200)
    expect(calls.superseded).toEqual([
      { where: { id: { in: ['prior-1'] } }, data: { isActive: false, supersededById: 'new-1' } },
    ])
    expect(calls.noticeScopes).toEqual([
      [{ domain: 'ENERGY', periodStart: new Date(JAN.periodStart), periodEnd: new Date(JAN.periodEnd) }],
    ])
  })

  it('keeps both: writes alongside and supersedes nothing', async () => {
    state.priors = [existing]
    const { status } = await confirm({ fields: [kwh()], onDuplicate: 'keep_both' })
    expect(status).toBe(200)
    expect(calls.supersedeQueries).toBe(0)
    expect(calls.superseded).toEqual([])
    expect(calls.noticeScopes).toEqual([[]])
  })
})

describe('the transaction', () => {
  it('refuses when another confirmation claimed the document first', async () => {
    state.claimCount = 0
    const { status, body } = await confirm({ fields: [kwh()] })
    expect(status).toBe(409)
    expect(body.code).toBe('ALREADY_CONFIRMED')
  })

  it('refuses past the plan limit, with its reason', async () => {
    state.capacity = { allowed: false, reason: 'Your plan holds 100 records.' }
    const { status, body } = await confirm({ fields: [kwh()] })
    expect(status).toBe(402)
    expect(body.code).toBe('PLAN_LIMIT')
  })

  // The writer converts to SI itself (canonicaliseMeasurement): 1,200 kWh is
  // stored as 4,320 MJ. What the route owes it is the figure as confirmed.
  it('hands the writer the confirmed figure and what the document said', async () => {
    const { status, body } = await confirm({
      fields: [{ ...kwh(), sourceText: '1,200 kWh', confidenceScore: 0.97 }],
    })
    expect(status).toBe(200)
    expect(body).toEqual({ recordIds: ['new-1'], documentStatus: 'ACCEPTED' })
    expect(calls.written[0]).toMatchObject({
      entityId: 'entity-1',
      domain: 'ENERGY',
      fieldName: 'total_consumption_kwh',
      value: 1200,
      unit: 'kWh',
      originalValue: 1200,
      originalUnit: 'kWh',
      trustTier: 'B',
      extractionMethod: 'DOCUMENT_AI',
      submittedById: 'user-1',
      documentId: 'doc-1',
      sourceText: '1,200 kWh',
      confidenceScore: 0.97,
      periodStart: new Date(JAN.periodStart),
      periodEnd: new Date(JAN.periodEnd),
    })
  })

  it('withdraws an earlier record of this document whose field was cleared', async () => {
    state.own = [
      {
        id: 'own-old',
        entityId: 'entity-1',
        domain: 'ENERGY',
        fieldName: 'standing_charge',
        value: 1,
        unit: 'GBP',
        originalValue: 1,
        originalUnit: 'GBP',
        periodStart: new Date(JAN.periodStart),
        periodEnd: new Date(JAN.periodEnd),
        trustTier: 'B',
        confidenceScore: 1,
        sourceText: null,
        documentId: 'doc-1',
        extractionMethod: 'DOCUMENT_AI',
      },
    ]
    await confirm({ fields: [kwh()] })
    expect(calls.withdrawn).toEqual([
      expect.objectContaining({ recordId: 'own-old', eventType: 'WITHDRAWN' }),
    ])
  })
})

describe('trust tier', () => {
  it('decides the tier from the effective document and the organisation', async () => {
    await confirm({
      fields: [kwh()],
      context: [{ fieldName: 'account_holder_name', confirmedValue: 'Acme' }],
    })
    expect(calls.tierInput).toMatchObject({
      documentType: 'ELECTRICITY_BILL',
      cbam: false,
      hasExtraction: false,
      entityName: 'Acme Steel Ltd',
      recordPeriodEnds: [JAN.periodEnd],
    })
    expect([...(calls.tierInput!.confirmed as Map<string, string>)]).toEqual([
      ['account_holder_name', 'Acme'],
      ['total_consumption_kwh', '1200'],
    ])
  })

  it('announces Verified records to buyers who can see them', async () => {
    tier = 'A'
    await confirm({ fields: [kwh()] })
    expect(calls.written[0].trustTier).toBe('A')
    expect(calls.webhooks).toEqual([
      [
        'buyer-1',
        'record.certified',
        {
          supplierEntityId: 'entity-1',
          domain: 'ENERGY',
          trustTier: 'A',
          periodStart: JAN.periodStart,
          periodEnd: JAN.periodEnd,
        },
      ],
    ])
  })

  it('announces nothing for Declared records', async () => {
    await confirm({ fields: [kwh()] })
    expect(calls.webhooks).toEqual([])
  })
})

describe('after the commit', () => {
  it('records what the reviewer confirmed against what was read', async () => {
    state.document = electricityBill({
      extractionJobs: [
        {
          documentClass: 'ELECTRICITY_BILL',
          extractorVersion: 'v1',
          extractedFields: [
            {
              fieldName: 'total_consumption_kwh',
              rawValue: '1100',
              sourceText: '1,100 kWh',
              confidenceScore: 0.6,
              admissibility: 'COMPULSORY',
              flagged: true,
            },
          ],
        },
      ],
    })
    await confirm({ fields: [kwh('1200')] })
    expect(calls.labels).toEqual([
      expect.objectContaining({
        documentId: 'doc-1',
        recordId: 'new-1',
        fieldName: 'total_consumption_kwh',
        extractedValue: '1100',
        confirmedValue: '1200',
        wasCorrect: false,
      }),
    ])
  })

  it('opens the CBAM case: on record inside the transaction, then run', async () => {
    state.document = electricityBill({ documentType: 'CUSTOMS_DECLARATION' })
    const { status, body } = await confirm({
      fields: [
        {
          fieldName: 'lines[0].net_mass_kg',
          confirmedValue: '24500',
          confirmedUnit: 'kg',
          domain: 'LOGISTICS',
          ...JAN,
        },
      ],
      context: [{ fieldName: 'import_date', confirmedValue: '2026-01-15' }],
    })
    expect(status).toBe(200)
    expect(calls.enqueued).toEqual([
      expect.objectContaining({ documentId: 'doc-1', entityId: 'entity-1', jurisdiction: 'UK' }),
    ])
    expect(calls.ranHandoff).toEqual(['doc-1'])
    expect(body.cbam).toEqual({ caseId: 'case-1', status: 'CREATED', problems: [], needs: [] })
  })

  it('never supersedes a goods line by position', async () => {
    state.document = electricityBill({ documentType: 'CUSTOMS_DECLARATION' })
    state.priors = [
      {
        id: 'other-shipment',
        fieldName: 'lines[0].net_mass_kg',
        domain: 'LOGISTICS',
        value: 1,
        unit: 'kg',
        periodStart: new Date(JAN.periodStart),
        periodEnd: new Date(JAN.periodEnd),
      },
    ]
    const { status } = await confirm({
      fields: [
        {
          fieldName: 'lines[0].net_mass_kg',
          confirmedValue: '24500',
          confirmedUnit: 'kg',
          domain: 'LOGISTICS',
          ...JAN,
        },
      ],
      context: [{ fieldName: 'import_date', confirmedValue: '2026-01-15' }],
      onDuplicate: 'replace',
    })
    expect(status).toBe(200)
    expect(calls.supersedeQueries).toBe(0)
    expect(calls.superseded).toEqual([])
  })
})
