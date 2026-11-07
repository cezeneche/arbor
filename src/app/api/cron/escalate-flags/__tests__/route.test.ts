import { NextRequest } from 'next/server'

// Only flags a supplier can still act on escalate. A record replaced by a
// correction or a newer document is inactive, and its flags went with it: the
// supplier cannot resolve them from Review, so chasing them as overdue would
// nag about something that is already fixed.

const findMany = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: { validationFlag: { findMany: (...a: unknown[]) => findMany(...a), updateMany: jest.fn() } },
}))
jest.mock('@/lib/notifications', () => ({ sendNotification: jest.fn() }))
import { GET } from '../route'

it('only looks at flags on active records', async () => {
  process.env.CRON_SECRET = 'secret'
  findMany.mockResolvedValue([])
  await GET(
    new NextRequest('http://localhost/api/cron/escalate-flags', {
      headers: { authorization: 'Bearer secret' },
    }),
  )
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ dataRecord: { isActive: true } }) }),
  )
})
