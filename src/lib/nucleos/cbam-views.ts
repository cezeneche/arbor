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
    id: 'scope',
    label: 'Scope check',
    description:
      'Whether a commodity code is covered by CBAM, before any document or commitment.',
  },
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
    id: 'request',
    label: 'Request data',
    description:
      'Ask a supplier for the emissions intensity a goods line is missing — a tokenised form they can fill in without an account — or apply the published default value instead.',
  },
] as const

export type CbamView = (typeof CBAM_VIEWS)[number]['id']

// The section opens on the scope check. It answers the question a user actually
// arrives with — does this apply to me? — in seconds, with no document and
// nothing at stake if the answer is no. Opening on Cases shows an empty table to
// everyone who has not started yet, which answers nothing.
const DEFAULT_VIEW: CbamView = 'scope'

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
