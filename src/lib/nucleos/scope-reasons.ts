// Which scope-check reasons are worth showing.
//
// The scope check asks two things: a commodity code, and optionally a tonnage.
// Nucleos evaluates more than that — de minimis value, importer EORI — and
// reports when it could not, which is correct for an API and wrong on a screen
// that never asked. "Importer EORI not provided" reads as a reproach for not
// answering a question that was never put to the user.
//
// Only reasons of the form "an input you were never asked for was absent" are
// dropped. Anything reporting a finding — an invalid EORI, an origin exclusion,
// a code not covered — always survives, because those are the answer.

/** Reasons that only report the absence of an input this screen does not collect. */
const NOT_ASKED = [
  /^de_minimis:value_not_provided/,
  /^eori:missing/,
  /^origin:not_provided/,
  /^consignment_value:not_provided/,
]

export function relevantScopeReasons(reasons: string[]): string[] {
  return (reasons ?? []).filter(reason => !NOT_ASKED.some(pattern => pattern.test(reason.trim())))
}
