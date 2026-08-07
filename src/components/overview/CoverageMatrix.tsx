import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'
import type { CoverageRow, CoverageCellState } from '@/lib/layer3/coverage-matrix'

// §6. The centrepiece: record types against the last eight periods.
//
// States are separated by fill density and border weight, not hue, so the
// matrix survives greyscale printing and colour blindness. Red carries exactly
// one meaning — missing — and appears nowhere else in the grid.
//
// Squares rather than a table: at eight periods and twenty row types the eye
// has to travel from a label on the left to a cell on the right, and a bordered
// table makes that harder, not easier.

const CELL = 14

const CELL_STYLE: Record<CoverageCellState, React.CSSProperties> = {
  // Solid fill — the strongest reading.
  verified: { backgroundColor: colours.navy, border: `1px solid ${colours.navy}` },
  // Outline, heavier border, no fill.
  declared: { backgroundColor: 'transparent', border: `1.5px solid ${colours.navy}` },
  // Light fill, no border.
  estimated: { backgroundColor: `${colours.navy}26`, border: '1px solid transparent' },
  // The only red on the grid.
  missing: { backgroundColor: 'transparent', border: `0.5px solid ${colours.red}` },
  // Dashed hairline: not owed, so not a gap.
  out_of_scope: { backgroundColor: 'transparent', border: `0.5px dashed ${colours.border}` },
}

const STATE_WORD: Record<CoverageCellState, string> = {
  verified: 'Verified',
  declared: 'Declared',
  estimated: 'Estimated',
  missing: 'Missing',
  out_of_scope: 'Before you joined',
}

const headerCell = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.light,
  color: colours.textTertiary,
  letterSpacing: typography.tracking.wide,
  padding: '0 0 8px',
  textAlign: 'center' as const,
  whiteSpace: 'nowrap' as const,
  fontVariantNumeric: 'tabular-nums' as const,
}

export function CoverageMatrix({ rows, summary }: { rows: CoverageRow[]; summary: string }) {
  if (rows.length === 0) return null
  const periods = rows[0].cells.map(c => c.period)

  return (
    <section style={{ marginBottom: spacing[5] }}>
      <span
        style={{
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
          color: colours.textTertiary,
          letterSpacing: typography.tracking.wider,
          textTransform: 'uppercase',
          display: 'block',
          marginBottom: spacing[1],
        }}
      >
        Coverage
      </span>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `0 0 ${spacing[3]}`,
        }}
      >
        {summary}
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `0.5px solid ${colours.border}` }}>
            <th style={{ ...headerCell, textAlign: 'left' }}>Record type</th>
            {periods.map(p => (
              <th key={p.label} style={headerCell}>{p.label}</th>
            ))}
            <th style={{ ...headerCell, textAlign: 'right' }}>Last recorded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.domain}>
              <td
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textPrimary,
                  padding: '9px 0',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.label}
              </td>
              {row.cells.map(cell => (
                <td key={cell.period.label} style={{ padding: '9px 0', textAlign: 'center' }}>
                  <Link
                    href={`/records?domain=${row.domain}`}
                    aria-label={`${row.label}, ${cell.period.label}, ${STATE_WORD[cell.state]}`}
                    title={[
                      row.label,
                      cell.period.label,
                      STATE_WORD[cell.state],
                      cell.sourceDocument,
                    ].filter(Boolean).join(' · ')}
                    style={{
                      display: 'inline-block',
                      width: `${CELL}px`,
                      height: `${CELL}px`,
                      borderRadius: '2px',
                      ...CELL_STYLE[cell.state],
                    }}
                  />
                </td>
              ))}
              <td
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textTertiary,
                  padding: '9px 0',
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {row.lastRecorded ?? 'Never'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Density and border weight are what separate the states; the key says so. */}
      <div style={{ display: 'flex', gap: spacing[3], flexWrap: 'wrap', marginTop: spacing[2] }}>
        {(['verified', 'declared', 'estimated', 'missing', 'out_of_scope'] as const).map(state => (
          <span
            key={state}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '2px',
                ...CELL_STYLE[state],
              }}
            />
            {STATE_WORD[state]}
          </span>
        ))}
      </div>
    </section>
  )
}
