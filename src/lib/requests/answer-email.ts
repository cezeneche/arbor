// Formats the answer email for an inbound data request. Layer 3 — presentation
// only. Sending is ALWAYS supplier-initiated (the approve-and-send endpoint);
// nothing here is called automatically on receipt of an email.

export interface AnswerRecordValue {
  value: number
  unit: string
  trustTier: string
}

export interface FieldAnswerShape {
  fieldName: string
  records: AnswerRecordValue[]
}

export function buildAnswerHtml(entityName: string, answers: FieldAnswerShape[]): string {
  const rows = answers
    .map((a) => {
      const total = a.records.reduce((s, r) => s + r.value, 0)
      const unit = a.records[0]?.unit ?? ''
      const tier = worstTier(a.records.map((r) => r.trustTier))
      return `<tr><td>${escapeHtml(a.fieldName.replace(/_/g, ' '))}</td><td>${escapeHtml(total)} ${escapeHtml(unit)}</td><td>${escapeHtml(tier)}</td></tr>`
    })
    .join('')
  return `<p>${escapeHtml(entityName)} has answered your data request directly from their certified records.</p>
<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Field</th><th>Value</th><th>Trust tier</th></tr></thead><tbody>${rows}</tbody></table>
<p>Every value above is backed by source documents in Arbor.</p>`
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
