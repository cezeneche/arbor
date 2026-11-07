import { NextRequest } from 'next/server'

// A buyer's dispute raises a flag on the supplier's record. The flag names the
// buyer who raised it, so that when the supplier settles it from Review the
// same buyer can be told the answer.

const flagCreate = jest.fn()
jest.mock('@/lib/api-key-auth', () => ({
  authenticateApiKeyRequest: async () => ({ authorized: true, entityId: 'buyer-1', scope: 'READ_WRITE' }),
}))
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }), RATE_LIMITS: {} }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    dataRecord: {
      findUnique: async () => ({
        id: 'rec-1',
        entityId: 'org',
        isActive: true,
        domain: 'ENERGY',
        fieldName: 'electricity_kwh',
        value: 148320,
        originalValue: 41200,
        confidenceScore: 0.97,
        documentId: 'doc-1',
        periodStart: new Date('2026-07-01T00:00:00Z'),
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        document: { documentType: 'ELECTRICITY_BILL', extractionJobs: [] },
      }),
    },
    dataAccessGrant: {
      findMany: async () => [{ domain: null, periodStart: null, periodEnd: null, fieldNames: null }],
    },
    groundTruthLabel: { create: async () => ({ id: 'label-1' }) },
    validationFlag: { create: (...a: unknown[]) => flagCreate(...a) },
  },
}))
jest.mock('@/lib/stewardship/route-flags', () => ({
  stampFlagOwnership: async (flags: unknown[]) => flags,
}))
jest.mock('@/lib/notifications', () => ({ sendNotification: jest.fn() }))
jest.mock('@/lib/layer3/grant-access', () => ({ logRecordAccess: jest.fn() }))
import { POST } from '../route'

it('records which buyer raised the dispute on the flag', async () => {
  const res = await POST(
    new NextRequest('http://localhost/api/v1/records/rec-1/dispute', {
      method: 'POST',
      body: JSON.stringify({
        decision: 'dispute',
        suggestedValue: '44900',
        note: 'Our meter says otherwise.',
      }),
    }),
    { params: Promise.resolve({ recordId: 'rec-1' }) },
  )
  expect(res.status).toBe(200)
  expect(flagCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({
      dataRecordId: 'rec-1',
      flagType: 'BUYER_DISPUTED',
      raisedByEntityId: 'buyer-1',
    }),
  })
})
