// When a supplier's record is replaced, every buyer with active access to it is
// told (PRD 20.3): once per buyer and domain, by notification and webhook. Used
// by document confirmation and by corrections made from Review.

const findSupplier = jest.fn()
const grantees = jest.fn()
const notify = jest.fn()
const webhook = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: { entity: { findUnique: (...a: unknown[]) => findSupplier(...a) } },
}))
jest.mock('@/lib/layer3/grant-access', () => ({
  findActiveGranteeEntityIds: (...a: unknown[]) => grantees(...a),
}))
jest.mock('@/lib/notifications', () => ({ sendNotification: (...a: unknown[]) => notify(...a) }))
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: (...a: unknown[]) => webhook(...a) }))

import { notifyBuyersOfSupersession } from '../supersession-notice'

const Q3 = { periodStart: new Date('2026-07-01T00:00:00Z'), periodEnd: new Date('2026-09-30T00:00:00Z') }

beforeEach(() => {
  jest.clearAllMocks()
  findSupplier.mockResolvedValue({ legalName: 'Acme Steel Ltd' })
  grantees.mockResolvedValue(['buyer-1', 'buyer-2'])
})

it('tells each buyer with access, by notification and webhook', async () => {
  await notifyBuyersOfSupersession('org', [{ domain: 'ENERGY', ...Q3 }])
  expect(grantees).toHaveBeenCalledWith('org', 'ENERGY', Q3.periodStart, Q3.periodEnd)
  expect(notify).toHaveBeenCalledTimes(2)
  expect(notify).toHaveBeenCalledWith({
    entityId: 'buyer-1',
    type: 'RECORD_SUPERSEDED',
    payload: {
      supplierName: 'Acme Steel Ltd',
      domain: 'ENERGY',
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
    },
  })
  expect(webhook).toHaveBeenCalledWith('buyer-2', 'record.superseded', {
    supplierEntityId: 'org',
    domain: 'ENERGY',
    periodStart: Q3.periodStart.toISOString(),
    periodEnd: Q3.periodEnd.toISOString(),
  })
})

it('tells a buyer once per domain however many records changed', async () => {
  grantees.mockResolvedValue(['buyer-1'])
  await notifyBuyersOfSupersession('org', [
    { domain: 'ENERGY', ...Q3 },
    { domain: 'ENERGY', ...Q3 },
  ])
  expect(notify).toHaveBeenCalledTimes(1)
})

it('does nothing when no record was replaced', async () => {
  await notifyBuyersOfSupersession('org', [])
  expect(findSupplier).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})
