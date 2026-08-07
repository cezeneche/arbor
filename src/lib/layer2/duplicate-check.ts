// Layer 2 — Storage. Pure, read-only: decides nothing, writes nothing. Given
// what a confirm is about to write and what is already stored, it says what
// would be duplicated so the user can be asked.
//
// The write path supersedes on an exact match of entity, domain, field and both
// period boundaries. That match is brittle: a domain that drifts between write
// and catalogue, or a period boundary off by a day, is enough to miss — which
// is how production ended up holding two active records for the same customs
// declaration, same field, same value, same period, different documents,
// neither superseding the other. Any total over that field double-counts.
//
// This match is deliberately looser than the one that supersedes: same field,
// overlapping period, whatever the domain says. Being loose is safe precisely
// because the outcome is a question rather than a decision.

export interface CandidateField {
  fieldName: string
  domain: string
  periodStart: Date
  periodEnd: Date
}

export interface PriorRecord {
  id: string
  fieldName: string
  domain: string
  value: number
  unit: string
  periodStart: Date
  periodEnd: Date
}

export interface DuplicateMatch {
  fieldName: string
  priorIds: string[]
  /** Quotable in the prompt, e.g. "24,500 kg for Jul 2025 – Jul 2026". */
  priorSummary: string
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart <= bEnd && aEnd >= bStart

const monthYear = (d: Date) =>
  d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

export function findDuplicates(
  candidates: CandidateField[],
  priors: PriorRecord[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = []

  for (const candidate of candidates) {
    const hits = priors.filter(
      p =>
        p.fieldName === candidate.fieldName &&
        overlaps(p.periodStart, p.periodEnd, candidate.periodStart, candidate.periodEnd),
    )
    if (hits.length === 0) continue

    const [first] = hits
    const extra = hits.length > 1 ? ` and ${hits.length - 1} more` : ''
    matches.push({
      fieldName: candidate.fieldName,
      priorIds: hits.map(h => h.id),
      priorSummary: `${first.value.toLocaleString('en-GB')} ${first.unit} for ${monthYear(first.periodStart)} – ${monthYear(first.periodEnd)}${extra}`,
    })
  }

  return matches
}
