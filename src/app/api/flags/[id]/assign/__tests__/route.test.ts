import { NextRequest, NextResponse } from 'next/server'

const auth = jest.fn()
const member = jest.fn()
const update = jest.fn()
jest.mock('@/lib/auth-helpers', () => ({ requireAdmin: () => auth() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: (...args: unknown[]) => member(...args) },
    validationFlag: { updateMany: (...args: unknown[]) => update(...args) },
  },
}))
import { PATCH } from '../route'

const call = (body: unknown = { userId: 'alex' }) =>
  PATCH(
    new NextRequest('http://localhost/api/flags/flag/assign', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'flag' }) },
  )
beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({
    session: { user: { id: 'admin', entityId: 'org', role: 'ADMIN' } },
    response: null,
  })
  member.mockResolvedValue({ id: 'alex', name: 'Alex' })
  update.mockResolvedValue({ count: 1 })
})
it('requires an administrator before reading members or changing ownership', async () => {
  auth.mockResolvedValue({
    session: null,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  })
  expect((await call()).status).toBe(403)
  expect(member).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
})
it('rejects an assignee outside the active writing members of the organisation', async () => {
  member.mockResolvedValue(null)
  expect((await call()).status).toBe(400)
  expect(member).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'alex', entityId: 'org', isActive: true, role: { in: ['ADMIN', 'CONTRIBUTOR'] } },
    }),
  )
  expect(update).not.toHaveBeenCalled()
})
it('scopes the mutation to an unresolved active record in the caller’s organisation', async () => {
  expect((await call()).status).toBe(200)
  expect(update).toHaveBeenCalledWith({
    where: { id: 'flag', resolvedAt: null, dataRecord: { entityId: 'org', isActive: true } },
    data: { assigneeId: 'alex', assignedAt: expect.any(Date), assignedVia: 'ADMIN:admin' },
  })
})
it('does not claim success for a foreign, resolved or missing flag', async () => {
  update.mockResolvedValue({ count: 0 })
  expect((await call()).status).toBe(404)
})
it('rejects missing tenancy and malformed bodies', async () => {
  expect((await call({ userId: '' })).status).toBe(400)
  auth.mockResolvedValue({
    session: { user: { id: 'admin', entityId: null, role: 'ADMIN' } },
    response: null,
  })
  expect((await call()).status).toBe(403)
})
