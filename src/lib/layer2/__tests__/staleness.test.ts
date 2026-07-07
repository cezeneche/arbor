import { computeStaleAfterDate } from '../staleness'
import { BATCH_RECORD_STALE_DAYS } from '@/lib/constants'

// batch/mill records (production logs, material intake, delivery notes)
// are valid only for the period they cover. They carry no expiry_date, so we
// derive a staleness horizon of periodEnd + BATCH_RECORD_STALE_DAYS.

describe('computeStaleAfterDate', () => {
  const periodEnd = new Date('2026-03-31T00:00:00.000Z')

  it('sets a staleness horizon for production logs', () => {
    const result = computeStaleAfterDate('PRODUCTION_LOG', periodEnd)
    expect(result).not.toBeNull()
    const expected = new Date(periodEnd)
    expected.setDate(expected.getDate() + BATCH_RECORD_STALE_DAYS)
    expect(result!.getTime()).toBe(expected.getTime())
  })

  it('sets a staleness horizon for material intake and delivery notes', () => {
    expect(computeStaleAfterDate('MATERIAL_INTAKE', periodEnd)).not.toBeNull()
    expect(computeStaleAfterDate('DELIVERY_NOTE', periodEnd)).not.toBeNull()
  })

  it('returns null for document types that do not go stale by batch', () => {
    expect(computeStaleAfterDate('ELECTRICITY_BILL', periodEnd)).toBeNull()
    expect(computeStaleAfterDate('PRODUCT_CERTIFICATE', periodEnd)).toBeNull()
    expect(computeStaleAfterDate('CBAM_DECLARATION', periodEnd)).toBeNull()
  })

  it('uses the configured number of days', () => {
    const result = computeStaleAfterDate('PRODUCTION_LOG', periodEnd)
    const days = Math.round((result!.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24))
    expect(days).toBe(BATCH_RECORD_STALE_DAYS)
  })
})
