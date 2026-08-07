// Layer 3 — Access. Pure, read-only. What a stored field is called when a
// person reads it.
//
// Every table used to render the database identifier with its underscores
// stripped, which produced "total consumption kwh" above a value of 172.8 mj.
// The identifier is a legacy name that embeds a unit the record is not stored
// in, so it read as a contradiction wherever it appeared. The catalogue already
// carries a plain English label, a definition and a boundary for every field —
// this resolves them, and is the single place that decides.

import { SEED_DEFINITIONS } from '@/lib/definitions/catalogue'

/** Readable form of a raw identifier, for fields the catalogue does not know. */
function prettify(fieldName: string): string {
  const words = fieldName.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const byName = (() => {
  const index = new Map<string, typeof SEED_DEFINITIONS>()
  for (const entry of SEED_DEFINITIONS) {
    index.set(entry.fieldName, [...(index.get(entry.fieldName) ?? []), entry])
  }
  return index
})()

function lookup(fieldName: string, domain?: string | null) {
  const candidates = byName.get(fieldName)
  if (!candidates || candidates.length === 0) return null

  const exact = domain ? candidates.find(c => c.domain === domain) : undefined
  if (exact) return exact

  // A record's domain and its catalogue entry can disagree — declared_weight is
  // stored under Logistics but catalogued under Compliance, because the customs
  // declaration it comes from is filed as one and read as the other. Where the
  // name means exactly one thing, use it rather than falling back to the raw
  // identifier the reader cannot parse.
  return candidates.length === 1 ? candidates[0] : null
}

/** The plain English name. Falls back to the readable identifier. */
export function fieldLabel(fieldName: string, domain?: string | null): string {
  return lookup(fieldName, domain)?.label ?? prettify(fieldName)
}

/** What the figure counts and what it leaves out — for a tooltip, not a table cell. */
export function fieldMeaning(fieldName: string, domain?: string | null): string | null {
  const entry = lookup(fieldName, domain)
  if (!entry) return null
  return `${entry.definition}\n\n${entry.boundary}`
}
