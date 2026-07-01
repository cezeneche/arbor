import { buildPosteriorUpdates, groupKeyForField, type RecordForBackfill } from '../backfill'
import type { GroupCalibration } from '@/lib/brain/types'

// Step 5 (Upgrade 1). Given the brain's per-group calibration and the active
// records, decide which records get a calibrated confidencePosterior written
// back and what it is. Pure — the cron route wraps DB reads/writes around this.

function group(name: string, sufficient: boolean): GroupCalibration {
  return {
    group: name,
    n: sufficient ? 40 : 3,
    brier: 0.1,
    ece: 0.03,
    reliability: [
      { bin_lower: 0.5, bin_upper: 1.0, mean_predicted: 0.8, empirical_accuracy: 0.7, count: sufficient ? 30 : 3 },
    ],
    calibration_map: { method: 'isotonic', x: [0.5, 0.9], y: [0.6, 0.8] },
    sufficient,
  }
}

describe('groupKeyForField', () => {
  it('uses the coarse kill-signal type when known, else the field name', () => {
    expect(groupKeyForField('supplier_name')).toBe('supplier_identity')
    expect(groupKeyForField('invoice_number')).toBe('invoice_number')
  })
})

describe('buildPosteriorUpdates', () => {
  const records: RecordForBackfill[] = [
    { id: 'r_supplier', fieldName: 'supplier_name', confidenceScore: 0.8 },
    { id: 'r_mass', fieldName: 'shipment_weight', confidenceScore: 0.8 },
    { id: 'r_other', fieldName: 'invoice_number', confidenceScore: 0.8 },
  ]

  it('only writes back records whose group has a sufficient calibration', () => {
    const updates = buildPosteriorUpdates(records, [
      group('supplier_identity', true),
      group('mass', false), // not enough labels yet
      // invoice_number: no group at all
    ])
    expect(updates.map(u => u.recordId)).toEqual(['r_supplier'])
    expect(updates[0].posterior.priorClass).toBe('supplier_identity')
    expect(updates[0].posterior.method).toBe('isotonic')
  })

  it('includes insufficient groups when requireSufficient is false', () => {
    const updates = buildPosteriorUpdates(
      records,
      [group('supplier_identity', true), group('mass', false)],
      { requireSufficient: false },
    )
    expect(updates.map(u => u.recordId).sort()).toEqual(['r_mass', 'r_supplier'])
  })

  it('skips everything when no group matches', () => {
    expect(buildPosteriorUpdates(records, [group('emissions_intensity', true)])).toEqual([])
  })
})
