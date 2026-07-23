import {
  scoreCase,
  aggregateByGroup,
  compareToBaseline,
  buildEvalReport,
  KILL_SIGNAL_MAX_DROP,
  KILL_SIGNAL_MIN_ACCURACY,
} from '../evaluate'
import type { EvalCase, FieldScore, EvalBaseline } from '../types'

// Pre-deploy eval gate — pure scoring core. No DB, no AI, no disk.
// Scores a re-run extraction against human-verified expected values, aggregates
// per kill-signal group, and decides whether the run regressed versus the
// committed baseline. Reuses the calibration loop's correctness comparison
// (valuesMatch) and field-type taxonomy so the gate watches the same buckets the
// live accuracy monitor does.

const ecase = (over: Partial<EvalCase> & { id: string }): EvalCase => ({
  documentType: 'ELECTRICITY_BILL',
  fixture: 'x.pdf',
  mediaType: 'application/pdf',
  expected: [],
  ...over,
})

describe('scoreCase', () => {
  it('matches expected fields to extracted values by name and marks correctness', () => {
    const c = ecase({
      id: 'c1',
      expected: [
        { fieldName: 'supplier_name', expectedValue: 'Acme Steel Ltd' },
        { fieldName: 'total_consumption_kwh', expectedValue: '1000' },
      ],
    })
    const scores = scoreCase(c, [
      { fieldName: 'supplier_name', rawValue: 'Acme Steel Ltd' },
      { fieldName: 'total_consumption_kwh', rawValue: '999' },
    ])
    expect(scores).toHaveLength(2)
    expect(scores.find(s => s.fieldName === 'supplier_name')!.correct).toBe(true)
    expect(scores.find(s => s.fieldName === 'total_consumption_kwh')!.correct).toBe(false)
  })

  it('treats thousands separators and case as cosmetic, not a miss (reuses valuesMatch)', () => {
    const c = ecase({ id: 'c2', expected: [{ fieldName: 'total_consumption_kwh', expectedValue: '48250' }] })
    const scores = scoreCase(c, [{ fieldName: 'total_consumption_kwh', rawValue: '48,250' }])
    expect(scores[0].correct).toBe(true)
  })

  it('a missing extraction for an expected field counts as incorrect (actual null)', () => {
    const c = ecase({ id: 'c3', expected: [{ fieldName: 'meter_reference', expectedValue: 'MPAN-1' }] })
    const scores = scoreCase(c, [])
    expect(scores[0].actual).toBeNull()
    expect(scores[0].correct).toBe(false)
  })

  it('when the model should find nothing and finds nothing, that is correct', () => {
    const c = ecase({ id: 'c4', expected: [{ fieldName: 'vat_number', expectedValue: null }] })
    const scores = scoreCase(c, [])
    expect(scores[0].correct).toBe(true)
  })

  it('assigns the kill-signal group for grouped field names, and the raw name otherwise', () => {
    const c = ecase({
      id: 'c5',
      expected: [
        { fieldName: 'supplier_name', expectedValue: 'A' },
        { fieldName: 'declared_weight', expectedValue: '10' },
        { fieldName: 'invoice_number', expectedValue: 'X' },
      ],
    })
    const scores = scoreCase(c, [
      { fieldName: 'supplier_name', rawValue: 'A' },
      { fieldName: 'declared_weight', rawValue: '10' },
      { fieldName: 'invoice_number', rawValue: 'X' },
    ])
    expect(scores.find(s => s.fieldName === 'supplier_name')!.group).toBe('supplier_identity')
    expect(scores.find(s => s.fieldName === 'declared_weight')!.group).toBe('mass')
    expect(scores.find(s => s.fieldName === 'invoice_number')!.group).toBe('invoice_number')
  })
})

describe('aggregateByGroup', () => {
  it('collapses many field scores into per-group accuracy and flags kill-signal groups', () => {
    const scores: FieldScore[] = [
      { caseId: 'a', fieldName: 'supplier_name', group: 'supplier_identity', expected: 'A', actual: 'A', correct: true },
      { caseId: 'b', fieldName: 'account_holder_name', group: 'supplier_identity', expected: 'B', actual: 'X', correct: false },
      { caseId: 'a', fieldName: 'invoice_number', group: 'invoice_number', expected: 'I', actual: 'I', correct: true },
    ]
    const groups = aggregateByGroup(scores)
    const identity = groups.find(g => g.group === 'supplier_identity')!
    expect(identity).toMatchObject({ total: 2, correct: 1, accuracy: 0.5, isKillSignalGroup: true })
    expect(groups.find(g => g.group === 'invoice_number')!.isKillSignalGroup).toBe(false)
  })
})

describe('compareToBaseline', () => {
  const baseline: EvalBaseline = {
    groups: { supplier_identity: 0.95, mass: 0.9, invoice_number: 0.7 },
    overall: 0.9,
  }

  it('flags a kill-signal group that drops more than the tolerance', () => {
    const regressions = compareToBaseline(
      [{ group: 'mass', total: 10, correct: 8, accuracy: 0.8, isKillSignalGroup: true }],
      baseline,
    )
    // 0.9 baseline -> 0.8 current = 0.10 drop > KILL_SIGNAL_MAX_DROP
    expect(regressions).toHaveLength(1)
    expect(regressions[0]).toMatchObject({ group: 'mass', reason: 'kill-signal-regression' })
  })

  it('flags a kill-signal group below the absolute floor even without a baseline entry', () => {
    const regressions = compareToBaseline(
      [{ group: 'emissions_intensity', total: 4, correct: 2, accuracy: 0.5, isKillSignalGroup: true }],
      { groups: {}, overall: 0 },
    )
    expect(regressions).toHaveLength(1)
    expect(regressions[0].reason).toBe('below-floor')
  })

  it('does not gate on a non-kill-signal group regressing (informational only)', () => {
    const regressions = compareToBaseline(
      [{ group: 'invoice_number', total: 10, correct: 3, accuracy: 0.3, isKillSignalGroup: false }],
      baseline,
    )
    expect(regressions).toHaveLength(0)
  })

  it('a small dip within tolerance and above the floor is not a regression', () => {
    const regressions = compareToBaseline(
      [{ group: 'supplier_identity', total: 20, correct: 19, accuracy: 0.95, isKillSignalGroup: true }],
      baseline,
    )
    expect(regressions).toHaveLength(0)
  })

  it('an improvement over baseline is never a regression', () => {
    const regressions = compareToBaseline(
      [{ group: 'mass', total: 10, correct: 10, accuracy: 1, isKillSignalGroup: true }],
      baseline,
    )
    expect(regressions).toHaveLength(0)
  })
})

describe('buildEvalReport', () => {
  const cases: EvalCase[] = [
    ecase({ id: 'c1', expected: [{ fieldName: 'supplier_name', expectedValue: 'Acme' }] }),
    ecase({ id: 'c2', expected: [{ fieldName: 'declared_weight', expectedValue: '10' }] }),
  ]
  const extractedByCase: Record<string, { fieldName: string; rawValue: string | null }[]> = {
    c1: [{ fieldName: 'supplier_name', rawValue: 'Acme' }],
    c2: [{ fieldName: 'declared_weight', rawValue: '999' }], // wrong
  }

  it('passes when every kill-signal group holds up, and fails when one regresses', () => {
    const goodBaseline: EvalBaseline = { groups: { supplier_identity: 1, mass: 1 }, overall: 1 }
    const report = buildEvalReport('claude-sonnet-4-6+v1', cases, extractedByCase, goodBaseline)
    expect(report.caseCount).toBe(2)
    expect(report.fieldCount).toBe(2)
    expect(report.overall).toBe(0.5)
    // mass went 1.0 -> 0.0, a kill-signal regression
    expect(report.passed).toBe(false)
    expect(report.regressions.some(r => r.group === 'mass')).toBe(true)
  })

  it('passes with an empty baseline as long as kill-signal groups clear the floor', () => {
    const allCorrect: Record<string, { fieldName: string; rawValue: string | null }[]> = {
      c1: [{ fieldName: 'supplier_name', rawValue: 'Acme' }],
      c2: [{ fieldName: 'declared_weight', rawValue: '10' }],
    }
    const report = buildEvalReport('v', cases, allCorrect, { groups: {}, overall: 0 })
    expect(report.passed).toBe(true)
  })
})

describe('gate thresholds', () => {
  it('are sane constants', () => {
    expect(KILL_SIGNAL_MAX_DROP).toBeGreaterThan(0)
    expect(KILL_SIGNAL_MAX_DROP).toBeLessThan(0.5)
    expect(KILL_SIGNAL_MIN_ACCURACY).toBeGreaterThan(0.5)
    expect(KILL_SIGNAL_MIN_ACCURACY).toBeLessThanOrEqual(1)
  })
})
