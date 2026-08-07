// Layer 3 — Access. Pure, read-only. The one-click questions offered above the
// query box.
//
// Suggestions are built from what the entity actually holds. A suggested
// question that returns nothing is worse than no suggestion at all: the user
// clicks the thing the product offered them, gets an empty table, and concludes
// the feature does not work.

import { DOMAIN_LABELS } from '@/lib/domain-labels'

const MAX_SUGGESTIONS = 3

// Shown before any record exists. Deliberately free of years and domains, so
// nothing here can promise data the entity does not have.
const STARTERS = [
  'What records do we have?',
  'Which of our records still need a document?',
]

export function buildQuerySuggestions(opts: {
  domains: string[]
  latestYear: number | null
}): string[] {
  const { domains, latestYear } = opts
  if (domains.length === 0 || latestYear === null) return STARTERS

  const suggestions: string[] = []
  for (const domain of domains) {
    const label = (DOMAIN_LABELS[domain] ?? domain).toLowerCase()
    suggestions.push(`Show me our ${label} records for ${latestYear}`)
    if (suggestions.length === MAX_SUGGESTIONS - 1) break
  }

  // One question that always matches something, whatever the store holds.
  suggestions.push(`What did we record in ${latestYear}?`)

  return suggestions.slice(0, MAX_SUGGESTIONS)
}
