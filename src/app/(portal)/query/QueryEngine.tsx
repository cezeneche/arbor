'use client'

import { useState } from 'react'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import { colours, typography, spacing, trustTierConfig } from '@/lib/design-system'
import { TierBadge } from '@/components/TierBadge'

type NlRecord = {
  id: string
  entityName: string
  domain: string
  fieldName: string
  value: number
  unit: string
  periodStart: string
  periodEnd: string
  trustTier: 'A' | 'B' | 'C'
  confidenceScore: number | null
  sourceText: string | null
}

type GapResult = {
  ownMissingDomains: string[]
  supplierGaps: Array<{ supplierEntityId: string; supplierName: string; missingDomains: string[] }>
}

type QueryResult = {
  interpretation: string
  isCalculation: boolean
  calculationNote?: string
  queryType: string
  summary: string
  recordCount: number
  hasMore: boolean
  tierDistribution: { A: number; B: number; C: number }
  records: NlRecord[]
  gapResult?: GapResult
}

const EXAMPLE_QUESTIONS = [
  'What energy records do we have for last year?',
  'Show me all production records from Q1 2026',
  'How has our electricity consumption changed over time?',
  'Show me all Verified energy records',
  'What logistics data do we have from Q3 2025?',
]

export function QueryEngine() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(q?: string) {
    const query = q ?? question
    if (!query.trim()) return
    if (q) setQuestion(q)

    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/query/nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong. Please try again.')
        return
      }
      setResult(json.data)
    } catch {
      setError('Could not connect to the query engine. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const hasResults = result && result.recordCount > 0
  const isGap = result?.queryType === 'gap'

  return (
    <div>
      {/* Question input */}
      <div
        style={{
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '8px',
          padding: spacing[3],
          marginBottom: spacing[3],
        }}
      >
        <label
          htmlFor="query-input"
          style={{
            display: 'block',
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.medium,
            color: colours.textTertiary,
            letterSpacing: typography.tracking.wider,
            textTransform: 'uppercase',
            marginBottom: '10px',
          }}
        >
          Ask a question about your data
        </label>
        <div style={{ display: 'flex', gap: spacing[1] }}>
          <input
            id="query-input"
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleSubmit()}
            placeholder="e.g. What energy records do we have for Q1 2026?"
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 14px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              backgroundColor: colours.background,
              border: `1px solid ${colours.border}`,
              borderRadius: '4px',
              outline: 'none',
              fontFamily: typography.fontFamily,
            }}
          />
          <button
            onClick={() => handleSubmit()}
            disabled={loading || !question.trim()}
            style={{
              padding: '10px 20px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: loading || !question.trim() ? colours.textTertiary : colours.navy,
              border: 'none',
              borderRadius: '4px',
              cursor: loading || !question.trim() ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: typography.fontFamily,
            }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Example questions */}
        {!result && !loading && (
          <div style={{ marginTop: spacing[2] }}>
            <p
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: '0 0 8px',
              }}
            >
              Try asking:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {EXAMPLE_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => handleSubmit(q)}
                  style={{
                    padding: '4px 10px',
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.light,
                    color: colours.textSecondary,
                    backgroundColor: 'transparent',
                    border: `1px solid ${colours.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontFamily: typography.fontFamily,
                    textAlign: 'left',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: spacing[2],
            backgroundColor: colours.redBg,
            border: `1px solid ${colours.red}22`,
            borderRadius: '6px',
            marginBottom: spacing[3],
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.red,
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Interpretation + summary */}
          <div style={{ marginBottom: spacing[3] }}>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                margin: '0 0 6px',
              }}
            >
              <span style={{ fontWeight: typography.weights.medium, color: colours.textPrimary }}>
                {result.summary}
              </span>
            </p>
            <p
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                margin: 0,
              }}
            >
              Interpreted as: {result.interpretation}
            </p>
          </div>

          {/* Calculation note */}
          {result.isCalculation && result.calculationNote && (
            <div
              style={{
                padding: spacing[2],
                backgroundColor: colours.amberBg,
                border: `1px solid ${colours.amber}22`,
                borderRadius: '6px',
                marginBottom: spacing[3],
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.amber,
              }}
            >
              {result.calculationNote}
            </div>
          )}

          {/* Gap result */}
          {isGap && result.gapResult && (
            <GapDisplay gapResult={result.gapResult} />
          )}

          {/* Tier distribution */}
          {!isGap && hasResults && (
            <TierDistribution dist={result.tierDistribution} total={result.recordCount} />
          )}

          {/* Records table */}
          {!isGap && result.records.length > 0 && (
            <RecordsTable records={result.records} />
          )}

          {/* No records found */}
          {!isGap && result.records.length === 0 && (
            <div
              style={{
                padding: spacing[5],
                textAlign: 'center',
                backgroundColor: colours.surface,
                border: `1px solid ${colours.border}`,
                borderRadius: '8px',
              }}
            >
              <p
                style={{
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  margin: '0 0 8px',
                }}
              >
                No records matched this query.
              </p>
              <p
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textTertiary,
                  margin: 0,
                }}
              >
                To answer this question, upload a supporting document or enter data manually.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TierDistribution({ dist, total }: { dist: { A: number; B: number; C: number }; total: number }) {
  const tiers = (['A', 'B', 'C'] as const).filter(t => dist[t] > 0)
  if (tiers.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        gap: spacing[2],
        marginBottom: spacing[3],
        flexWrap: 'wrap',
      }}
    >
      {tiers.map(t => {
        const cfg = trustTierConfig[t]
        const pct = Math.round((dist[t] / total) * 100)
        return (
          <div
            key={t}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              backgroundColor: cfg.bg,
              borderRadius: '4px',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: cfg.colour,
            }}
          >
            <span style={{ fontWeight: typography.weights.medium }}>{dist[t]}</span>
            <span>{cfg.label}</span>
            <span style={{ color: colours.textTertiary }}>({pct}%)</span>
          </div>
        )
      })}
    </div>
  )
}

function RecordsTable({ records }: { records: NlRecord[] }) {
  return (
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
            {['Entity', 'Field', 'Value', 'Period', 'Domain', 'Trust tier'].map(col => (
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
          {records.map((record, i) => (
            <tr
              key={record.id}
              style={{ borderBottom: i < records.length - 1 ? `1px solid ${colours.border}` : 'none' }}
            >
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  maxWidth: '160px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={record.entityName}
              >
                {record.entityName}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  color: colours.textPrimary,
                }}
              >
                {record.fieldName.replace(/_/g, ' ')}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textPrimary,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {record.value.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {record.unit}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                  whiteSpace: 'nowrap',
                }}
              >
                {new Date(record.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                {' – '}
                {new Date(record.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
              </td>
              <td
                style={{
                  padding: '12px 16px',
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textSecondary,
                }}
              >
                {DOMAIN_LABELS[record.domain] ?? record.domain}
              </td>
              <td style={{ padding: '12px 16px' }}>
                <TierBadge tier={record.trustTier} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GapDisplay({ gapResult }: { gapResult: GapResult }) {
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
        No gaps found - all expected domains have records.
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
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              margin: '0 0 10px',
            }}
          >
            Your organisation - missing domains
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
                {['Supplier', 'Missing domains'].map(col => (
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
