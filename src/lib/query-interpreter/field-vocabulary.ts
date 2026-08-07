// The set of field names an entity actually holds, and the guard that keeps the
// parser inside it. Pure — no DB, no AI. The caller reads the vocabulary from
// Layer 3 and passes it in.
//
// Without this the parser guesses: asked "how much electricity did we use?" it
// answers `electricity_consumption`, the store holds `total_consumption_kwh`,
// the query filters on exact equality, and the user sees nothing. Showing the
// model the real field list fixes most of that; dropping anything it invents
// anyway fixes the rest, by widening the query to the domain instead of
// narrowing it to a field that cannot exist.

export interface VocabularyEntry {
  domain: string
  fieldName: string
  unit: string
}

/** Loose key so "Declared Weight" and "declared_weight" collapse to one thing. */
function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * The stored spelling of `candidate`, or undefined when the store has no such
 * field. Undefined means "do not filter by field" — never "return nothing".
 */
export function resolveFieldName(
  candidate: string | null | undefined,
  vocabulary: VocabularyEntry[],
): string | undefined {
  if (!candidate?.trim()) return undefined
  const wanted = normalise(candidate)
  return vocabulary.find(entry => normalise(entry.fieldName) === wanted)?.fieldName
}

/** The prompt fragment listing what the entity actually has. */
export function describeVocabulary(vocabulary: VocabularyEntry[]): string {
  if (vocabulary.length === 0) {
    return 'This company has no records stored yet, so there are no field names to choose from. Always return null for fieldName.'
  }

  // One line per field even when the same field is stored under several units.
  const seen = new Map<string, VocabularyEntry>()
  for (const entry of vocabulary) {
    if (!seen.has(entry.fieldName)) seen.set(entry.fieldName, entry)
  }

  const lines = [...seen.values()]
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.fieldName.localeCompare(b.fieldName))
    .map(e => `- ${e.fieldName} (${e.domain}, stored in ${e.unit})`)

  return [
    'FIELDS THIS COMPANY ACTUALLY HAS. These are the only field names that exist in the store:',
    ...lines,
    'Set fieldName to one of the names above only when the question clearly points at that exact field. If the question is broader, or names something not in this list, return null for fieldName and rely on the domain instead. Never invent a field name.',
  ].join('\n')
}
