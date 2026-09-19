/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles stand in for Prisma's generic argument types */
import { createAccount, EmailTakenError } from '../create-account'

// Signup creates an organisation and its first user. They used to be two
// separate writes: a failure between them, or two signups racing for one email
// (both passed the "is this email free" check), left an organisation with no
// user — unreachable, and holding its name.

function fakeDb(opts: { emails?: string[]; failUserCreate?: boolean } = {}) {
  const entities: any[] = []
  const users: any[] = []
  const emails = new Set(opts.emails ?? [])
  const tx = {
    entity: { create: jest.fn(async ({ data }: any) => { const e = { id: `ent-${entities.length + 1}`, ...data }; entities.push(e); return e }) },
    user: {
      create: jest.fn(async ({ data }: any) => {
        if (opts.failUserCreate) throw new Error('connection reset')
        if (emails.has(data.email)) throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['email'] } })
        emails.add(data.email)
        const u = { id: `user-${users.length + 1}`, ...data }
        users.push(u)
        return u
      }),
    },
  }
  return {
    entities,
    users,
    // A transaction commits everything or nothing.
    $transaction: async (fn: any) => {
      const before = [entities.length, users.length]
      try {
        return await fn(tx)
      } catch (e) {
        entities.length = before[0]
        users.length = before[1]
        throw e
      }
    },
  }
}

const input = {
  companyName: 'Acme Steel', sector: 'steel', country: 'GB', entityType: 'SUPPLIER' as const,
  name: 'Ada', email: 'ada@acme.test', passwordHash: 'hash',
}

describe('createAccount', () => {
  it('creates the organisation and its admin together', async () => {
    const db = fakeDb()
    await createAccount(db as never, input)
    expect(db.entities).toHaveLength(1)
    expect(db.users[0]).toMatchObject({ email: 'ada@acme.test', role: 'ADMIN', entityId: db.entities[0].id })
  })

  it('leaves no organisation behind when the user cannot be created', async () => {
    const db = fakeDb({ failUserCreate: true })
    await expect(createAccount(db as never, input)).rejects.toThrow('connection reset')
    expect(db.entities).toHaveLength(0)
  })

  it('reports a taken email as such, and leaves no organisation behind', async () => {
    const db = fakeDb({ emails: ['ada@acme.test'] })
    await expect(createAccount(db as never, input)).rejects.toBeInstanceOf(EmailTakenError)
    expect(db.entities).toHaveLength(0)
  })
})
