'use client'

import { useState } from 'react'
import Link from 'next/link'
import { colours, spacing, textStyles, typography } from '@/lib/design-system'
import { CbamResumeHandoff, type HandoffState } from './CbamResumeHandoff'

export interface UnfinishedHandoff {
  documentId: string
  fileName: string
  caseId: string | null
  status: string
  problems: string[]
}

// Confirmed documents whose case did not open, or opened with something
// missing. Kept on screen until each is finished: a case short a goods line
// looks exactly like a complete one everywhere else.

export function CbamUnfinishedHandoffs({ handoffs }: { handoffs: UnfinishedHandoff[] }) {
  const [rows, setRows] = useState(handoffs)
  if (rows.length === 0) return null

  const update = (documentId: string, next: HandoffState) =>
    setRows(current =>
      next.status === 'CREATED'
        ? current.filter(r => r.documentId !== documentId)
        : current.map(r => (r.documentId === documentId ? { ...r, ...next } : r)),
    )

  return (
    <div
      style={{
        border: `1px solid ${colours.border}`,
        borderLeft: `3px solid ${colours.amber}`,
        borderRadius: '6px',
        padding: spacing[3],
        marginBottom: spacing[4],
        backgroundColor: colours.amberBg,
      }}
    >
      <p style={textStyles.rowTitle}>
        {rows.length === 1 ? 'One case is not finished' : `${rows.length} cases are not finished`}
      </p>
      <p style={{ ...textStyles.caption, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
        The figures are saved. Resume adds only what is missing from the case.
      </p>
      {rows.map(row => (
        <div
          key={row.documentId}
          style={{ borderTop: `1px solid ${colours.border}`, marginTop: spacing[3], paddingTop: spacing[3] }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[3], alignItems: 'center' }}>
            <span style={textStyles.value}>
              {row.fileName}
              {row.status === 'PENDING' ? ' · not opened yet' : row.caseId ? ' · incomplete' : ' · not opened'}
            </span>
            <span style={{ display: 'inline-flex', gap: spacing[2], alignItems: 'center' }}>
              {row.caseId && (
                <Link
                  href={`/cbam/${encodeURIComponent(row.caseId)}`}
                  style={{
                    fontSize: typography.sizes.sm,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                  }}
                >
                  Open the case
                </Link>
              )}
              <CbamResumeHandoff documentId={row.documentId} onResult={next => update(row.documentId, next)} />
            </span>
          </div>
          {row.problems.length > 0 && (
            <ul
              style={{
                margin: `${spacing[2]} 0 0`,
                paddingLeft: '18px',
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
                lineHeight: '1.6',
              }}
            >
              {row.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
