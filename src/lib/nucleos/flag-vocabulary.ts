// Making Nucleos's flag strings readable without losing them.
//
// The flags are the anti-hallucination signal a reviewer acts on:
// `arbiter_conflict:*` says two extractors disagreed and which,
// `repair_failed:*` says a gap could not be filled, `claude_value_not_evidenced
// _in_text` says the model produced a value that is not in the document.
//
// The contract carries them verbatim and this does not change that. It adds a
// plain-English sentence in front of the raw string — it never replaces it.
// Summarising in transit would leave the reviewer with "there was an issue";
// showing only the raw token would leave them decoding `repair_failed:incoterm`.
// Both are shown, in that order.
//
// An unrecognised flag still displays. A vocabulary that silently drops what it
// does not know would hide precisely the novel signal worth reading.

export interface ExplainedFlag {
  /** The original string, always preserved. */
  raw: string
  /** Plain English, or null when the token is not one we recognise. */
  explanation: string | null
  /** True when this flag should stop a reviewer rather than inform them. */
  serious: boolean
}

type Rule = {
  match: RegExp
  explain: (detail: string) => string
  serious: boolean
}

const RULES: Rule[] = [
  {
    match: /^arbiter_conflict:(.*)$/,
    explain: d => `Two extractors disagreed about ${d || 'this field'}. The arbiter chose one.`,
    serious: true,
  },
  {
    match: /^repair_failed:(.*)$/,
    explain: d => `${d || 'A field'} was missing and could not be recovered from the document.`,
    serious: false,
  },
  {
    match: /^parser_failed:([^:]*)/,
    explain: d => `The ${d || 'specialist'} parser failed on this document. Other extraction still ran.`,
    serious: true,
  },
  {
    match: /^claude_value_not_evidenced_in_text/,
    explain: () =>
      'The model produced a value that does not appear in the document text. It was rejected.',
    serious: true,
  },
  {
    match: /^claude_value_failed_validation/,
    explain: () => 'The model produced a value that failed field validation. It was rejected.',
    serious: true,
  },
  {
    match: /^claude_conflict_ignored/,
    explain: () =>
      'The model disagreed with a value read directly from the document. The document won.',
    serious: false,
  },
  {
    match: /^claude_line_added_beyond_deterministic/,
    explain: () =>
      'A goods line was found that the deterministic pass missed. Check it belongs on this document.',
    serious: true,
  },
  {
    match: /^claude_line_same_cn_different_mass/,
    explain: () =>
      'Two readings of the same product with different masses — either a second consignment or a disagreement.',
    serious: true,
  },
  {
    match: /^line_count_disagreement/,
    explain: () =>
      'The two extractors read a different number of goods lines from this document.',
    serious: true,
  },
  {
    match: /^claude_line_(?:missing|invalid)_cn_code/,
    explain: () => 'A goods line had no usable CN code and was not added.',
    serious: false,
  },
  {
    match: /^claude_line_(?:invalid|.*not_evidenced)_mass/,
    explain: () => 'A goods line had no usable mass and was not added.',
    serious: false,
  },
  {
    match: /^source_truncated:(.*)$/,
    explain: d =>
      `Only part of this document was read: ${d || 'reason not recorded'}. Anything confirmed covers only the part that was read.`,
    serious: true,
  },
  {
    match: /^cbam_selector:markup_not_applied:(.*)$/,
    explain: d =>
      `The legislated default-value mark-up was not applied (${d}). The figure understates the declarable amount.`,
    serious: true,
  },
  {
    match: /^no_source_text/,
    explain: () =>
      'No source text came with this value, so there is nothing to confirm it against.',
    serious: true,
  },
  {
    match: /^confidence_below_threshold:(.*)$/,
    explain: d => `Extraction confidence ${d} is below the review threshold.`,
    serious: false,
  },
]

export function explainFlag(raw: string): ExplainedFlag {
  const token = (raw ?? '').trim()
  for (const rule of RULES) {
    const m = token.match(rule.match)
    if (m) {
      return { raw: token, explanation: rule.explain((m[1] ?? '').trim()), serious: rule.serious }
    }
  }
  return { raw: token, explanation: null, serious: false }
}

/**
 * Explain a `flagReason` field, which may hold several flags joined by `; `.
 *
 * Serious flags sort first — a reviewer scanning a card stops at the first line,
 * so the one that should stop them has to be there.
 */
export function explainFlagReason(flagReason: string | null | undefined): ExplainedFlag[] {
  if (!flagReason?.trim()) return []
  const explained = flagReason
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(explainFlag)

  return [...explained].sort((a, b) => Number(b.serious) - Number(a.serious))
}
