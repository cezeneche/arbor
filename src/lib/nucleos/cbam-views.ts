// The views of the CBAM section.
//
// Views of one section rather than separate destinations, reached by the same
// quiet ?view= toggle Records uses for Trends and Benchmarks. Arbor's design
// rules forbid tabs, and a toggle keeps one primary action per screen.
//
// Defined here rather than inline so the set is testable and so the section page
// stays a thin renderer.

export const CBAM_VIEWS = [
  {
    id: 'cases',
    label: 'Cases',
    description:
      'Import cases, their consignments and goods lines, with the emissions method and provenance on every line.',
  },
  {
    id: 'declarations',
    label: 'Declarations',
    description: 'Built returns, their decision trace and the engine versions that produced them.',
  },
  {
    id: 'relief',
    label: 'Carbon price relief',
    description:
      'Relief claimed against carbon already paid in the country of origin, with verification status shown on every claim.',
  },
  {
    id: 'suppliers',
    label: 'Supplier data',
    description:
      'Requests sent to suppliers for the emissions intensity a goods line is missing, and what came back.',
  },
] as const

export type CbamView = (typeof CBAM_VIEWS)[number]['id']

const DEFAULT_VIEW: CbamView = 'cases'

/**
 * Resolve a `?view=` parameter to a known view.
 *
 * An unknown value falls back to the default rather than erroring: a stale or
 * mistyped link should land somewhere useful, not on an error page. It is a
 * navigation hint, not an instruction.
 */
export function resolveCbamView(raw: string | undefined | null): CbamView {
  const match = CBAM_VIEWS.find(v => v.id === raw)
  return match ? match.id : DEFAULT_VIEW
}
