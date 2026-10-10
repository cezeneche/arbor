/**
 * @jest-environment node
 */

// The confirm transaction runs through runSerializable, which retries the whole
// callback on a write conflict. Anything the callback records outside itself
// survives a failed attempt. It used to push superseded scopes into an array
// declared outside, so an attempt that superseded a record and then lost its
// commit still told buyers the record had been corrected, even when the attempt
// that did commit superseded nothing (code review R4).

import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

const sendNotification = jest.fn()
const dispatchWebhook = jest.fn()

jest.mock('@/lib/auth-helpers', () => ({
  requireWriteAccess: async () => ({ session: { user: { id: 'user-1', entityId: 'entity-1' } } }),
}))
jest.mock('@/lib/session', () => ({ getSessionUser: (s: { user: unknown }) => s.user }))
jest.mock('@/lib/notifications', () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }))
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: (...a: unknown[]) => dispatchWebhook(...a) }))
jest.mock('@/lib/layer3/grant-access', () => ({ findActiveGranteeEntityIds: async () => ['buyer-1'] }))
jest.mock('@/lib/plan-guard', () => ({ assertRecordCapacity: async () => ({ allowed: true }) }))
jest.mock('@/lib/validation/cross-validation', () => ({ runCrossValidation: async () => {} }))
jest.mock('@/lib/constraints/run-constraint-validation', () => ({ runConstraintValidation: async () => {} }))
jest.mock('@/lib/layer2/record-writer', () => {
  let n = 0
  return { writeRecordWithAuditEntry: async () => ({ recordId: `new-${++n}` }) }
})

// One attempt's view of the database: whether a prior record is still active
// for the period this document confirms.
let attempt = 0
const tx = {
  document: { updateMany: async () => ({ count: 1 }) },
  dataRecord: {
    findMany: async (args: { where: { documentId?: string } }) => {
      if (args.where.documentId) return [] // this document's own earlier records
      // First attempt finds the prior record; by the second, a concurrent
      // confirmation has already superseded it.
      return attempt === 1 ? [{ id: 'prior-1' }] : []
    },
    updateMany: async () => ({ count: 1 }),
    update: async () => ({}),
  },
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findUnique: async () => ({
        id: 'doc-1',
        entityId: 'entity-1',
        documentType: 'ELECTRICITY_BILL',
        status: 'REVIEW_REQUIRED',
        autoAcceptedAt: null,
        extractionJobs: [],
      }),
    },
    entity: { findUnique: async () => ({ legalName: 'Acme Steel Ltd', cbamJurisdiction: null }) },
    dataRecord: { findMany: async () => [] },
    groundTruthLabel: { createMany: async () => ({ count: 0 }) },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      attempt++
      const result = await fn(tx)
      if (attempt === 1) {
        throw new Prisma.PrismaClientKnownRequestError('write conflict', {
          code: 'P2034',
          clientVersion: 'test',
        })
      }
      return result
    },
  },
}))

import { POST } from '../route'

function confirm() {
  return POST(
    new NextRequest('http://arbor.test/api/documents/doc-1/confirm', {
      method: 'POST',
      body: JSON.stringify({
        onDuplicate: 'replace',
        fields: [
          {
            fieldName: 'total_consumption_kwh',
            confirmedValue: '1200',
            confirmedUnit: 'kWh',
            domain: 'ENERGY',
            periodStart: '2026-01-01T00:00:00.000Z',
            periodEnd: '2026-01-31T23:59:59.999Z',
          },
        ],
      }),
    }),
    { params: Promise.resolve({ id: 'doc-1' }) },
  )
}

beforeEach(() => {
  attempt = 0
  sendNotification.mockReset()
  dispatchWebhook.mockReset()
})

it('commits on the retry after a write conflict', async () => {
  const res = await confirm()
  expect(res.status).toBe(200)
  expect(attempt).toBe(2)
})

it('does not tell buyers about a supersession only the failed attempt made', async () => {
  await confirm()
  expect(sendNotification).not.toHaveBeenCalled()
  expect(dispatchWebhook).not.toHaveBeenCalledWith('buyer-1', 'record.superseded', expect.anything())
})
