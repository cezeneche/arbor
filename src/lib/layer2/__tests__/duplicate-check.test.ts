// Layer 2 — before a confirm writes, what would it duplicate?
//
// The write path already superseded on an exact match of entity, domain, field
// and both period boundaries. Production still holds two active records for the
// same customs declaration uploaded twice — same field, same value, same
// period, different documents, neither superseding the other — because an exact
// match is brittle: a domain that drifts (declared_weight is stored as
// Logistics but catalogued as Compliance) or a period boundary off by a day is
// enough to miss.
//
// So the match here is deliberately looser than the one that supersedes: same
// field, overlapping period. It exists to raise a question with the user, not to
// decide anything on its own.

import { findDuplicates, type CandidateField, type PriorRecord } from '../duplicate-check'

const candidate = (o: Partial<CandidateField> = {}): CandidateField => ({
  fieldName: 'declared_weight',
  domain: 'LOGISTICS',
  periodStart: new Date('2025-07-01'),
  periodEnd: new Date('2026-07-01'),
  ...o,
})

const prior = (o: Partial<PriorRecord> = {}): PriorRecord => ({
  id: 'p1',
  fieldName: 'declared_weight',
  domain: 'LOGISTICS',
  value: 24500,
  unit: 'kg',
  periodStart: new Date('2025-07-01'),
  periodEnd: new Date('2026-07-01'),
  ...o,
})

describe('findDuplicates', () => {
  it('finds nothing when the store is empty', () => {
    expect(findDuplicates([candidate()], [])).toEqual([])
  })

  it('finds nothing for a different field', () => {
    expect(findDuplicates([candidate()], [prior({ fieldName: 'shipment_weight' })])).toEqual([])
  })

  it('matches the same field over the same period', () => {
    const [match] = findDuplicates([candidate()], [prior()])
    expect(match.fieldName).toBe('declared_weight')
    expect(match.priorIds).toEqual(['p1'])
  })

  it('matches even when the domain drifted between write and catalogue', () => {
    // declared_weight is stored under Logistics but catalogued under Compliance.
    // An exact match on domain is exactly how the production duplicate got in.
    const [match] = findDuplicates([candidate({ domain: 'LOGISTICS' })], [prior({ domain: 'COMPLIANCE' })])
    expect(match.priorIds).toEqual(['p1'])
  })

  it('matches on overlap, not on identical boundaries', () => {
    const [match] = findDuplicates(
      [candidate({ periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-03-31') })],
      [prior({ periodStart: new Date('2025-07-01'), periodEnd: new Date('2026-07-01') })],
    )
    expect(match.priorIds).toEqual(['p1'])
  })

  it('ignores a period that does not overlap at all', () => {
    expect(findDuplicates(
      [candidate({ periodStart: new Date('2027-01-01'), periodEnd: new Date('2027-03-31') })],
      [prior()],
    )).toEqual([])
  })

  it('gathers every prior record a candidate would duplicate', () => {
    const [match] = findDuplicates([candidate()], [prior({ id: 'a' }), prior({ id: 'b' })])
    expect(match.priorIds.sort()).toEqual(['a', 'b'])
  })

  it('describes the prior record so the prompt can quote it', () => {
    const [match] = findDuplicates([candidate()], [prior({ value: 24500, unit: 'kg' })])
    expect(match.priorSummary).toContain('24,500')
    expect(match.priorSummary).toContain('kg')
  })

  it('returns one entry per field, not one per prior record', () => {
    const matches = findDuplicates([candidate()], [prior({ id: 'a' }), prior({ id: 'b' })])
    expect(matches).toHaveLength(1)
  })
})
