// Which scope-check reasons are worth showing, and what the answer is.
//
// The scope check asks two things: a commodity code, and optionally a tonnage.
// Nucleos evaluates more than that — origin, importer EORI — and reports when
// it could not, which is correct for an API and wrong on a screen
// that never asked. "Importer EORI not provided" reads as a reproach for not
// answering a question that was never put to the user.
//
// Only reasons of the form "an input you were never asked for was absent" are
// dropped. Anything reporting a finding — an invalid EORI, an origin exclusion,
// a code not covered — always survives, because those are the answer.

/** Reasons that only report the absence of an input this screen does not collect. */
const NOT_ASKED = [/^eori:missing/, /^origin:missing/, /^origin:not_provided/]

/** The de minimis threshold, which scopeThresholdNotes states in the importer's own regime. */
const SHOWN_AS_A_NOTE = [/^de_minimis:/]

export function relevantScopeReasons(reasons: string[]): string[] {
  return (reasons ?? []).filter(
    reason => ![...NOT_ASKED, ...SHOWN_AS_A_NOTE].some(pattern => pattern.test(reason.trim())),
  )
}

type ScopeStatus = 'in_scope' | 'out_of_scope' | 'requires_review'

/**
 * The answer this screen gives. Nucleos says "requires_review" whenever origin
 * or EORI is missing, and this screen sends neither, so on its own that would
 * be the answer to every covered code. When the only open questions are ones
 * nobody was asked, the code is in scope, and the screen says separately that
 * origin was not applied. A review is kept when Nucleos found something.
 *
 * Nucleos checks the EU's list of goods, which includes electricity. The UK
 * does not cover electricity, so for an organisation filing in the UK only it
 * is out of scope.
 */
export function scopeAnswer(
  status: ScopeStatus,
  reasons: string[],
  regime?: { sector: string | null; jurisdiction: 'UK' | 'EU' | 'BOTH' },
): ScopeStatus {
  if (regime?.jurisdiction === 'UK' && regime.sector === 'electricity') return 'out_of_scope'
  if (status !== 'requires_review') return status
  const findings = relevantScopeReasons(reasons).filter(reason => !/^annex_i:covered/.test(reason.trim()))
  return findings.length === 0 ? 'in_scope' : 'requires_review'
}
