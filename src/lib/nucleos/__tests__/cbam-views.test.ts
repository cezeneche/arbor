import { CBAM_VIEWS, resolveCbamView } from '../cbam-views'

// CBAM's screens are views of one section, reached by the same quiet ?view=
// toggle Records uses for Trends and Benchmarks.

describe('CBAM views', () => {
  it('opens on Cases', () => {
    expect(resolveCbamView(undefined)).toBe('cases')
  })

  it('resolves each known view', () => {
    for (const view of CBAM_VIEWS) {
      expect(resolveCbamView(view.id)).toBe(view.id)
    }
  })

  it('falls back rather than erroring on an unknown view', () => {
    // A stale or mistyped link is a navigation hint, not an instruction — it
    // should land somewhere useful rather than on an error page.
    expect(resolveCbamView('nonsense')).toBe('cases')
    expect(resolveCbamView('')).toBe('cases')
    expect(resolveCbamView(null)).toBe('cases')
  })

  it('every view has a label and an explanation', () => {
    for (const view of CBAM_VIEWS) {
      expect(view.label.length).toBeGreaterThan(0)
      expect(view.description.length).toBeGreaterThan(0)
    }
  })

  it('view ids are unique', () => {
    const ids = CBAM_VIEWS.map(v => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('carries the views the section is for', () => {
    expect(CBAM_VIEWS.map(v => v.id)).toEqual([
      'cases',
      'declarations',
      'relief',
      'suppliers',
    ])
  })
})
