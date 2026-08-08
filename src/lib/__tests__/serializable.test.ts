import { Prisma } from '@prisma/client'
import { runSerializable, isWriteConflict } from '@/lib/layer2/serializable'
import type { RunSerializableOptions } from '@/lib/layer2/serializable'

// The injectable client only has to answer $transaction; naming that precisely
// beats casting it away, which is what hid the shape from the compiler.
type TestClient = NonNullable<RunSerializableOptions['client']>
type TxFn = Parameters<TestClient['$transaction']>[0]

function writeConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  })
}

const noSleep = async () => {}

describe('runSerializable', () => {
  it('returns the result on first success', async () => {
    const client = { $transaction: jest.fn((async (fn: TxFn) => fn({} as never)) as TestClient['$transaction']) }
    const result = await runSerializable(async () => 'ok', { client: client as unknown as TestClient, sleep: noSleep })
    expect(result).toBe('ok')
    expect(client.$transaction).toHaveBeenCalledTimes(1)
  })

  it('retries on P2034 write conflict then succeeds', async () => {
    let calls = 0
    const client = {
      $transaction: jest.fn((async (fn: TxFn) => {
        calls++
        if (calls < 3) throw writeConflict()
        return fn({} as never)
      }) as TestClient['$transaction']),
    }
    const result = await runSerializable(async () => 'done', {
      client: client as unknown as TestClient,
      sleep: noSleep,
      retries: 3,
    })
    expect(result).toBe('done')
    expect(client.$transaction).toHaveBeenCalledTimes(3)
  })

  it('rethrows the conflict after exhausting retries', async () => {
    const client = { $transaction: jest.fn(async () => { throw writeConflict() }) }
    await expect(
      runSerializable(async () => 'never', { client: client as unknown as TestClient, sleep: noSleep, retries: 3 }),
    ).rejects.toMatchObject({ code: 'P2034' })
    expect(client.$transaction).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-conflict error (e.g. app control flow)', async () => {
    const appError = new Error('ALREADY_RESPONDED')
    appError.name = 'ALREADY_RESPONDED'
    const client = { $transaction: jest.fn(async () => { throw appError }) }
    await expect(
      runSerializable(async () => 'never', { client: client as unknown as TestClient, sleep: noSleep, retries: 3 }),
    ).rejects.toThrow('ALREADY_RESPONDED')
    expect(client.$transaction).toHaveBeenCalledTimes(1)
  })

  it('isWriteConflict identifies only P2034', () => {
    expect(isWriteConflict(writeConflict())).toBe(true)
    expect(isWriteConflict(new Error('nope'))).toBe(false)
  })
})
