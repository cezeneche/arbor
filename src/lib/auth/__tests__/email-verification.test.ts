/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles stand in for Prisma's generic argument types */
import { issueEmailVerification, consumeEmailVerification, VERIFY_TTL_MS } from '../email-verification'
import { hashOpaqueToken } from '@/lib/tokens/opaque-token'

// A new account proves it controls its email address by opening a link. It
// does not block sign-in — the account works either way — but it is recorded,
// so an unconfirmed address is never taken as a confirmed one.
function fakeDb() {
  const tokens: any[] = []
  const users = new Map<string, any>([['user-1', { id: 'user-1', emailVerifiedAt: null }]])
  const db = {
    tokens,
    users,
    emailVerificationToken: {
      create: jest.fn(async ({ data }: any) => { tokens.push({ ...data, usedAt: null }); return data }),
      findUnique: jest.fn(async ({ where }: any) => tokens.find(t => t.tokenHash === where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(tokens.find(t => t.tokenHash === where.tokenHash), data)),
    },
    user: { update: jest.fn(async ({ where, data }: any) => Object.assign(users.get(where.id), data)) },
    $transaction: async (fn: any) => fn(db),
  }
  return db
}

describe('email verification', () => {
  const now = new Date('2026-09-19T12:00:00Z')

  it('issues a token stored only as its hash', async () => {
    const db = fakeDb()
    const { token } = await issueEmailVerification(db as never, 'user-1', now)
    expect(db.tokens[0].tokenHash).toBe(hashOpaqueToken(token))
    expect(db.tokens[0]).not.toHaveProperty('token')
    expect(db.tokens[0].expiresAt.getTime()).toBe(now.getTime() + VERIFY_TTL_MS)
  })

  it('verifies the address once, and refuses the same link again', async () => {
    const db = fakeDb()
    const { token } = await issueEmailVerification(db as never, 'user-1', now)
    expect(await consumeEmailVerification(db as never, token, now)).toBe('verified')
    expect(db.users.get('user-1').emailVerifiedAt).toEqual(now)
    expect(await consumeEmailVerification(db as never, token, now)).toBe('invalid')
  })

  it('refuses an expired link and an unknown one', async () => {
    const db = fakeDb()
    const { token } = await issueEmailVerification(db as never, 'user-1', now)
    const later = new Date(now.getTime() + VERIFY_TTL_MS + 1)
    expect(await consumeEmailVerification(db as never, token, later)).toBe('expired')
    expect(await consumeEmailVerification(db as never, 'nonsense', now)).toBe('invalid')
    expect(db.users.get('user-1').emailVerifiedAt).toBeNull()
  })
})
