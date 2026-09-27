'use client'

import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'

// The answer to a gap question: which areas have no records, for the caller
// and for each supplier within what that supplier has shared.

export interface QueryGapResultData {
  ownMissingDomains: string[]
  supplierGaps: Array<{ supplierEntityId: string; supplierName: string; missingDomains: string[] }>
}

export function QueryGapResult({ gapResult }: { gapResult: QueryGapResultData }) {
  const hasOwnGaps = gapResult.ownMissingDomains.length > 0
  const hasSupplierGaps = gapResult.supplierGaps.length > 0

  if (!hasOwnGaps && !hasSupplierGaps) {
    return (
      <div
        style={{
          padding: spacing[3],
          backgroundColor: colours.greenBg,
          border: `1px solid ${colours.green}22`,
          borderRadius: '8px',
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.green,
        }}
      >
        No gaps: every area asked about has records.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
      {hasOwnGaps && (
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
            padding: spacing[3],
          }}
        >
          <p
            style={{ ...textStyles.rowTitle, margin: '0 0 10px' }}
          >
            Areas where you have no records
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {gapResult.ownMissingDomains.map(d => (
              <span
                key={d}
                style={{
                  padding: '3px 10px',
                  backgroundColor: colours.amberBg,
                  borderRadius: '4px',
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.amber,
                }}
              >
                {DOMAIN_LABELS[d] ?? d}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasSupplierGaps && (
        <div
          style={{
            backgroundColor: colours.surface,
            border: `1px solid ${colours.border}`,
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background }}>
                {['Supplier', 'Areas with nothing shared'].map(col => (
                  <th
                    key={col}
                    style={{
                      padding: '10px 16px',
                      fontSize: typography.sizes.xs,
                      fontWeight: typography.weights.medium,
                      color: colours.textSecondary,
                      letterSpacing: typography.tracking.wider,
                      textTransform: 'uppercase',
                      textAlign: 'left',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gapResult.supplierGaps.map((gap, i) => (
                <tr
                  key={gap.supplierEntityId}
                  style={{ borderBottom: i < gapResult.supplierGaps.length - 1 ? `1px solid ${colours.border}` : 'none' }}
                >
                  <td
                    style={{
                      padding: '12px 16px',
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.light,
                      color: colours.textPrimary,
                    }}
                  >
                    {gap.supplierName}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {gap.missingDomains.map(d => (
                        <span
                          key={d}
                          style={{
                            padding: '2px 8px',
                            backgroundColor: colours.amberBg,
                            borderRadius: '4px',
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.light,
                            color: colours.amber,
                          }}
                        >
                          {DOMAIN_LABELS[d] ?? d}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
