// Relearning extractor — correction exemplars (pure; no DB, no AI).
//
// The system relearns from a tenant's OWN past review corrections: which fields
// on this document type it has historically got wrong, so the extraction prompt
// can tell the model to read those fields with extra care. This is how a closed
// model "learns" from customer feedback without fine-tuning.
//
// Deliberate safety choice for a certified-data product: hints carry NO past
// values into the prompt. A value that was correct on last quarter's document is
// usually wrong on this one; injecting it risks the model copying a stale value
// into a new record — a wrong certified fact, the cardinal sin here. So a hint
// names the error-prone field and the KIND of error (mis-read vs over-extracted)
// and its frequency — attention, never answers.

export interface CorrectionLabel {
  fieldName: string
  /** What the model extracted (null if it found nothing). */
  extractedValue: string | null
  /** What review settled on (null if the reviewer removed the value). */
  confirmedValue: string | null
}

export interface ExemplarHint {
  fieldName: string
  timesCorrected: number
  /** Corrections where the reviewer supplied a different value — the model read the wrong thing. */
  misreadCount: number
  /** Corrections where the reviewer cleared the value — the model reported something that was not there. */
  clearedCount: number
}

/** Keep the prompt bounded — only the most error-prone fields are worth flagging. */
export const MAX_EXEMPLAR_FIELDS = 5

/** Aggregate a tenant's past corrections into ranked per-field attention hints. */
export function buildExemplarHints(
  labels: CorrectionLabel[],
  opts: { maxFields?: number } = {},
): ExemplarHint[] {
  const maxFields = opts.maxFields ?? MAX_EXEMPLAR_FIELDS
  const byField = new Map<string, { misread: number; cleared: number }>()

  for (const l of labels) {
    // No signal if the model found nothing and nothing was expected.
    if (l.extractedValue === null && l.confirmedValue === null) continue
    const agg = byField.get(l.fieldName) ?? { misread: 0, cleared: 0 }
    if (l.confirmedValue === null) agg.cleared += 1
    else agg.misread += 1
    byField.set(l.fieldName, agg)
  }

  return [...byField.entries()]
    .map(([fieldName, { misread, cleared }]) => ({
      fieldName,
      timesCorrected: misread + cleared,
      misreadCount: misread,
      clearedCount: cleared,
    }))
    .sort((a, b) => b.timesCorrected - a.timesCorrected || a.fieldName.localeCompare(b.fieldName))
    .slice(0, maxFields)
}

/** Render the hints into a bounded prompt section. Empty string when there are
 *  no hints, so the prompt is byte-for-byte unchanged when there is nothing to say. */
export function renderCorrectionHints(hints: ExemplarHint[]): string {
  if (hints.length === 0) return ''
  const lines = hints.map((h) => {
    const guidance =
      h.misreadCount >= h.clearedCount
        ? `mis-read ${h.timesCorrected} time(s) in past reviews — double-check its value against the document`
        : `reported ${h.timesCorrected} time(s) when the reviewer found no such value — only include it if it is clearly present`
    return `- ${h.fieldName}: ${guidance}`
  })
  return `
Attention: on past documents of this type from this company, reviewers corrected the following fields. Read them with extra care. Do NOT reuse any past value — every document is different; extract only what THIS document says:
${lines.join('\n')}
`
}
