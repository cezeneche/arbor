import { summariseRecordQuality, type QualityRecord } from '@/lib/layer3/record-quality'

// Layer 3, read-only: this only counts and classifies records already in the
// database. No calculation, no AI, no writes. It powers the calm "data quality"
// summary now folded into the Records screen.

// Keyed by document type now, not domain: a record set is only held to the
// admissibility spec of the documents actually behind it, which is what stops
// one freight invoice being marked as missing every bill-of-lading field.
const compulsory = {
  ELECTRICITY_BILL: ['total_consumption_kwh', 'supplier_name', 'meter_reference'],
  BILL_OF_LADING: ['gross_weight', 'origin'],
}

function rec(p: Partial<QualityRecord>): QualityRecord {
  return { domain: 'ENERGY', fieldName: 'supplier_name', trustTier: 'A', staleAfterDate: null, documentType: 'ELECTRICITY_BILL', ...p }
}

describe('summariseRecordQuality', () => {
  it('returns all zeros for no records', () => {
    expect(summariseRecordQuality([], compulsory)).toEqual({
      total: 0, verified: 0, declared: 0, estimated: 0, missingCompulsoryFields: 0, expiringSoon: 0,
      // an empty set makes no tier claim.
      tierComposition: {
        meet: null, total: 0,
        counts: { A: 0, B: 0, C: 0 },
        distribution: { A: 0, B: 0, C: 0 },
      },
    })
  })

  it('carries the lattice meet + distribution for the aggregate', () => {
    // Reason: two Verified + one Declared + one Estimated cannot be presented as
    // a Verified set — the meet is C (Estimated), the weakest member present.
    const s = summariseRecordQuality(
      [rec({ trustTier: 'A' }), rec({ trustTier: 'A' }), rec({ trustTier: 'B' }), rec({ trustTier: 'C' })],
      compulsory,
    )
    expect(s.tierComposition.meet).toBe('C')
    expect(s.tierComposition.counts).toEqual({ A: 2, B: 1, C: 1 })
    expect(s.tierComposition.distribution.A).toBeCloseTo(0.5, 10)
  })

  it('counts trust tiers under their plain-English buckets', () => {
    const s = summariseRecordQuality(
      [rec({ trustTier: 'A' }), rec({ trustTier: 'A' }), rec({ trustTier: 'B' }), rec({ trustTier: 'C' })],
      compulsory,
    )
    expect(s.total).toBe(4)
    expect(s.verified).toBe(2)
    expect(s.declared).toBe(1)
    expect(s.estimated).toBe(1)
  })

  it('counts compulsory fields absent only for domains that have data', () => {
    // ENERGY has supplier_name present → missing total_consumption_kwh + meter_reference = 2.
    // LOGISTICS has no records → contributes nothing (we never invent a domain).
    const s = summariseRecordQuality([rec({ domain: 'ENERGY', fieldName: 'supplier_name' })], compulsory)
    expect(s.missingCompulsoryFields).toBe(2)
  })

  it('does not double-count a compulsory field present in any record of the domain', () => {
    const s = summariseRecordQuality(
      [
        rec({ domain: 'ENERGY', fieldName: 'supplier_name' }),
        rec({ domain: 'ENERGY', fieldName: 'total_consumption_kwh' }),
        rec({ domain: 'ENERGY', fieldName: 'meter_reference' }),
      ],
      compulsory,
    )
    expect(s.missingCompulsoryFields).toBe(0)
  })

  it('counts records expiring within the window or already stale, ignoring null and far-future', () => {
    const now = new Date('2026-06-21T00:00:00Z')
    const s = summariseRecordQuality(
      [
        rec({ staleAfterDate: '2026-05-01T00:00:00Z' }), // already stale
        rec({ staleAfterDate: '2026-07-10T00:00:00Z' }), // within 30 days
        rec({ staleAfterDate: '2026-12-01T00:00:00Z' }), // far future — not counted
        rec({ staleAfterDate: null }),                   // never stales — not counted
      ],
      compulsory,
      { now, expiryWindowDays: 30 },
    )
    expect(s.expiringSoon).toBe(2)
  })
})
