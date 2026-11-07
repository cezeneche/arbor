import { splitFlagsForBuyer } from '../flag-notes'

// What a buyer sees of the flags on a supplier's record: the ones still open,
// and the ones the supplier settled by keeping the value with a note, which the
// buyer reads alongside the value. A resolved flag with no note says nothing.

const open = {
  severity: 'CRITICAL' as const,
  message: 'Certificate expired.',
  resolvedAt: null,
  resolvedNote: null,
}
const kept = {
  severity: 'WARNING' as const,
  message: 'Two documents disagree.',
  resolvedAt: new Date('2026-11-07T12:00:00Z'),
  resolvedNote: 'The meter was replaced in August.',
}
const silent = { ...kept, resolvedNote: null }

it('separates open flags from the supplier’s notes', () => {
  expect(splitFlagsForBuyer([open, kept, silent])).toEqual({
    open: [open],
    supplierNotes: [{ message: 'Two documents disagree.', note: 'The meter was replaced in August.' }],
  })
})

it('ignores a note that is only whitespace', () => {
  expect(splitFlagsForBuyer([{ ...kept, resolvedNote: '  ' }]).supplierNotes).toEqual([])
})
