// A buyer who disputed a supplier's value is told how the supplier settled it:
// kept with a note, or corrected. Only while the buyer can still see that
// record, by the same grant rule every buyer read path uses, because the note
// is part of the supplier's data.

const grants = jest.fn()
const supplier = jest.fn()
const notify = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: {
    dataAccessGrant: { findMany: (...a: unknown[]) => grants(...a) },
    entity: { findUnique: (...a: unknown[]) => supplier(...a) },
  },
}))
jest.mock('@/lib/notifications', () => ({ sendNotification: (...a: unknown[]) => notify(...a) }))

import { tellDisputingBuyer } from '../dispute-answer'

const record = {
  fieldName: 'electricity_kwh',
  domain: 'ENERGY' as const,
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-09-30T00:00:00Z'),
}
const coveringGrant = { domain: null, periodStart: null, periodEnd: null, fieldNames: null }

beforeEach(() => {
  jest.clearAllMocks()
  grants.mockResolvedValue([coveringGrant])
  supplier.mockResolvedValue({ legalName: 'Acme Steel Ltd' })
})

it('tells the buyer the supplier kept the value, with their note', async () => {
  const told = await tellDisputingBuyer({
    supplierEntityId: 'org',
    buyerEntityId: 'buyer-1',
    record,
    outcome: 'kept',
    note: 'Checked against the meter.',
  })
  expect(told).toBe(true)
  expect(grants).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { grantorEntityId: 'org', granteeEntityId: 'buyer-1', isActive: true, revokedAt: null },
    }),
  )
  expect(notify).toHaveBeenCalledWith({
    entityId: 'buyer-1',
    type: 'BUYER_DISPUTE_ANSWERED',
    payload: {
      supplierName: 'Acme Steel Ltd',
      fieldLabel: expect.not.stringContaining('_'),
      period: 'Jul 2026 – Sep 2026',
      outcome: 'kept',
      note: 'Checked against the meter.',
    },
  })
})

it('tells the buyer the supplier corrected it', async () => {
  await tellDisputingBuyer({
    supplierEntityId: 'org',
    buyerEntityId: 'buyer-1',
    record,
    outcome: 'corrected',
  })
  expect(notify.mock.calls[0][0].payload).toMatchObject({ outcome: 'corrected', note: null })
})

it('says nothing to a buyer who can no longer see the record', async () => {
  grants.mockResolvedValue([{ ...coveringGrant, domain: 'MATERIALS' }])
  const told = await tellDisputingBuyer({
    supplierEntityId: 'org',
    buyerEntityId: 'buyer-1',
    record,
    outcome: 'kept',
    note: 'Private reasoning.',
  })
  expect(told).toBe(false)
  expect(notify).not.toHaveBeenCalled()
})
