import { CBAM_VIEWS, resolveCbamView } from '../cbam-views'

// CBAM's screens are views of one section, reached by the same quiet ?view=
// toggle Records uses for Trends and Benchmarks.

describe('CBAM views', () => {
  it('opens on the scope check', () => {
    // The question a user arrives with, answerable in seconds with no document.
    // Opening on Cases shows an empty table to everyone who has not started.
    expect(resolveCbamView(undefined)).toBe('scope')
  })

  it('scope check is the first view offered', () => {
    expect(CBAM_VIEWS[0].id).toBe('scope')
  })

  it('resolves each known view', () => {
    for (const view of CBAM_VIEWS) {
      expect(resolveCbamView(view.id)).toBe(view.id)
    }
  })

  it('falls back rather than erroring on an unknown view', () => {
    // A stale or mistyped link is a navigation hint, not an instruction — it
    // should land somewhere useful rather than on an error page.
    expect(resolveCbamView('nonsense')).toBe('scope')
    expect(resolveCbamView('')).toBe('scope')
    expect(resolveCbamView(null)).toBe('scope')
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

  // Declarations was removed: it showed built returns, and nothing in Arbor
  // builds one yet. A tab that is always empty teaches a user the section is
  // broken rather than that the feature is not here.
  it('carries the views the section is for', () => {
    expect(CBAM_VIEWS.map(v => v.id)).toEqual([
      'scope',
      'cases',
            'relief',
      'request',
    ])
  })
})
