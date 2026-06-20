import {
  isCriticalDocumentType,
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
    const { periodStart, periodEnd } = derivePeriod({ period_start: '2026-01-01', period_end: '2026-03-31' }, now)
    expect(periodStart.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-03-31')
  })

  it('falls back to production_period_* fields', () => {
    const { periodEnd } = derivePeriod({ production_period_end: '2025-12-31' }, now)
    expect(periodEnd.toISOString().slice(0, 10)).toBe('2025-12-31')
  })

  it('falls back to a trailing 12-month window when absent', () => {
    const { periodStart, periodEnd } = derivePeriod({}, now)
    expect(periodEnd.getTime()).toBe(now.getTime())
    expect(periodStart.toISOString().slice(0, 10)).toBe('2025-06-20')
  })
})
