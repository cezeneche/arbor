import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'
import { presentCase, summariseExposure } from '@/lib/nucleos/case-presenter'
import type { CbamCaseSummary } from '@/lib/nucleos/cases-client'

// The case list. Rows, not cards: a user comparing exposure across cases scans a
// column, and cards force them to hunt for the same figure in a different place
// each time.

export function CbamCaseList({ cases }: { cases: CbamCaseSummary[] }) {
  const rows = cases.map(presentCase)
  const exposure = summariseExposure(cases)

  if (rows.length === 0) {
    return (
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
        }}
      >
        No CBAM cases yet. They appear here when a customs declaration, supplier
        invoice or CBAM declaration is uploaded.
      </p>
    )
  }

  const cell = {
    padding: `${spacing[2]} ${spacing[2]}`,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    borderBottom: `1px solid ${colours.border}`,
    textAlign: 'left' as const,
  }
  const head = {
    ...cell,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textTertiary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
  }

  return (
    <div>
      <div style={{ marginBottom: spacing[4] }}>
        <div
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.textTertiary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            marginBottom: '4px',
          }}
        >
          Total exposure
        </div>
        <div
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.light,
            color: colours.textPrimary,
          }}
        >
          {exposure.total}
        </div>
        {exposure.note && (
          <div
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.amber,
              marginTop: '4px',
            }}
          >
            {exposure.note}
          </div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={head}>Importer</th>
            <th style={head}>Period</th>
            <th style={head}>Sector</th>
            <th style={head}>Origin</th>
            <th style={head}>Mass</th>
            <th style={head}>Exposure</th>
            <th style={head}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td style={cell}>
                <Link href={row.href} style={{ color: colours.navy, textDecoration: 'none' }}>
                  {row.importer}
                </Link>
              </td>
              <td style={cell}>{row.period}</td>
              <td style={cell}>{row.sector}</td>
              <td style={cell}>{row.origin}</td>
              <td style={cell}>{row.mass}</td>
              <td style={cell}>
                {row.exposure}
                {row.exposureNote && (
                  <div
                    style={{
                      fontSize: typography.sizes.xs,
                      color: colours.textTertiary,
                      fontWeight: typography.weights.light,
                    }}
                  >
                    {row.exposureNote}
                  </div>
                )}
              </td>
              <td style={cell}>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
