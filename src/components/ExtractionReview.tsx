'use client'

import { useState } from 'react'
import { fieldLabel } from '@/lib/layer3/field-label'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { TierBadge } from './TierBadge'
import { rankReviewFields } from '@/lib/review/information-gain'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'
import { NUMERIC_FIELDS, derivePeriod } from '@/lib/review/review-policy'

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
  fileName: string
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
  // Set when the server refuses because these figures already exist. The choice
  // is always the user's — the write path never picks for them.
  const [duplicates, setDuplicates] = useState<{ fieldName: string; priorSummary: string }[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const domain = DOMAIN_BY_DOCUMENT_TYPE[document.documentType] ?? 'COMPLIANCE'
  // Already written to the store, either just now or on an earlier visit.
  const isSaved = confirmed || document.status === 'ACCEPTED'

  const criticalFlags = fields.filter(
    f => f.admissibility === 'COMPULSORY' && (f.rawValue === null || f.rawValue === '')
  )
  const trustTier = criticalFlags.length > 0 ? 'B' : 'A'

  const compulsoryFields = fields.filter(f => f.admissibility === 'COMPULSORY')
  const conditionalFields = fields.filter(f => f.admissibility === 'CONDITIONAL')
  const optionalFields = fields.filter(f => f.admissibility === 'OPTIONAL')

  async function handleConfirm(onDuplicate?: 'replace' | 'keep_both') {
    setError(null)
    setDuplicates(null)

    // Shared with the auto-accept path so both derive identically. This used to
    // be an inline copy that anchored the period to upload time, which meant the
    // same document confirmed twice wrote two records instead of superseding.
    const derived = derivePeriod(values, { documentType: document.documentType })
    const periodStart = derived.periodStart.toISOString()
    const periodEnd = derived.periodEnd.toISOString()

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
        body: JSON.stringify({ fields: numericFieldEntries, ...(onDuplicate ? { onDuplicate } : {}) }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409 && data.code === 'DUPLICATE_RECORDS') {
          setDuplicates(data.duplicates ?? [])
          setSubmitting(false)
          return
        }
        setError(data.error ?? 'Confirmation failed.')
        setSubmitting(false)
        return
      }

      // Straight to the records the confirmation just created. The interstitial
      // it used to sit on for a second and a half told the user nothing the
      // records page does not show better.
      setConfirmed(true)
      router.push('/records')
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

  const inputStyle = () => ({
    width: '100%',
    padding: '8px 10px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    outline: 'none',
  })

  async function handleDelete() {
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/documents/${document.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Could not delete this document.')
        setDeleting(false)
        return
      }
      router.push('/upload')
    } catch {
      setError('Could not delete this document. Check your connection.')
      setDeleting(false)
    }
  }

  function renderCard(field: ExtractedField) {
    const isMissing = field.rawValue === null || field.rawValue === ''

    // A confidence badge on every field said the same thing on every field, and
    // an amber border on all of them made the whole form read as a warning. The
    // score still drives which fields are ranked first and which are collapsed,
    // and it still decides the trust tier server-side — it is simply not
    // furniture around every input. Only a value that is genuinely absent is
    // marked, and the border stays neutral throughout.
    return (
      <div
        key={field.id}
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: colours.surface,
          border: `1px solid ${colours.border}`,
          borderRadius: '6px',
          padding: spacing[2],
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[1], marginBottom: '8px' }}>
          <label htmlFor={field.id} style={labelStyle}>
            {fieldLabel(field.fieldName)}
          </label>
          {isMissing && (
            <span
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.light,
                color: colours.textTertiary,
                whiteSpace: 'nowrap',
              }}
            >
              Not found
            </span>
          )}
        </div>

        <input
          id={field.id}
          type="text"
          value={values[field.fieldName] ?? ''}
          onChange={e => setValues(prev => ({ ...prev, [field.fieldName]: e.target.value }))}
          placeholder={isMissing ? 'Not found in document' : undefined}
          style={inputStyle()}
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
        {/* Pushes the optional notes to the bottom so every card in a row ends
            level, whatever it happens to carry. */}
        <div style={{ flex: 1 }} />

        {field.flagReason && !/confidence/i.test(field.flagReason) && (
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              margin: '6px 0 0',
            }}
          >
            {field.flagReason}
          </p>
        )}

      </div>
    )
  }

  function renderFieldGroup(title: string, groupFields: ExtractedField[], badge?: string) {
    if (groupFields.length === 0) return null
    // active learning: order fields by expected information gain
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
    // `stretch` is what makes the two columns line up: without it a card with a
    // unit note is taller than its neighbour and the rows go ragged, which is
    // what left a hole down the right-hand side.
    const gridStyle = {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: spacing[2],
      alignItems: 'stretch',
    } as const

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
            style={textStyles.sectionSubtitle}
          >
            Document type: <strong style={{ fontWeight: typography.weights.medium }}>{document.documentType.replace(/_/g, ' ')}</strong>
          </p>
          <p
            style={{ ...textStyles.sectionSubtitle, margin: `4px 0 0` }}
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

      {duplicates && (
        <div
          style={{
            border: `1px solid ${colours.border}`,
            borderLeft: `3px solid ${colours.textPrimary}`,
            borderRadius: '6px',
            padding: spacing[3],
            marginBottom: spacing[3],
          }}
        >
          <p style={{ ...textStyles.rowTitle, margin: 0 }}>
            These figures already exist for this period
          </p>
          <ul
            style={{
              margin: `${spacing[1]} 0 0`,
              paddingLeft: '18px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
            }}
          >
            {duplicates.map(d => (
              <li key={d.fieldName}>
                {fieldLabel(d.fieldName)} — already recorded as {d.priorSummary}
              </li>
            ))}
          </ul>
          <p
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              margin: `${spacing[1]} 0 ${spacing[2]}`,
              lineHeight: typography.lineHeight.body,
            }}
          >
            Replacing keeps the original in your audit trail and marks it as superseded. Keeping
            both leaves two figures for the same period, which will double-count on any total.
          </p>
          <div style={{ display: 'flex', gap: spacing[1], flexWrap: 'wrap' }}>
            <button
              onClick={() => handleConfirm('replace')}
              disabled={submitting}
              style={{
                padding: '8px 16px',
                backgroundColor: colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                border: 'none',
                borderRadius: '4px',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Replace the existing figures
            </button>
            <button
              onClick={() => handleConfirm('keep_both')}
              disabled={submitting}
              style={{
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: colours.textSecondary,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Keep both
            </button>
            <button
              onClick={() => setDuplicates(null)}
              style={{
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: colours.textTertiary,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* A saved document has no primary action left: the records exist and the
          audit chain is append-only, so confirming again is not a thing that can
          happen. It used to render a live Confirm button that answered 409. */}
      {isSaved ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: spacing[2],
            marginTop: spacing[3],
          }}
        >
          <span
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
            }}
          >
            Saved. These figures are in your records.
          </span>
          <button
            onClick={() => router.push('/records')}
            style={{
              padding: '12px 24px',
              backgroundColor: colours.navy,
              color: colours.surface,
              fontSize: typography.sizes.base,
              fontWeight: typography.weights.medium,
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              letterSpacing: typography.tracking.wide,
            }}
          >
            View records
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: spacing[2],
            marginTop: spacing[3],
          }}
        >
          {/* Destructive action sits with the others rather than in its own
              section, but stays visually separate: outlined red, never filled,
              and behind an inline confirmation so it cannot be hit in passing. */}
          {confirmDelete ? (
            <>
              <span
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.light,
                  color: colours.textPrimary,
                  marginRight: 'auto',
                }}
              >
                Delete {document.fileName} and everything read from it? Nothing has been saved yet,
                so nothing is recoverable.
              </span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  padding: '12px 20px',
                  backgroundColor: colours.red,
                  color: colours.surface,
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.medium,
                  border: 'none',
                  borderRadius: '4px',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >
                {deleting ? 'Deleting…' : 'Yes, delete it'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
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
                Keep it
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  padding: '12px 20px',
                  backgroundColor: 'transparent',
                  color: colours.red,
                  fontSize: typography.sizes.base,
                  fontWeight: typography.weights.light,
                  border: `1px solid ${colours.red}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginRight: 'auto',
                }}
              >
                Delete document
              </button>
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
                onClick={() => handleConfirm()}
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
