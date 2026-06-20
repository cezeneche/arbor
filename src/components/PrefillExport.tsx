'use client'

import { colours, typography } from '@/lib/design-system'
import type { PrefilledAnswer } from '@/lib/questionnaires/types'

const TIER_LABEL: Record<string, string> = { A: 'Verified', B: 'Declared', C: 'Estimated' }

function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(answers: PrefilledAnswer[]): string {
  const header = ['question', 'answer', 'unit', 'trust_tier', 'status', 'contributing_records', 'source_record_ids']
  const rows = answers.map((a) =>
    [
      a.questionText,
      a.value ?? '',
      a.unit ?? '',
      a.trustTier ? TIER_LABEL[a.trustTier] : '',
      a.status,
      a.contributingCount,
      a.sourceRecordIds.join(' '),
    ]
      .map(csvEscape)
      .join(','),
  )
  return [header.join(','), ...rows].join('\r\n')
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function PrefillExport({ templateId, answers }: { templateId: string; answers: PrefilledAnswer[] }) {
  const btn = {
    padding: '10px 20px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <button
        type="button"
        style={btn}
        onClick={() => download(`${templateId}-prefill.csv`, buildCsv(answers), 'text/csv')}
      >
        Download CSV
      </button>
      <button
        type="button"
        style={btn}
        onClick={() =>
          download(`${templateId}-prefill.json`, JSON.stringify(answers, null, 2), 'application/json')
        }
      >
        Download JSON
      </button>
    </div>
  )
}
