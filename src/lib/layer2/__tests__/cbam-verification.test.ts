/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles stand in for Prisma's generic argument types */
import { createHash } from 'crypto'
import { decideStatement, submitStatement, type VerificationDeps } from '../cbam-verification'
import { VerificationRejectedError } from '@/lib/nucleos/verification-client'

// A verifier's statement: stored in Arbor, recorded in Nucleos by reference.
// The file must never be lost to a Nucleos failure, Nucleos must never be told
// about a file Arbor did not store, and a statement is decided once.

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25])
const sha = createHash('sha256').update(PDF).digest('hex')

function deps(over: Partial<VerificationDeps> = {}, nucleosStatus = 'not_required') {
  const rows = new Map<string, any>()
  let n = 0
  const calls: string[] = []
  const d: VerificationDeps = {
    db: {
      cbamVerificationStatement: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `stmt-${++n}`, syncedAt: null, syncError: null, status: 'SUBMITTED', ...data }
          rows.set(row.id, row)
          return row
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = { ...rows.get(where.id), ...data }
          rows.set(where.id, row)
          return row
        }),
        findFirst: jest.fn(async ({ where }: any) =>
          [...rows.values()].find(
            r => (!where.id || r.id === where.id) && r.entityId === where.entityId &&
              (!where.goodsLineId || r.goodsLineId === where.goodsLineId) &&
              (!where.status || r.status === where.status) &&
              (where.syncedAt?.not === undefined || r.syncedAt !== null),
          ) ?? null,
        ),
      },
    } as any,
    storeBytes: jest.fn(async () => ({ pathname: 'ent-1/file.pdf' })),
    lineStatus: jest.fn(async () => ({ status: nucleosStatus, reportHash: null })),
    nucleos: {
      request: jest.fn(async () => { calls.push('request') }),
      record: jest.fn(async () => { calls.push('record') }),
      accept: jest.fn(async () => { calls.push('accept') }),
      reject: jest.fn(async () => { calls.push('reject') }),
    },
    now: () => new Date('2027-03-20T10:00:00Z'),
    ...over,
  }
  return { d, rows, calls }
}

const input = {
  entityId: 'ent-1',
  userId: 'user-1',
  caseId: 'case-1',
  goodsLineId: 'gl-1',
  bytes: PDF,
  fileName: 'statement.pdf',
  verifierName: 'Carbon Assurance Ltd',
  verifierAccreditation: 'UKAS 9876',
}

describe('submitStatement', () => {
  it('stores the file, records it, and tells Nucleos by reference', async () => {
    const { d, rows, calls } = deps()
    const out = await submitStatement(input, d)
    expect(out).toMatchObject({ ok: true, synced: true })
    expect(calls).toEqual(['request', 'record'])
    expect(d.nucleos.record).toHaveBeenCalledWith('gl-1', {
      verifierName: 'Carbon Assurance Ltd',
      verifierAccreditation: 'UKAS 9876',
      documentRef: 'arbor:verification:stmt-1',
      sha256: sha,
    })
    expect(rows.get('stmt-1')).toMatchObject({ sha256: sha, storagePath: 'ent-1/file.pdf', syncedAt: expect.any(Date) })
  })

  it('does not ask for a statement again when Nucleos is already expecting one', async () => {
    const { d, calls } = deps({}, 'pending')
    await submitStatement(input, d)
    expect(calls).toEqual(['record'])
  })

  it('keeps the file and says so when Nucleos cannot be reached', async () => {
    const { d, rows } = deps({
      nucleos: { ...deps().d.nucleos, record: jest.fn(async () => { throw new Error('down') }) },
    })
    const out = await submitStatement(input, d)
    expect(out).toMatchObject({ ok: true, synced: false })
    expect(rows.get('stmt-1')).toMatchObject({ syncedAt: null, syncError: expect.stringMatching(/down/) })
  })

  // A record that landed but whose response was lost: Nucleos already holds this
  // exact file for the line, so it counts as recorded rather than being re-sent.
  it('treats a statement Nucleos already holds as recorded', async () => {
    const { d, calls } = deps({ lineStatus: jest.fn(async () => ({ status: 'submitted', reportHash: sha })) })
    const out = await submitStatement(input, d)
    expect(out).toMatchObject({ synced: true })
    expect(calls).toEqual([])
  })

  it('refuses anything that is not a PDF, storing nothing', async () => {
    const { d } = deps()
    const out = await submitStatement({ ...input, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, d)
    expect(out).toMatchObject({ ok: false, code: 'NOT_PDF' })
    expect(d.storeBytes).not.toHaveBeenCalled()
  })

  it('refuses a statement with no verifier named', async () => {
    const { d } = deps()
    expect(await submitStatement({ ...input, verifierName: '  ' }, d)).toMatchObject({ ok: false, code: 'INVALID' })
  })

  it('refuses a new statement while one is waiting for a decision', async () => {
    const { d } = deps()
    await submitStatement(input, d)
    expect(await submitStatement(input, d)).toMatchObject({ ok: false, code: 'AWAITING_DECISION' })
  })
})

describe('decideStatement', () => {
  async function submitted() {
    const h = deps()
    await submitStatement(input, h.d)
    return h
  }

  it('accepts, and records who decided', async () => {
    const { d, rows } = await submitted()
    const out = await decideStatement({ entityId: 'ent-1', userId: 'user-2', goodsLineId: 'gl-1', statementId: 'stmt-1', decision: 'accept' }, d)
    expect(out).toMatchObject({ ok: true })
    expect(d.nucleos.accept).toHaveBeenCalledWith('gl-1')
    expect(rows.get('stmt-1')).toMatchObject({ status: 'ACCEPTED', decidedById: 'user-2', decidedAt: expect.any(Date) })
  })

  it('rejects only with a reason', async () => {
    const { d, rows } = await submitted()
    expect(
      await decideStatement({ entityId: 'ent-1', userId: 'user-2', goodsLineId: 'gl-1', statementId: 'stmt-1', decision: 'reject' }, d),
    ).toMatchObject({ ok: false, code: 'INVALID' })
    await decideStatement(
      { entityId: 'ent-1', userId: 'user-2', goodsLineId: 'gl-1', statementId: 'stmt-1', decision: 'reject', reason: 'Wrong installation.' },
      d,
    )
    expect(d.nucleos.reject).toHaveBeenCalledWith('gl-1', 'Wrong installation.')
    expect(rows.get('stmt-1')).toMatchObject({ status: 'REJECTED', rejectionReason: 'Wrong installation.' })
  })

  it("does not decide another organisation's statement", async () => {
    const { d } = await submitted()
    expect(
      await decideStatement({ entityId: 'ent-2', userId: 'user-9', goodsLineId: 'gl-1', statementId: 'stmt-1', decision: 'accept' }, d),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('does not decide a statement through another goods line', async () => {
    const { d } = await submitted()
    expect(
      await decideStatement({ entityId: 'ent-1', userId: 'user-2', goodsLineId: 'gl-9', statementId: 'stmt-1', decision: 'accept' }, d),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('decides a statement once', async () => {
    const { d } = await submitted()
    await decideStatement({ entityId: 'ent-1', userId: 'user-2', goodsLineId: 'gl-1', statementId: 'stmt-1', decision: 'accept' }, d)
    expect(
      await decideStatement({ entityId: 'ent-1', userId: 'user-2', goodsLineId: 'gl-1', statementId: 'stmt-1', decision: 'accept' }, d),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('leaves the statement undecided when Nucleos refuses the step', async () => {
    const { d, rows } = await submitted()
    d.nucleos.accept = jest.fn(async () => { throw new VerificationRejectedError('already verified') })
    const out = await decideStatement({ entityId: 'ent-1', userId: 'user-2', goodsLineId: 'gl-1', statementId: 'stmt-1', decision: 'accept' }, d)
    expect(out).toMatchObject({ ok: false, code: 'REFUSED' })
    expect(rows.get('stmt-1').status).toBe('SUBMITTED')
  })
})
