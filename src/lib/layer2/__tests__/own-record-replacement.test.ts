import { planOwnRecordReplacement } from '../own-record-replacement'

// A document confirmed after it already wrote records — auto-accepted as
// Declared, or sent back to review by the constraint gate — must replace those
// records, not sit beside them. Supersession by exact period missed whenever the
// reviewer's corrections moved the period, and "keep both" skipped it entirely:
// two active records for one document, double-counted on every total.
describe('planOwnRecordReplacement', () => {
  const own = [
    { id: 'kwh-1', fieldName: 'total_consumption_kwh' },
    { id: 'm3-1', fieldName: 'total_consumption_m3' },
  ]

  it('supersedes each earlier record with the new record for the same field', () => {
    const plan = planOwnRecordReplacement(own, ['total_consumption_kwh', 'total_consumption_m3'])
    expect(plan.supersedeByField.get('total_consumption_kwh')).toEqual(['kwh-1'])
    expect(plan.supersedeByField.get('total_consumption_m3')).toEqual(['m3-1'])
    expect(plan.withdraw).toEqual([])
  })

  it('withdraws an earlier record whose field the reviewer cleared', () => {
    // Nothing replaces it, and leaving it active would keep a figure the
    // reviewer said the document does not state.
    const plan = planOwnRecordReplacement(own, ['total_consumption_kwh'])
    expect(plan.supersedeByField.get('total_consumption_kwh')).toEqual(['kwh-1'])
    expect(plan.withdraw).toEqual(['m3-1'])
  })

  it('has nothing to do for a document that never wrote records', () => {
    const plan = planOwnRecordReplacement([], ['total_consumption_kwh'])
    expect(plan.supersedeByField.size).toBe(0)
    expect(plan.withdraw).toEqual([])
  })
})
