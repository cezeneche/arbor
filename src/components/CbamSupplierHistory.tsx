'use client'

import { useEffect, useState } from 'react'
import { colours, spacing, typography, textStyles } from '@/lib/design-system'
import type { PresentedSupplierHistory } from '@/lib/nucleos/supplier-history-presenter'

// How a goods line's emissions figure compares with the same installation's
// earlier figures for the same goods. The verdict shows without a click, since a
// figure far from the supplier's usual one is worth seeing before relying on it;
// the earlier figures open inline.

const link = {
  padding: 0,
  marginTop: spacing[1],
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.light,
  color: colours.navy,
  background: 'none',
  border: 'none',
  textDecoration: 'underline',
  cursor: 'pointer',
} as const

export function CbamSupplierHistory({ caseId, goodsLineId }: { caseId: string; goodsLineId: string }) {
  const [history, setHistory] = useState<PresentedSupplierHistory | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/cbam/cases/${encodeURIComponent(caseId)}/goods-lines/${encodeURIComponent(goodsLineId)}/supplier-history`,
    )
      .then(async res => {
        if (cancelled) return
        if (!res.ok) {
          setFailed(true)
          return
        }
        setHistory((await res.json()) as PresentedSupplierHistory)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [caseId, goodsLineId])

  if (failed) {
    return (
      <p style={{ ...textStyles.caption, color: colours.textTertiary, margin: `${spacing[1]} 0 0` }}>
        Supplier history could not be loaded just now.
      </p>
    )
  }
  if (!history) return null

  return (
    <div style={{ maxWidth: '320px' }}>
      <p
        style={{
          ...textStyles.caption,
          color: history.flagged ? colours.amber : colours.textTertiary,
          margin: `${spacing[1]} 0 0`,
        }}
      >
        {history.verdict}
      </p>
      {history.rows.length > 0 && (
        <button type="button" style={link} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide earlier figures' : `Earlier figures (${history.rows.length})`}
        </button>
      )}
      {open && (
        <table style={{ borderCollapse: 'collapse', marginTop: spacing[1] }}>
          <tbody>
            {history.rows.map((row, i) => (
              <tr key={i}>
                <td style={{ ...textStyles.caption, color: colours.textTertiary, paddingRight: spacing[2] }}>
                  {row.period}
                </td>
                <td style={{ ...textStyles.caption, color: colours.textPrimary, paddingRight: spacing[2] }}>
                  {row.value}
                </td>
                <td style={{ ...textStyles.caption, color: colours.textTertiary }}>{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
