'use client'

import { useState } from 'react'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import type { CbamCaseSummary } from '@/lib/nucleos/cases-client'

// Pick a case, and the work for it opens beneath the row.
//
// Inline rather than a dialog, because the design rules forbid modals and
// because the row stays visible — a user filling in emissions figures needs the
// consignment they belong to still on screen.
//
// One open at a time. Two open forms invite entering a figure against the wrong
// case, and nothing downstream would catch it.

export function CbamCasePicker({
  cases,
  emptyMessage,
  children,
}: {
  cases: CbamCaseSummary[]
  emptyMessage: string
  children: (c: CbamCaseSummary) => React.ReactNode
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (cases.length === 0) {
    return (
      <p
        style={{
          ...textStyles.sectionSubtitle,
          margin: 0,
        }}
      >
        {emptyMessage}
      </p>
    )
  }

  return (
    <div>
      {cases.map(c => {
        const open = openId === c.id
        const period =
          c.reporting_year && c.reporting_quarter
            ? `${c.reporting_year} Q${c.reporting_quarter}`
            : c.reporting_year
              ? String(c.reporting_year)
              : 'Period not set'

        return (
          <div key={c.id} style={{ borderTop: `1px solid ${colours.border}` }}>
            <button
              onClick={() => setOpenId(open ? null : c.id)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: spacing[3],
                padding: `${spacing[3]} 0`,
                background: 'none',
                border: 'none',
                borderLeft: open ? `3px solid ${colours.navy}` : '3px solid transparent',
                paddingLeft: spacing[3],
                textAlign: 'left',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span>
                <span
                  style={{
                    display: 'block',
                    fontSize: typography.sizes.sm,
                    fontWeight: open ? typography.weights.medium : typography.weights.light,
                    color: open ? colours.navy : colours.textPrimary,
                  }}
                >
                  {c.importer_name ?? 'Unnamed importer'}
                </span>
                <span
                  style={{
                    display: 'block',
                    ...textStyles.caption,
          color: colours.textTertiary,
                    marginTop: '2px',
                  }}
                >
                  {period}
                  {c.origin_country ? ` · from ${c.origin_country}` : ''}
                  {c.sector ? ` · ${c.sector.replace(/_/g, ' ')}` : ''}
                </span>
              </span>
              <span
                style={{
                  ...textStyles.caption,
                  whiteSpace: 'nowrap',
                }}
              >
                {open ? 'Close' : 'Open'}
              </span>
            </button>

            {open && <div style={{ paddingLeft: spacing[3] }}>{children(c)}</div>}
          </div>
        )
      })}
    </div>
  )
}
