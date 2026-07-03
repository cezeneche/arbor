'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'
import { TierBadge } from './TierBadge'
import { TrustIndicator } from './TrustIndicator'
import { trustDisplay } from '@/lib/confidence/trust-display'
import { rankReviewFields } from '@/lib/review/information-gain'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'
import { NUMERIC_FIELDS } from '@/lib/review/review-policy'

interface ExtractedField {
  id: string
  fieldName: string
  admissibility: 'COMPULSORY' | 'CONDITIONAL' | 'OPTIONAL'
  rawValue: string | null
  rawUnit: string | null
  sourceText: string
  confidenceScore: number
  flagged: boolean
  flagReason: string | null
}

interface ExtractionJob {
  id: string
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED'
  errorMessage: string | null
  extractedFields: ExtractedField[]
}

interface Document {
  id: string
  documentType: string
  status: string
  extractionJobs: ExtractionJob[]
}

interface ConflictRecord {
  fieldName: string
  value: number
  unit: string
  trustTier: string
  periodStart: string
  periodEnd: string
}

interface Props {
  document: Document
  existingConflicts?: ConflictRecord[]
}

export function ExtractionReview({ document, existingConflicts = [] }: Props) {
  const router = useRouter()
  const job = document.extractionJobs[0]
  const fields = job?.extractedFields ?? []

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.fieldName, f.rawValue ?? '']))
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const domain = DOMAIN_BY_DOCUMENT_TYPE[document.documentType] ?? 'COMPLIANCE'
  const periodStartField = fields.find(
    f => f.fieldName === 'period_start' || f.fieldName === 'production_period_start'
  )
  const periodEndField = fields.find(
    f => f.fieldName === 'period_end' || f.fieldName === 'production_period_end'
  )

  const criticalFlags = fields.filter(
    f => f.admissibility === 'COMPULSORY' && (f.rawValue === null || f.rawValue === '')
  )
  const trustTier = criticalFlags.length > 0 ? 'B' : 'A'

  const compulsoryFields = fields.filter(f => f.admissibility === 'COMPULSORY')
  const conditionalFields = fields.filter(f => f.admissibility === 'CONDITIONAL')
  const optionalFields = fields.filter(f => f.admissibility === 'OPTIONAL')

  async function handleConfirm() {
    setError(null)

    const periodStart = periodStartField
      ? new Date(values[periodStartField.fieldName] || new Date().toISOString()).toISOString()
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const periodEnd = periodEndField
      ? new Date(values[periodEndField.fieldName] || new Date().toISOString()).toISOString()
      : new Date().toISOString()

    const numericFieldEntries = fields
      .filter(f => NUMERIC_FIELDS.has(f.fieldName) && values[f.fieldName])
      .map(f => ({
        fieldName: f.fieldName,
        confirmedValue: values[f.fieldName],
        confirmedUnit: f.rawUnit ?? undefined,
        domain,
        periodStart,
        periodEnd,
        sourceText: f.sourceText || undefined,
        confidenceScore: f.confidenceScore,
      }))

    if (numericFieldEntries.length === 0) {
      setError('No numeric fields with values to confirm. At least one numeric field is required.')
      return
    }

    setSubmitting(true)

    try {
      const res = await fetch(`/api/documents/${document.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: numericFieldEntries }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Confirmation failed.')
        setSubmitting(false)
        return
      }

      setConfirmed(true)
      setTimeout(() => router.push('/records'), 1500)
    } catch {
      setError('Confirmation failed. Check your connection.')
      setSubmitting(false)
    }
  }

  if (confirmed) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: spacing[8],
          color: colours.green,
          fontSize: typography.sizes.base,
          fontWeight: typography.weights.medium,
        }}
      >
        Records saved. Redirecting to records…
      </div>
    )
  }

  if (!job || job.status === 'QUEUED' || job.status === 'RUNNING') {
    return (
      <div style={{ padding: spacing[4] }}>
        <p
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
          }}
        >
          Extraction in progress. This page will update when complete.
        </p>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textTertiary,
            marginTop: spacing[1],
          }}
        >
          You can leave and return to this page at any time.
        </p>
      </div>
    )
  }

  if (job.status === 'FAILED') {
    return (
      <div
        style={{
          padding: spacing[3],
          backgroundColor: colours.redBg,
          borderRadius: '6px',
          color: colours.red,
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
        }}
      >
        Extraction failed: {job.errorMessage ?? 'Unknown error'}
      </div>
    )
  }

  const labelStyle = {
    display: 'block',
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    marginBottom: '4px',
  }

  const inputStyle = (flagged: boolean) => ({
    width: '100%',
    padding: '8px 10px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: flagged ? colours.amberBg : colours.surface,
    border: `1px solid ${flagged ? colours.amber : colours.border}`,
    borderRadius: '4px',
    outline: 'none',
  })

  function renderCard(field: ExtractedField) {
    const isMissing = field.rawValue === null || field.rawValue === ''
    const trust = trustDisplay({ confidenceScore: field.confidenceScore })
    // Low confidence must break the scanning pattern — a distinct red treatment
    // with a left accent bar, never the same amber as a merely flagged/missing
    // field. Missing/flagged/moderate stay amber.
    const isLow = !isMissing && trust.band === 'low'
    const showWarning = field.flagged || isMissing || trust.breaksPattern

    return (
      <div
        key={field.id}
        style={{
          backgroundColor: isLow ? colours.redBg : colours.surface,
          border: `1px solid ${isLow ? colours.red : showWarning ? colours.amber : colours.border}`,
          borderLeft: isLow ? `3px solid ${colours.red}` : undefined,
          borderRadius: '6px',
          padding: spacing[2],
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[1], marginBottom: '8px' }}>
          <label htmlFor={field.id} style={labelStyle}>
            {field.fieldName.replace(/_/g, ' ')}
          </label>
          {isMissing ? (
            <span
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                letterSpacing: typography.tracking.wide,
                color: colours.amber,
                whiteSpace: 'nowrap',
              }}
            >
              Not found
            </span>
          ) : (
            <TrustIndicator confidenceScore={field.confidenceScore} />
          )}
        </div>

        {isLow && (
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: colours.red,
              margin: '0 0 6px',
            }}
          >
            Please check this value carefully before saving.
          </p>
        )}

        <input
          id={field.id}
          type="text"
          value={values[field.fieldName] ?? ''}
          onChange={e => setValues(prev => ({ ...prev, [field.fieldName]: e.target.value }))}
          placeholder={isMissing ? 'Not found in document' : undefined}
          style={inputStyle(showWarning)}
        />

        {field.rawUnit && (
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              marginTop: '4px',
              display: 'block',
            }}
          >
            Unit: {field.rawUnit}
          </span>
        )}

        {field.flagReason && (
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.amber,
              margin: '6px 0 0',
            }}
          >
            {field.flagReason}
          </p>
        )}

        {field.sourceText && (
          <details style={{ marginTop: '8px' }}>
            <summary
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                cursor: 'pointer',
              }}
            >
              Where this came from
            </summary>
            <blockquote
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                borderLeft: `2px solid ${colours.border}`,
                margin: '6px 0 0',
                paddingLeft: '10px',
                fontStyle: 'italic',
              }}
            >
              {field.sourceText}
            </blockquote>
          </details>
        )}
      </div>
    )
  }

  function renderFieldGroup(title: string, groupFields: ExtractedField[], badge?: string) {
    if (groupFields.length === 0) return null
    // Upgrade 2 — active learning: order fields by expected information gain
    // (most-uncertain, most-important first) and collapse the confident,
    // low-information ones, so the user's attention leads with what matters most.
    const ranked = rankReviewFields(
      groupFields.map(f => ({
        fieldName: f.fieldName,
        confidence: f.confidenceScore,
        admissibility: f.admissibility,
        flagged: f.flagged,
        hasValue: !(f.rawValue === null || f.rawValue === ''),
      })),
    )
    const byName = new Map(groupFields.map(f => [f.fieldName, f]))
    const pick = (lowInfo: boolean) =>
      ranked
        .filter(r => r.lowInformation === lowInfo)
        .map(r => byName.get(r.fieldName))
        .filter((f): f is ExtractedField => Boolean(f))
    const prominent = pick(false)
    const confident = pick(true)
    const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: spacing[2] } as const

    return (
      <section style={{ marginBottom: spacing[4] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1], marginBottom: spacing[2] }}>
          <h3
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.textPrimary,
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: typography.tracking.wide,
            }}
          >
            {title}
          </h3>
          {badge && (
            <span
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                fontStyle: 'italic',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        {prominent.length > 0 && <div style={gridStyle}>{prominent.map(renderCard)}</div>}
        {confident.length > 0 && (
          <details style={{ marginTop: prominent.length > 0 ? spacing[2] : 0 }}>
            <summary
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                cursor: 'pointer',
                padding: '4px 0',
              }}
            >
              {confident.length} {confident.length === 1 ? 'field we’re' : 'fields we’re'} confident about — expand to review
            </summary>
            <div style={{ ...gridStyle, marginTop: spacing[2] }}>{confident.map(renderCard)}</div>
          </details>
        )}
      </section>
    )
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing[3],
          padding: `${spacing[2]} ${spacing[3]}`,
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '6px',
        }}
      >
        <div>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: 0,
            }}
          >
            Document type: <strong style={{ fontWeight: typography.weights.medium }}>{document.documentType.replace(/_/g, ' ')}</strong>
          </p>
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `4px 0 0`,
            }}
          >
            {fields.length} fields extracted · {criticalFlags.length} critical missing
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          <span
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
            }}
          >
            Trust tier on submit:
          </span>
          <TierBadge tier={trustTier as 'A' | 'B'} />
        </div>
      </div>

      {renderFieldGroup('Compulsory fields', compulsoryFields)}
      {renderFieldGroup('Conditional fields', conditionalFields, '(required when conditions apply)')}
      {renderFieldGroup('Optional fields', optionalFields)}

      {/* Cross-document conflict warning (PRD §12.3) */}
      {existingConflicts.length > 0 && (
        <div
          style={{
            backgroundColor: colours.amberBg,
            border: `1px solid ${colours.amber}`,
            borderRadius: '6px',
            padding: spacing[2],
            marginBottom: spacing[2],
          }}
        >
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.amber,
              margin: `0 0 ${spacing[1]}`,
            }}
          >
            Existing records found for the same period
          </p>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
              margin: `0 0 ${spacing[1]}`,
              lineHeight: '1.5',
            }}
          >
            The following records already exist for this domain and period. Review for consistency before confirming.
            Both will be stored. The newer record will be marked as the current version.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {existingConflicts.map((c, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.light,
                  color: colours.textPrimary,
                  backgroundColor: colours.surface,
                  border: `1px solid ${colours.border}`,
                  borderRadius: '4px',
                  padding: '6px 10px',
                }}
              >
                <span style={{ fontWeight: typography.weights.medium }}>
                  {c.fieldName.replace(/_/g, ' ')}
                </span>
                <span style={{ color: colours.textSecondary }}>
                  {c.value.toLocaleString('en-GB', { maximumFractionDigits: 3 })} {c.unit}
                  {' · '}
                  <span style={{ color: c.trustTier === 'A' ? colours.green : colours.amber }}>
                    {c.trustTier === 'A' ? 'Verified' : c.trustTier === 'B' ? 'Declared' : 'Estimated'}
                  </span>
                  {' · '}
                  {new Date(c.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  {' – '}
                  {new Date(c.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.red,
            backgroundColor: colours.redBg,
            padding: '10px 12px',
            borderRadius: '4px',
            marginBottom: spacing[2],
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing[2], marginTop: spacing[3] }}>
        <button
          onClick={() => router.push('/records')}
          style={{
            padding: '12px 20px',
            backgroundColor: 'transparent',
            color: colours.textSecondary,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.light,
            border: `1px solid ${colours.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Save for later
        </button>
        <button
          onClick={handleConfirm}
          disabled={submitting}
          style={{
            padding: '12px 24px',
            backgroundColor: submitting ? colours.navyHover : colours.navy,
            color: colours.surface,
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            border: 'none',
            borderRadius: '4px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            letterSpacing: typography.tracking.wide,
          }}
        >
          {submitting ? 'Confirming…' : 'Confirm and save records'}
        </button>
      </div>
    </div>
  )
}
