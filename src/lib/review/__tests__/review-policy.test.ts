import {
  isCriticalDocumentType,
  digestFieldCount,
  shouldAutoAccept,
  summariseReviewQueue,
  derivePeriod,
} from '../review-policy'

describe('isCriticalDocumentType', () => {
  it('is true for CBAM, customs and certificate types', () => {
    expect(isCriticalDocumentType('CBAM_DECLARATION')).toBe(true)
    expect(isCriticalDocumentType('CUSTOMS_DECLARATION')).toBe(true)
    expect(isCriticalDocumentType('PRODUCT_CERTIFICATE')).toBe(true)
    expect(isCriticalDocumentType('ENVIRONMENTAL_CERTIFICATE')).toBe(true)
  })
  it('is false for low-stakes operational docs', () => {
    expect(isCriticalDocumentType('ELECTRICITY_BILL')).toBe(false)
    expect(isCriticalDocumentType('OTHER')).toBe(false)
    expect(isCriticalDocumentType('WATER_RECORD')).toBe(false)
  })
})

describe('shouldAutoAccept', () => {
  it('auto-accepts low-stakes docs with no critical flags', () => {
    expect(shouldAutoAccept('ELECTRICITY_BILL', 0)).toBe(true)
    expect(shouldAutoAccept('OTHER', 0)).toBe(true)
  })
  it('blocks low-stakes docs that raised a critical flag', () => {
    expect(shouldAutoAccept('ELECTRICITY_BILL', 1)).toBe(false)
  })
  it('always blocks critical document types, even with no critical flags', () => {
    expect(shouldAutoAccept('CBAM_DECLARATION', 0)).toBe(false)
    expect(shouldAutoAccept('CUSTOMS_DECLARATION', 0)).toBe(false)
  })
})

describe('summariseReviewQueue', () => {
  it('returns zero minutes for an empty queue', () => {
    expect(summariseReviewQueue(0)).toEqual({ fieldCount: 0, estimatedMinutes: 0 })
  })
  it('rounds up to at least one minute for any work', () => {
    expect(summariseReviewQueue(1).estimatedMinutes).toBe(1)
  })
  it('estimates ~30s per field', () => {
    expect(summariseReviewQueue(4).estimatedMinutes).toBe(2)
    expect(summariseReviewQueue(10).estimatedMinutes).toBe(5)
  })
})

describe('derivePeriod', () => {
  const now = new Date('2026-06-20T00:00:00.000Z')

  it('uses period_start / period_end when present', () => {
    const { periodStart, periodEnd } = derivePeriod(
      { period_start: '2026-01-01', period_end: '2026-03-31' },
      { now },
    )
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-03-31')
  })

  it('falls back to production_period_* fields', () => {
    const { periodEnd } = derivePeriod({ production_period_end: '2025-12-31' }, { now })
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2025-12-31')
  })

  it('falls back to a day-truncated trailing 12-month window when absent', () => {
    // Was `periodEnd === now` to the millisecond. That made the period a function
    // of upload time, so the same document uploaded twice produced two different
    // periods and supersession missed — see derive-period.test.ts. The window is
    // now truncated to whole days so a same-day re-upload supersedes.
    const { periodStart, periodEnd } = derivePeriod({}, { now })
    expect(periodEnd.toISOString()).toBe('2026-06-20T23:59:59.999Z')
    expect(periodStart.toISOString()).toBe('2025-06-20T00:00:00.000Z')
  })
})

// Auto-accepted documents were saved Declared with a promise that the weekly
// digest would invite a check that could make them Verified. The digest only
// counted flagged fields on documents still in review, so an auto-accepted
// document — which has no flags by construction — was never counted.
describe('digestFieldCount', () => {
  const fields = [
    { fieldName: 'total_consumption_kwh', rawValue: '12400', flagged: false },
    { fieldName: 'total_consumption_m3', rawValue: '800', flagged: true },
    { fieldName: 'supplier_name', rawValue: 'Octopus', flagged: false },
  ]

  it('counts the flagged fields of a document awaiting review', () => {
    expect(digestFieldCount({ autoAccepted: false, fields })).toBe(1)
  })

  it('counts every figure of an auto-accepted document, since none was checked', () => {
    expect(digestFieldCount({ autoAccepted: true, fields })).toBe(2)
  })
})
