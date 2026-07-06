import { planConstraintFlags, type RecordRef } from '../plan-flags'
import type { ConstraintRecordResult } from '@/lib/brain/types'

// Upgrade 3 — intake flagging. The brain returns algebraic-constraint violations
// per document (mass balance, non-negativity, implausible intensity). Each
// violation names a concrete field; this maps it back to the stored DataRecord
// so it can be raised as a non-blocking ValidationFlag for human review.

function ref(documentId: string, fieldName: string, dataRecordId: string): RecordRef {
  return { documentId, fieldName, dataRecordId }
}

describe('planConstraintFlags', () => {
  it('raises a flag on the DataRecord named by each violation', () => {
    const results: ConstraintRecordResult[] = [
      {
        id: 'doc1',
        violations: [
          {
            field: 'embedded_emissions_tco2e',
            type: 'MASS_BALANCE',
            severity: 'WARNING',
            message: 'emissions 200 ≠ tonnes×intensity (150) beyond 5%',
          },
        ],
        completions: [],
      },
    ]
    const flags = planConstraintFlags(results, [
      ref('doc1', 'quantity_tonnes', 'rec-a'),
      ref('doc1', 'embedded_emissions_tco2e', 'rec-b'),
    ])
    expect(flags).toEqual([
      {
        dataRecordId: 'rec-b',
        flagType: 'INTERNAL_INCONSISTENCY',
        severity: 'WARNING',
        message: 'emissions 200 ≠ tonnes×intensity (150) beyond 5%',
      },
    ])
  })

  it('maps a CRITICAL brain severity to a CRITICAL flag', () => {
    const results: ConstraintRecordResult[] = [
      {
        id: 'doc1',
        violations: [
          { field: 'quantity_tonnes', type: 'NON_NEGATIVITY', severity: 'CRITICAL', message: 'negative mass' },
        ],
        completions: [],
      },
    ]
    const flags = planConstraintFlags(results, [ref('doc1', 'quantity_tonnes', 'rec-a')])
    expect(flags).toHaveLength(1)
    expect(flags[0].severity).toBe('CRITICAL')
    expect(flags[0].dataRecordId).toBe('rec-a')
  })

  it('skips a violation whose field has no stored record (cannot attach a flag)', () => {
    const results: ConstraintRecordResult[] = [
      {
        id: 'doc1',
        violations: [
          { field: 'embedded_emissions_per_tonne', type: 'IMPLAUSIBLE_INTENSITY', severity: 'WARNING', message: 'out of range' },
        ],
        completions: [],
      },
    ]
    // Only quantity_tonnes was stored; the intensity field is derived and absent.
    const flags = planConstraintFlags(results, [ref('doc1', 'quantity_tonnes', 'rec-a')])
    expect(flags).toEqual([])
  })

  it('does not cross documents when resolving a violation field to a record', () => {
    const results: ConstraintRecordResult[] = [
      {
        id: 'doc1',
        violations: [
          { field: 'quantity_tonnes', type: 'NON_NEGATIVITY', severity: 'CRITICAL', message: 'negative mass' },
        ],
        completions: [],
      },
    ]
    // Same field name exists, but only under a different document.
    const flags = planConstraintFlags(results, [ref('doc2', 'quantity_tonnes', 'rec-other')])
    expect(flags).toEqual([])
  })

  it('normalises an unknown brain severity to WARNING', () => {
    const results: ConstraintRecordResult[] = [
      {
        id: 'doc1',
        violations: [
          { field: 'quantity_tonnes', type: 'PERCENT_BOUND', severity: 'weird', message: 'odd' },
        ],
        completions: [],
      },
    ]
    const flags = planConstraintFlags(results, [ref('doc1', 'quantity_tonnes', 'rec-a')])
    expect(flags[0].severity).toBe('WARNING')
  })

  it('ignores completions — they are not violations', () => {
    const results: ConstraintRecordResult[] = [
      {
        id: 'doc1',
        violations: [],
        completions: [
          { field: 'embedded_emissions_tco2e', value: 150, method: 'balance', determined: true, entropy_bits: 0 },
        ],
      },
    ]
    const flags = planConstraintFlags(results, [ref('doc1', 'quantity_tonnes', 'rec-a')])
    expect(flags).toEqual([])
  })
})
