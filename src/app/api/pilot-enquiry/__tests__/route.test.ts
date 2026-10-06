import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'

jest.mock('@/lib/prisma', () => ({ prisma: { pilotEnquiry: { create: jest.fn() } } }))
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
  RATE_LIMITS: { pilotEnquiry: { prefix: 'pilot-enquiry', limit: 5, window: '60 m' } },
}))

const create = prisma.pilotEnquiry.create as jest.Mock
const limit = checkRateLimit as jest.Mock

function request(body: unknown) {
  return new NextRequest('http://localhost/api/pilot-enquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const valid = {
  requestId: '11111111-1111-4111-8111-111111111111',
  orgName: 'Example Ltd',
  contactName: 'Alex Morgan',
  email: 'ALEX@example.com',
  audience: 'buyer',
  plan: 'Business',
  message: 'Supplier records',
}

beforeEach(() => {
  jest.clearAllMocks()
  limit.mockResolvedValue({ allowed: true, remaining: 4 })
  create.mockResolvedValue({ id: 'enquiry-1' })
})

test('stores a validated pilot request and normalises the email', async () => {
  const response = await POST(request(valid))
  expect(response.status).toBe(201)
  expect(create).toHaveBeenCalledWith({
    data: expect.objectContaining({ audience: 'buyer', plan: 'Business', email: 'alex@example.com' }),
  })
})

test('rejects invalid input and rate-limited requests without storing data', async () => {
  expect((await POST(request({ ...valid, email: 'invalid' }))).status).toBe(422)
  limit.mockResolvedValueOnce({ allowed: false, remaining: 0 })
  expect((await POST(request(valid))).status).toBe(429)
  expect(create).not.toHaveBeenCalled()
})

test('keeps a transient database failure recoverable to the client', async () => {
  create.mockRejectedValueOnce(new Error('database unavailable'))
  const response = await POST(request(valid))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('could not save') })
})

test('treats a repeated request ID as the same saved enquiry', async () => {
  create.mockRejectedValueOnce({ code: 'P2002' })
  const response = await POST(request(valid))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
})
