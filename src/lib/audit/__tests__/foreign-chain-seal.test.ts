import {
  recordForeignChainSeal,
  listForeignChainSeals,
  ChainAlreadySealedError,
  NUCLEOS_SEAL_REASON,
} from '../foreign-chain-seal'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    foreignChainSeal: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'

const mocked = prisma as unknown as {
  foreignChainSeal: {
    findUnique: jest.Mock
    create: jest.Mock
    findMany: jest.Mock
  }
}

const SEAL = {
  origin: 'nucleos.cbam.audit_log',
  algorithm: 'SHA256-over-ordered-signatures-v1',
  entryCount: 10,
  firstEventAt: '2026-05-11T09:17:09.474Z',
  lastEventAt: '2026-05-25T10:36:24.173Z',
  finalSignature: 'a'.repeat(64),
  sealHash: 'b'.repeat(64),
  sealedAt: '2026-08-10T12:00:00.000Z',
  importedIntoArbor: false,
  reason: NUCLEOS_SEAL_REASON,
}

describe('recordForeignChainSeal', () => {
  beforeEach(() => jest.clearAllMocks())

  it('records a chain that has stopped accepting writes', async () => {
    mocked.foreignChainSeal.findUnique.mockResolvedValue(null)
    mocked.foreignChainSeal.create.mockResolvedValue({ id: 'seal-1', ...SEAL })

    await recordForeignChainSeal(SEAL)

    const data = mocked.foreignChainSeal.create.mock.calls[0][0].data
    expect(data.origin).toBe('nucleos.cbam.audit_log')
    expect(data.entryCount).toBe(10)
    expect(data.sealHash).toBe(SEAL.sealHash)
  })

  it('records that nothing was imported, rather than leaving it implied', async () => {
    // A reader has to be able to tell "nothing was imported" from "nobody
    // recorded whether anything was imported".
    mocked.foreignChainSeal.findUnique.mockResolvedValue(null)
    mocked.foreignChainSeal.create.mockResolvedValue({})

    await recordForeignChainSeal(SEAL)

    expect(mocked.foreignChainSeal.create.mock.calls[0][0].data.importedIntoArbor).toBe(false)
  })

  it('carries the reason in plain English', async () => {
    mocked.foreignChainSeal.findUnique.mockResolvedValue(null)
    mocked.foreignChainSeal.create.mockResolvedValue({})

    await recordForeignChainSeal(SEAL)

    const { reason } = mocked.foreignChainSeal.create.mock.calls[0][0].data
    expect(reason).toMatch(/not imported/i)
    expect(reason).toMatch(/filed declaration/i)
  })

  it('parses the timestamps the boundary sends as strings', async () => {
    mocked.foreignChainSeal.findUnique.mockResolvedValue(null)
    mocked.foreignChainSeal.create.mockResolvedValue({})

    await recordForeignChainSeal(SEAL)

    const data = mocked.foreignChainSeal.create.mock.calls[0][0].data
    expect(data.sealedAt).toBeInstanceOf(Date)
    expect(data.firstEventAt).toBeInstanceOf(Date)
  })

  it('is idempotent for an identical seal', async () => {
    mocked.foreignChainSeal.findUnique.mockResolvedValue({ id: 'seal-1', ...SEAL })

    const result = await recordForeignChainSeal(SEAL)

    expect(result).toMatchObject({ id: 'seal-1' })
    expect(mocked.foreignChainSeal.create).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a seal with a different final state', async () => {
    // The one operation that could hide a chain having continued after it was
    // declared closed.
    mocked.foreignChainSeal.findUnique.mockResolvedValue({
      ...SEAL,
      sealHash: 'c'.repeat(64),
    })

    await expect(recordForeignChainSeal(SEAL)).rejects.toBeInstanceOf(ChainAlreadySealedError)
    expect(mocked.foreignChainSeal.create).not.toHaveBeenCalled()
  })

  it('rejects a seal with no usable timestamp', async () => {
    mocked.foreignChainSeal.findUnique.mockResolvedValue(null)

    await expect(
      recordForeignChainSeal({ ...SEAL, sealedAt: 'not-a-date' }),
    ).rejects.toThrow(/sealedAt/)
  })

  it('accepts an empty chain', async () => {
    // A chain with nothing in it is a fact worth recording, not an error.
    mocked.foreignChainSeal.findUnique.mockResolvedValue(null)
    mocked.foreignChainSeal.create.mockResolvedValue({})

    await recordForeignChainSeal({
      ...SEAL,
      entryCount: 0,
      finalSignature: null,
      firstEventAt: null,
      lastEventAt: null,
    })

    const data = mocked.foreignChainSeal.create.mock.calls[0][0].data
    expect(data.entryCount).toBe(0)
    expect(data.finalSignature).toBeNull()
  })
})

describe('listForeignChainSeals', () => {
  it('returns seals oldest first, for the audit package', async () => {
    // An audit package showing Arbor's chain alone would present it as though it
    // began from nothing.
    mocked.foreignChainSeal.findMany.mockResolvedValue([])

    await listForeignChainSeals()

    expect(mocked.foreignChainSeal.findMany).toHaveBeenCalledWith({
      orderBy: { sealedAt: 'asc' },
    })
  })
})
