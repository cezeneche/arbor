/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles stand in for Prisma's generic argument types */
import { enqueueCbamHandoff, runCbamHandoff, supplyCbamHandoffIdentifiers, LEASE_MS } from '../cbam-handoff'
import type { CaseWriteProgress } from '@/lib/nucleos/case-writer'

// The handoff is the join between a certified Arbor confirmation and a Nucleos
// case. It is recorded as PENDING in the confirmation's own transaction, then
// run — straight away, from the Resume action, or by the sweep. Its whole job
// under failure is to be honest and resumable: never undo the records, never
// open a second case, never re-post what already landed, never report success
// without the id.

type Row = {
  documentId: string
  entityId: string
  nucleosCaseId: string | null
  jurisdiction: string
  status: string
  problems: string[]
  goodsLineCount: number
  handoffInput: unknown
  progress: unknown
  attemptStartedAt: Date | null
  attempts: number
}

function blankRow(documentId: string): Row {
  return {
    documentId,
    entityId: 'ent-1',
    nucleosCaseId: null,
    jurisdiction: 'UK',
    status: 'PENDING',
    problems: [],
    goodsLineCount: 0,
    handoffInput: null,
    progress: null,
    attemptStartedAt: null,
    attempts: 0,
  }
}

function fakeDb(seed: Partial<Row>[] = []) {
  const rows = new Map<string, Row>(
    seed.map(r => [r.documentId!, { ...blankRow(r.documentId!), ...r }]),
  )
  const matches = (row: Row, where: Record<string, unknown>) => {
    if (where.documentId && row.documentId !== where.documentId) return false
    const status = where.status as { in?: string[] } | undefined
    if (status?.in && !status.in.includes(row.status)) return false
    const or = where.OR as Record<string, unknown>[] | undefined
    if (or) {
      const ok = or.some(clause => {
        const a = clause.attemptStartedAt as null | { lt: Date }
        if (a === null) return row.attemptStartedAt === null
        return row.attemptStartedAt !== null && row.attemptStartedAt < a.lt
      })
      if (!ok) return false
    }
    return true
  }
  const apply = (row: Row, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as object)) {
        ;(row as Record<string, unknown>)[k] =
          ((row as Record<string, unknown>)[k] as number) + (v as { increment: number }).increment
      } else {
        ;(row as Record<string, unknown>)[k] = v
      }
    }
  }
  return {
    rows,
    cbamCaseLink: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rows.get(where.documentId)
        if (existing) {
          apply(existing, update)
          return existing
        }
        const row: Row = { ...blankRow(where.documentId), ...create }
        rows.set(where.documentId, row)
        return row
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0
        for (const row of rows.values()) {
          if (matches(row, where)) {
            apply(row, data)
            count++
          }
        }
        return { count }
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.documentId)!
        apply(row, data)
        return row
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.documentId) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const row of rows.values()) {
          if (where.nucleosCaseId && row.nucleosCaseId !== where.nucleosCaseId) continue
          if (where.entityId?.not && row.entityId === where.entityId.not) continue
          return row
        }
        return null
      }),
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

function input(overrides: Partial<Parameters<typeof enqueueCbamHandoff>[1]> = {}) {
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

/** A case writer that lands everything, reporting progress like the real one. */
function landingWriter(caseId = 'case-1') {
  return jest.fn(async (payload: any, start: CaseWriteProgress, opts: any) => {
    const progress: CaseWriteProgress = {
      caseId: start.caseId ?? caseId,
      shipmentId: start.shipmentId ?? 'ship-1',
      lines: { ...start.lines },
    }
    for (const l of payload.lines) {
      progress.lines[String(l.lineIndex)] ??= { goodsLineId: `gl-${l.lineIndex}`, emissionsRecorded: true }
    }
    await opts?.onProgress?.(progress)
    return {
      caseId: progress.caseId,
      goodsLineIds: Object.values(progress.lines).map(l => l.goodsLineId),
      problems: [],
      progress,
    }
  })
}

async function enqueued(over: Partial<Parameters<typeof enqueueCbamHandoff>[1]> = {}) {
  const db = fakeDb()
  await enqueueCbamHandoff(db as never, input(over))
  return db
}

describe('enqueueCbamHandoff', () => {
  it('records the handoff as PENDING with everything a later resume needs', async () => {
    const db = await enqueued()
    expect(db.rows.get('doc-1')).toMatchObject({
      status: 'PENDING',
      entityId: 'ent-1',
      jurisdiction: 'UK',
      nucleosCaseId: null,
      handoffInput: {
        documentType: 'CUSTOMS_DECLARATION',
        confirmed: Object.fromEntries(CONFIRMED),
        reportingPeriodEnd: '2027-03-31T00:00:00.000Z',
      },
    })
  })

  it('does nothing for a document type that produces no case', async () => {
    const db = fakeDb()
    expect(await enqueueCbamHandoff(db as never, input({ documentType: 'ELECTRICITY_BILL' }))).toBe(false)
    expect(db.cbamCaseLink.upsert).not.toHaveBeenCalled()
  })
})

describe('runCbamHandoff', () => {
  it('creates the case and records the link', async () => {
    const db = await enqueued()
    const writeCase = landingWriter()

    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })

    expect(out).toEqual({ attempted: true, caseId: 'case-1', status: 'CREATED', problems: [] })
    expect(db.rows.get('doc-1')).toMatchObject({
      nucleosCaseId: 'case-1',
      status: 'CREATED',
      goodsLineCount: 1,
      attemptStartedAt: null,
      attempts: 1,
    })
  })

  // Nucleos reuses a case for the same importer and quarter, and every Arbor
  // organisation shares one service identity — so without an owner in the key a
  // second organisation declaring the same EORI got the first one's case back.
  it('names the owning organisation and the document on the case it opens', async () => {
    const db = await enqueued()
    const writeCase = landingWriter()
    await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(writeCase.mock.calls[0][0].case.owner_ref).toBe('ent-1')
    expect(writeCase.mock.calls[0][0].ref).toBe('doc-1')
  })

  it('refuses a case another organisation already holds, and links nothing', async () => {
    const db = fakeDb([{ documentId: 'doc-other', entityId: 'ent-2', nucleosCaseId: 'case-1', status: 'CREATED' }])
    await enqueueCbamHandoff(db as never, input())
    const writeCase = landingWriter('case-1')

    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })

    expect(out.status).toBe('FAILED')
    expect(out.caseId).toBeNull()
    expect(out.problems.join(' ')).toMatch(/another organisation/i)
    expect(db.rows.get('doc-1')!.nucleosCaseId).toBeNull()
  })

  it('stamps the recorded jurisdiction on the case', async () => {
    const db = await enqueued({ jurisdiction: 'BOTH' })
    const writeCase = landingWriter()
    await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(writeCase.mock.calls[0][0].case.jurisdiction).toBe('BOTH')
  })

  // Confirming twice, resuming twice, or the sweep finding a finished row must
  // never file the same goods twice.
  it('does nothing to a case that is already complete', async () => {
    const db = fakeDb([{ documentId: 'doc-1', status: 'CREATED', nucleosCaseId: 'case-1' }])
    const writeCase = landingWriter()
    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(out).toMatchObject({ attempted: false, caseId: 'case-1', status: 'CREATED' })
    expect(writeCase).not.toHaveBeenCalled()
  })

  // Audit P1 #6: two attempts racing each other opened two remote cases.
  it('lets only one of two concurrent attempts run', async () => {
    const db = await enqueued()
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const inner = landingWriter()
    const writeCase = jest.fn(async (...args: Parameters<typeof inner>) => {
      await gate
      return inner(...args)
    })

    const first = runCbamHandoff('doc-1', { db: db as never, writeCase })
    const second = await runCbamHandoff('doc-1', { db: db as never, writeCase })
    release()
    await first

    expect(writeCase).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ attempted: false, status: 'PENDING' })
  })

  it('takes over an attempt that has been running longer than the lease', async () => {
    const stale = new Date(Date.now() - LEASE_MS - 1000)
    const db = await enqueued()
    db.rows.get('doc-1')!.attemptStartedAt = stale
    const writeCase = landingWriter()
    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(out.status).toBe('CREATED')
  })

  // Audit P1 #4: a failed handoff told the user to confirm again, which the
  // confirm route refuses. It is resumed instead.
  it('resumes a FAILED handoff from its recorded input', async () => {
    const db = await enqueued()
    const failing = jest.fn().mockRejectedValue(new Error('Nucleos timed out'))
    const failed = await runCbamHandoff('doc-1', { db: db as never, writeCase: failing })
    expect(failed.status).toBe('FAILED')
    expect(failed.problems[0]).toMatch(/Nucleos timed out/)
    expect(failed.problems[0]).toMatch(/figures are saved/i)
    expect(failed.problems[0]).not.toMatch(/confirm this document again/i)

    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase: landingWriter('case-2') })
    expect(out).toMatchObject({ caseId: 'case-2', status: 'CREATED' })
  })

  it('finishes a PARTIAL handoff from its recorded progress, without re-posting what landed', async () => {
    const db = await enqueued({
      confirmed: new Map([
        ...CONFIRMED,
        ['lines[1].cn_code', '76011000'],
        ['lines[1].net_mass_kg', '22000'],
      ]),
    })
    const halfway: CaseWriteProgress = {
      caseId: 'case-1',
      shipmentId: 'ship-1',
      lines: { '0': { goodsLineId: 'gl-0', emissionsRecorded: true } },
    }
    const partial = jest.fn(async (_p: any, _s: any, opts: any) => {
      await opts.onProgress(halfway)
      return { caseId: 'case-1', goodsLineIds: ['gl-0'], problems: ['Goods line 2 (76011000) could not be added'], progress: halfway }
    })
    const first = await runCbamHandoff('doc-1', { db: db as never, writeCase: partial })
    expect(first.status).toBe('PARTIAL')
    expect(db.rows.get('doc-1')).toMatchObject({ nucleosCaseId: 'case-1', progress: halfway })

    const writeCase = landingWriter()
    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(writeCase.mock.calls[0][1]).toEqual(halfway)
    expect(out).toMatchObject({ caseId: 'case-1', status: 'CREATED', problems: [] })
    expect(db.rows.get('doc-1')!.goodsLineCount).toBe(2)
  })

  it('keeps the case id when an attempt fails after the case was opened', async () => {
    const db = await enqueued()
    const writeCase = jest.fn(async (_p: any, _s: any, opts: any) => {
      await opts.onProgress({ caseId: 'case-1', shipmentId: null, lines: {} })
      throw new Error('socket hang up')
    })
    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(out).toMatchObject({ caseId: 'case-1', status: 'PARTIAL' })
    expect(db.rows.get('doc-1')).toMatchObject({ nucleosCaseId: 'case-1', attemptStartedAt: null })
  })

  // Retrying the same stored input cannot supply an identifier it lacks. The
  // handoff used to be FAILED and retried until the sweep gave up; it now waits
  // for the person who can supply it, and says what it is waiting for.
  it('waits for input when no case can be built, and never calls the boundary', async () => {
    const db = await enqueued({ confirmed: new Map([['lines[0].cn_code', '72081000'], ['lines[0].net_mass_kg', '24000']]) })
    const writeCase = landingWriter()
    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(out.status).toBe('NEEDS_INPUT')
    expect(out.needs).toEqual([{ fieldName: 'importer_eori', label: 'Importer EORI' }])
    expect(writeCase).not.toHaveBeenCalled()
    expect(out.problems.join(' ')).toMatch(/importer/i)
    expect(db.rows.get('doc-1')).toMatchObject({ status: 'NEEDS_INPUT', nucleosCaseId: null })
  })

  it('is not retried while it waits for input', async () => {
    const db = await enqueued({ confirmed: new Map([['lines[0].cn_code', '72081000']]) })
    await runCbamHandoff('doc-1', { db: db as never, writeCase: landingWriter() })
    const again = await runCbamHandoff('doc-1', { db: db as never, writeCase: landingWriter() })
    expect(again).toMatchObject({ attempted: false, status: 'NEEDS_INPUT' })
  })

  it('says plainly when a row carries no recorded input to resume from', async () => {
    const db = fakeDb([{ documentId: 'doc-1', status: 'FAILED', handoffInput: null }])
    const writeCase = landingWriter()
    const out = await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(out.status).toBe('FAILED')
    expect(out.problems.join(' ')).toMatch(/cannot be resumed/i)
    expect(writeCase).not.toHaveBeenCalled()
  })

  it('reports nothing to do for a document with no handoff', async () => {
    const out = await runCbamHandoff('doc-x', { db: fakeDb() as never, writeCase: landingWriter() })
    expect(out).toMatchObject({ attempted: false, status: 'SKIPPED' })
  })
})

describe('supplyCbamHandoffIdentifiers', () => {
  const withoutEori = new Map([...CONFIRMED].filter(([k]) => k !== 'importer_eori'))

  async function waiting() {
    const db = await enqueued({ confirmed: withoutEori })
    await runCbamHandoff('doc-1', { db: db as never, writeCase: landingWriter() })
    return db
  }

  it('adds the missing EORI, records who supplied it, and opens the case', async () => {
    const db = await waiting()
    const writeCase = landingWriter()
    const out = await supplyCbamHandoffIdentifiers(
      { documentId: 'doc-1', entityId: 'ent-1', userId: 'usr-1', amendments: [{ fieldName: 'importer_eori', value: 'gb123456789000' }] },
      { db: db as never, writeCase },
    )
    expect(out).toMatchObject({ ok: true, outcome: { status: 'CREATED', caseId: 'case-1' } })
    expect(writeCase.mock.calls[0][0].case.importer_eori).toBe('GB123456789000')
    const stored = db.rows.get('doc-1')!.handoffInput as any
    expect(stored.confirmed.importer_eori).toBe('GB123456789000')
    expect(stored.amendments).toEqual([
      expect.objectContaining({ fieldName: 'importer_eori', value: 'GB123456789000', byId: 'usr-1' }),
    ])
  })

  it("refuses another organisation's handoff", async () => {
    const db = await waiting()
    const out = await supplyCbamHandoffIdentifiers(
      { documentId: 'doc-1', entityId: 'ent-2', userId: 'usr-9', amendments: [{ fieldName: 'importer_eori', value: 'GB123456789000' }] },
      { db: db as never, writeCase: landingWriter() },
    )
    expect(out).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('refuses a handoff that is not waiting for input', async () => {
    const db = await enqueued()
    const out = await supplyCbamHandoffIdentifiers(
      { documentId: 'doc-1', entityId: 'ent-1', userId: 'usr-1', amendments: [{ fieldName: 'importer_eori', value: 'GB123456789000' }] },
      { db: db as never, writeCase: landingWriter() },
    )
    expect(out).toMatchObject({ ok: false, code: 'NOT_WAITING' })
  })

  it('writes nothing when a value is refused', async () => {
    const db = await waiting()
    const before = JSON.stringify(db.rows.get('doc-1')!.handoffInput)
    const out = await supplyCbamHandoffIdentifiers(
      { documentId: 'doc-1', entityId: 'ent-1', userId: 'usr-1', amendments: [{ fieldName: 'importer_eori', value: '12' }] },
      { db: db as never, writeCase: landingWriter() },
    )
    expect(out).toMatchObject({ ok: false, code: 'INVALID' })
    expect(JSON.stringify(db.rows.get('doc-1')!.handoffInput)).toBe(before)
    expect(db.rows.get('doc-1')!.status).toBe('NEEDS_INPUT')
  })
})

// What extraction read is kept with the handoff, so a resume days later can
// still send the document's own words to the case.
describe('the evidence behind a handoff', () => {
  const readFields = [
    { fieldName: 'lines[0].net_mass_kg', extractedValue: '24000', sourceText: 'Net mass | 24 000 kg', confidence: 0.8 },
  ]

  it('is stored with the handoff and reaches the case payload', async () => {
    const db = await enqueued({ readFields })
    expect((db.rows.get('doc-1')!.handoffInput as any).readFields).toEqual(readFields)

    const writeCase = landingWriter()
    await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(writeCase.mock.calls[0][0].evidence).toEqual({
      sourceRef: 'arbor:document:doc-1',
      readFields,
      confirmed: Object.fromEntries(CONFIRMED),
    })
  })

  it('is simply absent for a handoff recorded before it was kept', async () => {
    const db = await enqueued()
    const writeCase = landingWriter()
    await runCbamHandoff('doc-1', { db: db as never, writeCase })
    expect(writeCase.mock.calls[0][0].evidence).toBeNull()
  })
})
