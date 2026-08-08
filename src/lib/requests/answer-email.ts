// Formats the answer email for an inbound data request. Layer 3 — presentation
// only. Sending is ALWAYS supplier-initiated (the approve-and-send endpoint);
// nothing here is called automatically on receipt of an email.
//
// "Presentation only" has to mean it. This used to sum every record for a field
// and label the total with the first record's unit, so 40,000 kWh and 12 MJ came
// out as "40,012 kWh" — a figure that was never true and that no downstream
// recipient could detect. Records are now grouped by unit and each unit is
// reported on its own line. Adding across units would be a calculation, and
// Arbor does not calculate (PRD §3).

export interface AnswerRecordValue {
  value: number
  unit: string
  trustTier: string
}

export interface FieldAnswerShape {
  fieldName: string
  records: AnswerRecordValue[]
}

export interface AnswerLine {
  /** Total of the records that share this unit. */
  total: number
  unit: string
  /** Plain English tier for the records behind this line. */
  tier: string
}

/** One line per unit, in first-seen order. A field whose records disagree on unit
 *  produces several lines rather than one wrong one. */
export function summariseFieldAnswer(records: AnswerRecordValue[]): AnswerLine[] {
  const byUnit = new Map<string, AnswerRecordValue[]>()
  for (const r of records) {
    const key = r.unit ?? ''
    const bucket = byUnit.get(key)
    if (bucket) bucket.push(r)
    else byUnit.set(key, [r])
  }

  return [...byUnit.entries()].map(([unit, group]) => ({
    total: group.reduce((s, r) => s + r.value, 0),
    unit,
    tier: worstTier(group.map(r => r.trustTier)),
  }))
}

/** The provenance sentence the email can honestly make, given what is in it.
 *  Only Tier A records are document-backed; Declared and Estimated are not, and
 *  claiming otherwise in an email to a buyer is a false provenance claim about
 *  the one thing Arbor sells. */
export function provenanceNote(answers: FieldAnswerShape[]): string {
  const tiers = new Set(answers.flatMap(a => a.records.map(r => r.trustTier)))
  if (tiers.size === 0) return ''
  if (tiers.size === 1 && tiers.has('A')) {
    return 'Every value above is Verified: extracted from a source document held in Arbor.'
  }
  return 'Values marked Verified are extracted from a source document held in Arbor. Declared values were entered by the supplier without a supporting document, and Estimated values use a published default. The label travels with the figure.'
}

export function buildAnswerHtml(entityName: string, answers: FieldAnswerShape[]): string {
  const rows = answers
    .flatMap(a => {
      const lines = summariseFieldAnswer(a.records)
      const label = escapeHtml(a.fieldName.replace(/_/g, ' '))
      if (lines.length === 0) {
        return [`<tr><td>${label}</td><td>—</td><td>—</td></tr>`]
      }
      return lines.map(
        line =>
          `<tr><td>${label}</td><td>${escapeHtml(line.total)} ${escapeHtml(line.unit)}</td><td>${escapeHtml(line.tier)}</td></tr>`,
      )
    })
    .join('')

  return `<p>${escapeHtml(entityName)} has answered your data request directly from their records in Arbor.</p>
<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Field</th><th>Value</th><th>Trust tier</th></tr></thead><tbody>${rows}</tbody></table>
<p>${escapeHtml(provenanceNote(answers))}</p>`
}

/** Worst (least-verified) tier across the contributing records, as its plain
 *  English label — the tier must travel with every disclosed value. */
export function worstTier(tiers: string[]): string {
  const rank: Record<string, number> = { A: 0, B: 1, C: 2 }
  const label: Record<string, string> = { A: 'Verified', B: 'Declared', C: 'Estimated' }
  if (tiers.length === 0) return ''
  const worst = tiers.reduce((w, t) => ((rank[t] ?? 0) > (rank[w] ?? 0) ? t : w), tiers[0])
  return label[worst] ?? worst
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
