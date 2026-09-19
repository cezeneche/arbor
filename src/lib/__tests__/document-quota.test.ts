import { createDocumentWithinQuota, UploadQuotaError } from '../document-quota'

// The monthly upload cap was counted, then the document created in a separate
// statement — so two uploads at once could both see room for the last slot.
// The count and the create now share one serializable transaction.

function fakeClient(opts: { tier: string; uploadsThisMonth: number }) {
  const created: any[] = []
  const tx = {
    entity: { findUnique: jest.fn(async () => ({ planTier: opts.tier })) },
    document: {
      count: jest.fn(async () => opts.uploadsThisMonth + created.length),
      create: jest.fn(async ({ data }: any) => {
        const d = { id: `doc-${created.length + 1}`, ...data }
        created.push(d)
        return d
      }),
    },
    dataRecord: { count: jest.fn() },
    dataRequest: { findMany: jest.fn() },
  }
  return {
    tx,
    created,
    $transaction: jest.fn(async (fn: any, options: any) => {
      expect(options).toEqual({ isolationLevel: 'Serializable' })
      return fn(tx)
    }),
  }
}

const data = {
  entityId: 'ent-1', fileName: 'bill.pdf', fileType: 'application/pdf', documentType: 'ELECTRICITY_BILL',
  blobUrl: 'ent-1/1.pdf', submittedById: 'user-1', status: 'PENDING',
} as const

describe('createDocumentWithinQuota', () => {
  it('creates the document when the plan has room, counting in the same transaction', async () => {
    const client = fakeClient({ tier: 'PILOT', uploadsThisMonth: 3 })
    const doc = await createDocumentWithinQuota(data as never, { client: client as never })
    expect(doc.id).toBe('doc-1')
    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(client.tx.document.count).toHaveBeenCalled()
  })

  it('refuses the document when the plan is full, and creates nothing', async () => {
    const client = fakeClient({ tier: 'STARTER', uploadsThisMonth: 0 })
    await expect(createDocumentWithinQuota(data as never, { client: client as never })).rejects.toBeInstanceOf(UploadQuotaError)
    expect(client.created).toHaveLength(0)
  })
})
