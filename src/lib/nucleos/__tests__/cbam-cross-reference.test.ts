import {
  buildCbamCrossReference,
  formatCbamCrossReference,
} from '../cbam-cross-reference'

// The single line CBAM is allowed to place on a record surface. Without it a user
// can look at a supplier and not know that supplier carries six figures of
// exposure — the plan calls that the point at which the case for merging the two
// products fails.

describe('buildCbamCrossReference', () => {
  it('returns nothing for an entity that is not in scope', () => {
    // A "not in scope" line on every supplier is noise that trains people to
    // skip the line entirely, including on the suppliers where it matters.
    expect(buildCbamCrossReference({ entityId: 'e1', inScope: false })).toBeNull()
  })

  it('summarises an in-scope entity', () => {
    const summary = buildCbamCrossReference({
      entityId: 'e1',
      inScope: true,
      exposureGbp: 184_500,
      caseCount: 3,
    })
    expect(summary).not.toBeNull()
    expect(summary!.exposureGbp).toBe(184_500)
    expect(summary!.caseCount).toBe(3)
  })

  it('links into the CBAM section, not into Records', () => {
    const summary = buildCbamCrossReference({ entityId: 'e1', inScope: true })!
    expect(summary.href).toContain('/cbam')
    expect(summary.href).not.toContain('/records')
  })

  it('scopes the link to the entity', () => {
    const summary = buildCbamCrossReference({ entityId: 'ent 1/2', inScope: true })!
    expect(summary.href).toContain(encodeURIComponent('ent 1/2'))
  })

  it('withholds the figure when none can honestly be shown', () => {
    const summary = buildCbamCrossReference({
      entityId: 'e1',
      inScope: true,
      exposureGbp: null,
      exposureUnavailableReason: 'HMRC has not published a rate for iron_steel',
    })!
    expect(summary.exposureGbp).toBeNull()
    expect(summary.exposureUnavailable).toContain('HMRC')
  })

  it('never substitutes a zero for a missing figure', () => {
    // A zero reads as "no exposure". The whole point of the placeholder work is
    // that an unbacked number is worse than a missing one.
    const summary = buildCbamCrossReference({ entityId: 'e1', inScope: true })!
    expect(summary.exposureGbp).toBeNull()
    expect(summary.exposureUnavailable).toBeTruthy()
  })

  it('treats a non-finite figure as no figure', () => {
    const summary = buildCbamCrossReference({
      entityId: 'e1',
      inScope: true,
      exposureGbp: Number.NaN,
    })!
    expect(summary.exposureGbp).toBeNull()
  })
})

describe('formatCbamCrossReference', () => {
  it('renders one line, not a panel', () => {
    const line = formatCbamCrossReference(
      buildCbamCrossReference({
        entityId: 'e1',
        inScope: true,
        exposureGbp: 184_500,
        caseCount: 3,
      })!,
    )
    expect(line).toBe('In scope for CBAM · 3 CBAM cases · Exposure £184,500')
    expect(line).not.toContain('\n')
  })

  it('renders an em-dash rather than a number when the figure is withheld', () => {
    const line = formatCbamCrossReference(
      buildCbamCrossReference({ entityId: 'e1', inScope: true, caseCount: 1 })!,
    )
    expect(line).toContain('—')
    expect(line).not.toMatch(/£0/)
  })

  it('says one case in the singular', () => {
    const line = formatCbamCrossReference(
      buildCbamCrossReference({ entityId: 'e1', inScope: true, caseCount: 1 })!,
    )
    expect(line).toContain('1 CBAM case ')
  })
})
