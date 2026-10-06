/**
 * Switching the CBAM section on or off for an organisation. It changes only
 * whether CBAM appears in the navigation: no case, record or document is
 * touched, and an organisation with CBAM activity sees it whatever this says.
 */

const admin = { user: { id: 'user-1', entityId: 'ent-1', role: 'ADMIN' } }
const requireAdmin = jest.fn(async () => ({ session: admin, response: null }))
jest.mock('@/lib/auth-helpers', () => ({ requireAdmin: () => requireAdmin() }))

const update = jest.fn<Promise<object>, [unknown]>(async () => ({}))
jest.mock('@/lib/prisma', () => ({ prisma: { entity: { update: (a: unknown) => update(a) } } }))

import { POST } from '../cbam-section/route'

const post = (body: unknown) =>
  POST(new Request('http://arbor.test', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => jest.clearAllMocks())

it("switches the section on for the admin's own organisation", async () => {
  const res = await post({ enabled: true })
  expect(res.status).toBe(200)
  expect(update).toHaveBeenCalledWith({ where: { id: 'ent-1' }, data: { cbamEnabled: true } })
})

it('refuses anything but a boolean', async () => {
  const res = await post({ enabled: 'yes' })
  expect(res.status).toBe(400)
  expect(update).not.toHaveBeenCalled()
})

it('is for admins only', async () => {
  requireAdmin.mockResolvedValueOnce({
    session: null,
    response: new Response(null, { status: 403 }),
  } as never)
  const res = await post({ enabled: true })
  expect(res.status).toBe(403)
  expect(update).not.toHaveBeenCalled()
})
