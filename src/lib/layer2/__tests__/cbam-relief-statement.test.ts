/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles stand in for Prisma's generic argument types */
import { createHash } from 'crypto'
import {
  submitReliefStatement,
  syncReliefStatement,
  type ReliefStatementDeps,
} from '../cbam-relief-statement'
import { VerificationRejectedError } from '@/lib/nucleos/verification-client'

// The verifier's statement behind a carbon price relief claim. Stored in Arbor,
// recorded in Nucleos by reference against the claim that counts. As with the
// emissions statement, a Nucleos failure never loses the file.

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25])
const sha = createHash('sha256').update(PDF).digest('hex')

function deps(claims: any[] = [{ created_at: '2027-04-20T10:00:00Z', verification_document_hash: null }]) {
  const rows = new Map<string, any>()
  let n = 0
  const d: ReliefStatementDeps = {
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
      },
    } as any,
    storeBytes: jest.fn(async () => ({ pathname: 'ent-1/relief.pdf' })),
    claims: jest.fn(async () => claims),
    record: jest.fn(async () => {}),
    now: () => new Date('2027-04-21T10:00:00Z'),
  }
  return { d, rows }
}

const input = {
  entityId: 'ent-1',
  userId: 'user-1',
  caseId: 'case-1',
  goodsLineId: 'gl-1',
  bytes: PDF,
  fileName: 'relief.pdf',
  verifierName: 'Carbon Assurance Ltd',
  verifierAccreditation: 'UKAS 9876',
}

describe('submitReliefStatement', () => {
  it('stores the file as a relief statement and records it against the claim', async () => {
    const { d, rows } = deps()
    const out = await submitReliefStatement(input, d)
    expect(out).toMatchObject({ ok: true, synced: true })
    expect(d.record).toHaveBeenCalledWith('gl-1', { documentRef: 'arbor:verification:stmt-1', sha256: sha })
    expect(rows.get('stmt-1')).toMatchObject({ subject: 'RELIEF', sha256: sha, syncedAt: expect.any(Date) })
  })

  it('refuses when there is no claim yet, before storing anything', async () => {
    const { d } = deps([])
    const out = await submitReliefStatement(input, d)
    expect(out).toMatchObject({ ok: false, code: 'REFUSED' })
    expect(d.storeBytes).not.toHaveBeenCalled()
  })

  it('refuses when the claim that counts already has a statement', async () => {
    const { d } = deps([
      { created_at: '2027-04-19T10:00:00Z', verification_document_hash: null },
      { created_at: '2027-04-20T10:00:00Z', verification_document_hash: 'b'.repeat(64) },
    ])
    await expect(submitReliefStatement(input, d)).resolves.toMatchObject({ ok: false, code: 'REFUSED' })
  })

  it('applies the same checks as the emissions statement', async () => {
    const { d } = deps()
    await expect(submitReliefStatement({ ...input, verifierName: ' ' }, d)).resolves.toMatchObject({
      code: 'INVALID',
    })
    await expect(
      submitReliefStatement({ ...input, bytes: new Uint8Array([1, 2, 3, 4, 5]) }, d),
    ).resolves.toMatchObject({ code: 'NOT_PDF' })
  })

  it('keeps the file when Nucleos cannot be told, to retry later', async () => {
    const { d, rows } = deps()
    ;(d.record as jest.Mock).mockRejectedValue(new Error('down'))
    const out = await submitReliefStatement(input, d)
    expect(out).toMatchObject({ ok: true, synced: false })
    expect(rows.get('stmt-1')).toMatchObject({ syncedAt: null, syncError: expect.stringContaining('saved') })
  })

  it('says so when Nucleos cannot be asked whether a claim is waiting', async () => {
    const { d } = deps()
    ;(d.claims as jest.Mock).mockRejectedValue(new Error('down'))
    await expect(submitReliefStatement(input, d)).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    expect(d.storeBytes).not.toHaveBeenCalled()
  })
})

describe('syncReliefStatement', () => {
  const row = {
    id: 'stmt-9',
    nucleosCaseId: 'case-1',
    goodsLineId: 'gl-1',
    sha256: sha,
    verifierName: 'V',
    verifierAccreditation: 'A',
  }

  it('does not send a statement Nucleos already holds', async () => {
    const { d, rows } = deps([{ created_at: '2027-04-20T10:00:00Z', verification_document_hash: sha }])
    rows.set('stmt-9', row)
    await expect(syncReliefStatement(row, d)).resolves.toEqual({ ok: true })
    expect(d.record).not.toHaveBeenCalled()
  })

  it('reports a refusal from Nucleos as the reason', async () => {
    const { d, rows } = deps()
    rows.set('stmt-9', row)
    ;(d.record as jest.Mock).mockRejectedValue(
      new VerificationRejectedError('There is no relief claim waiting.'),
    )
    await expect(syncReliefStatement(row, d)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('There is no relief claim waiting.'),
    })
  })
})
