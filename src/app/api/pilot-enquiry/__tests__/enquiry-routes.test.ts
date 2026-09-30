/**
 * Both public enquiry routes announce a newly saved enquiry, and only a newly
 * saved one: not a bot caught by the hidden field, not a retried duplicate.
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
  RATE_LIMITS: { pilotEnquiry: {}, institutionalEnquiry: {} },
}))
const pilotCreate = jest.fn()
const institutionalCreate = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: {
    pilotEnquiry: { create: (a: unknown) => pilotCreate(a) },
    institutionalEnquiry: { create: (a: unknown) => institutionalCreate(a) },
  },
}))
const alert = jest.fn<Promise<boolean>, unknown[]>(async () => true)
jest.mock('@/lib/marketing/enquiry-alert', () => ({ sendEnquiryAlert: (...a: unknown[]) => alert(...a) }))

import { NextRequest } from 'next/server'
import { POST as pilot } from '../route'
import { POST as institutional } from '../../institutional/enquiry/route'

const req = (body: unknown) =>
  new NextRequest('http://arbor.test/api', { method: 'POST', body: JSON.stringify(body) })

const pilotBody = {
  requestId: '6f1c1a3e-2b8d-4c1e-9f3a-1b2c3d4e5f60',
  orgName: 'Example Imports Ltd',
  contactName: 'Sam Lee',
  email: 'sam@example.com',
  audience: 'importer',
}

beforeEach(() => {
  jest.clearAllMocks()
  pilotCreate.mockResolvedValue({})
  institutionalCreate.mockResolvedValue({})
})

describe('pilot enquiry', () => {
  it('announces a newly saved enquiry', async () => {
    expect((await pilot(req(pilotBody))).status).toBe(201)
    expect(alert).toHaveBeenCalledWith({ kind: 'pilot', orgName: 'Example Imports Ltd', detail: 'importer' })
  })

  it('does not announce a bot caught by the hidden field', async () => {
    await pilot(req({ ...pilotBody, website: 'spam' }))
    expect(alert).not.toHaveBeenCalled()
  })

  it('does not announce a retried duplicate', async () => {
    pilotCreate.mockRejectedValue({ code: 'P2002' })
    expect((await pilot(req(pilotBody))).status).toBe(200)
    expect(alert).not.toHaveBeenCalled()
  })
})

describe('institutional enquiry', () => {
  it('announces a newly saved enquiry', async () => {
    const res = await institutional(
      req({ orgName: 'Uni', contactName: 'Dr A', email: 'a@uni.test', interestArea: 'POLICY' }),
    )
    expect(res.status).toBe(201)
    expect(alert).toHaveBeenCalledWith({ kind: 'institutional', orgName: 'Uni', detail: 'policy' })
  })
})
