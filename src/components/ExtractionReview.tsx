'use client'

import { CbamResumeHandoff, type HandoffState } from './CbamResumeHandoff'
import { CbamHandoffInputs } from './CbamHandoffInputs'
import { reviewTier } from '@/lib/layer2/review-tier'
import { isCbamRelevant } from '@/lib/nucleos/cbam-relevance'
import { useState } from 'react'
import { fieldLabel } from '@/lib/layer3/field-label'
import { useRouter } from 'next/navigation'
import { explainFlagReason } from '@/lib/nucleos/flag-vocabulary'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { TierBadge } from './TierBadge'
import { layoutReviewFields } from '@/lib/review/review-layout'
import { DOMAIN_BY_DOCUMENT_TYPE } from '@/lib/constants'
import { derivePeriod, documentPeriod, missingCbamDocumentDate } from '@/lib/review/review-policy'
import { clearedFieldEntries, isRecordProducingField } from '@/lib/review/confirm-split'

// The requirement level used to be a section heading. Three headings meant three
// grids and three ragged last rows, so it travels on the card instead — in the
// words a supplier uses, not the admissibility codes.
const REQUIREMENT_LABEL: Record<'COMPULSORY' | 'CONDITIONAL' | 'OPTIONAL', string> = {
  COMPULSORY: 'Required',
  CONDITIONAL: 'Required if it applies',
  OPTIONAL: 'Optional',
}

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
  /** Saved Declared with nobody checking it; confirming here upgrades it. */
  autoAccepted?: boolean
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
  /** The organisation's registered name, which the tier is checked against. */
  entityName: string
  existingConflicts?: ConflictRecord[]
}

export function ExtractionReview({ document, entityName, existingConflicts = [] }: Props) {
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
  // Set when the figures were saved but the CBAM case they should have produced
  // came out incomplete. Shown inline rather than swallowed: a case short a
  // goods line looks exactly like a complete one.
  const [handoff, setHandoff] = useState<HandoffState | null>(null)

  const domain = DOMAIN_BY_DOCUMENT_TYPE[document.documentType] ?? 'COMPLIANCE'
  // Already written to the store, either just now or on an earlier visit. An
  // auto-accepted document is written but unchecked, so it keeps its Confirm.
  const isSaved = confirmed || (document.status === 'ACCEPTED' && !document.autoAccepted)
  const hasRecords = isSaved || Boolean(document.autoAccepted)

  // A CBAM document the extraction could not date. Its case is filed for the
  // quarter of its import, so the date is asked for here, before anything is
  // saved. Decided from what was read, so the field stays while it is typed in.
  const readsNoImportDate = !fields.some(f => f.fieldName === 'import_date')
  const askForImportDate =
    isCbamRelevant(document.documentType) &&
    readsNoImportDate &&
    documentPeriod(Object.fromEntries(fields.map(f => [f.fieldName, f.rawValue])), {
      documentType: document.documentType,
    }) === null
  const missingDate = missingCbamDocumentDate(document.documentType, values)
  // Saved, then removed. Its records are out of the active set and the chain
  // holds a WITHDRAWN entry for each; there is nothing left to do to it.
  const isWithdrawn = document.status === 'WITHDRAWN'

  const criticalFlags = fields.filter(
    f => f.admissibility === 'COMPULSORY' && (f.rawValue === null || f.rawValue === '')
  )
  // The tier this would be saved at: the confirm route calls reviewTier with
  // the same inputs — the source text, the organisation name, and the period
  // ends of the records handleConfirm sends — so the badge is the saved tier.
  //
  // The period is shared with the auto-accept path so both derive identically.
  // An inline copy once anchored it to upload time, which meant the same
  // document confirmed twice wrote two records instead of superseding.
  const derived = derivePeriod(values, { documentType: document.documentType })
  const recordPeriodEnds = fields
    .filter(f => values[f.fieldName] && isRecordProducingField(f.fieldName))
    .map(() => derived.periodEnd.toISOString())
  const trustTier = reviewTier({
    documentType: document.documentType,
    cbam: isCbamRelevant(document.documentType),
    hasExtraction: Boolean(job),
    extracted: new Map(fields.map(f => [f.fieldName, f.rawValue])),
    confirmed: new Map(Object.entries(values)),
    sourceText: new Map(fields.map(f => [f.fieldName, f.sourceText])),
    entityName,
    recordPeriodEnds,
  })

  // One grid over every field, ordered compulsory → conditional → optional and
  // by information gain within each. Three separate grids left a hole beside the
  // last card of any group with an odd count; twelve fields now fill six rows.
  const laidOut = layoutReviewFields(
    fields.map(f => ({
      fieldName: f.fieldName,
      admissibility: f.admissibility,
      confidence: f.confidenceScore,
      flagged: f.flagged,
      hasValue: !(f.rawValue === null || f.rawValue === ''),
    })),
  )
  const fieldByName = new Map(fields.map(f => [f.fieldName, f]))

  async function handleConfirm(onDuplicate?: 'replace' | 'keep_both') {
    setError(null)
    setDuplicates(null)

    const periodStart = derived.periodStart.toISOString()
    const periodEnd = derived.periodEnd.toISOString()

    if (missingDate) {
      setError('Add the import date before saving. The import case is filed for the quarter that date falls in.')
      return
    }

    const withValues = fields.filter(f => values[f.fieldName])

    const numericFieldEntries = withValues
      .filter(f => isRecordProducingField(f.fieldName))
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

    // The identifiers. They write no record — an EORI has no value, unit or
    // period — but a CBAM case cannot be opened without them, and a correction
    // the reviewer made to one has to reach it rather than being read back off
    // the extraction.
    //
    // A field the reviewer cleared is sent as a clear. Left out, the route would
    // certify it from the extraction and the clear would never have happened.
    const contextEntries = [
      ...withValues
        .filter(f => !isRecordProducingField(f.fieldName))
        .map(f => ({ fieldName: f.fieldName, confirmedValue: values[f.fieldName] })),
      ...clearedFieldEntries(fields, values),
      // Typed in above because the document gave none; not an extracted field.
      ...(askForImportDate && values.import_date
        ? [{ fieldName: 'import_date', confirmedValue: values.import_date }]
        : []),
    ]

    if (numericFieldEntries.length === 0) {
      setError('No numeric fields with values to confirm. At least one numeric field is required.')
      return
    }

    setSubmitting(true)

    try {
      const res = await fetch(`/api/documents/${document.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: numericFieldEntries,
          ...(contextEntries.length > 0 ? { context: contextEntries } : {}),
          ...(onDuplicate ? { onDuplicate } : {}),
        }),
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

      // A CBAM document does not only produce records — it opens a case, and
      // the case is what the user came here to get. When part of it did not
      // land, that is said and the user is left on this screen to read it,
      // rather than being sent to a case that is quietly short a goods line.
      const cbam = data.cbam as HandoffState | undefined

      if (cbam && cbam.problems.length > 0) {
        setHandoff(cbam)
        setSubmitting(false)
        return
      }

      setConfirmed(true)
      // Straight to what the confirmation just produced. The interstitial it
      // used to sit on for a second and a half told the user nothing the
      // destination does not show better.
      router.push(cbam?.caseId ? `/cbam/${encodeURIComponent(cbam.caseId)}` : '/records')
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

  const footerStyle = {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
  } as const

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
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not delete this document.')
        setDeleting(false)
        return
      }
      // Figures were withdrawn, so send the user where they can see they are
      // gone. A document that never became records has nothing to show there.
      router.push(data.withdrawn > 0 ? '/records' : '/upload')
    } catch {
      setError('Could not delete this document. Check your connection.')
      setDeleting(false)
    }
  }

  function renderCard(field: ExtractedField, spansRow: boolean) {
    const isMissing = field.rawValue === null || field.rawValue === ''

    // A confidence badge on every field said the same thing on every field, and
    // an amber border on all of them made the whole form read as a warning. The
    // score still drives which fields are ranked first, and it still decides the
    // trust tier server-side — it is simply not furniture around every input.
    // Only a value that is genuinely absent is marked, and the border stays
    // neutral throughout.
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
          // Closes a short last row rather than leaving half of it empty.
          gridColumn: spansRow ? '1 / -1' : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[1], marginBottom: '8px' }}>
          <label htmlFor={field.id} style={labelStyle}>
            {fieldLabel(field.fieldName)}
          </label>
          <span
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: colours.textTertiary,
              whiteSpace: 'nowrap',
            }}
          >
            {isMissing ? 'Not found' : REQUIREMENT_LABEL[field.admissibility]}
          </span>
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

        {explainFlagReason(field.flagReason).map(flag => (
          <p
            key={flag.raw}
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.light,
              color: flag.serious ? colours.amber : colours.textTertiary,
              margin: '6px 0 0',
            }}
          >
            {/* Plain English first, then the flag itself. The sentence is what a
                reviewer acts on; the token is what they quote when they ask why. */}
            {flag.explanation ?? flag.raw}
            {flag.explanation && (
              <span style={{ color: colours.textTertiary }}> ({flag.raw})</span>
            )}
          </p>
        ))}

      </div>
    )
  }

  function renderFields() {
    if (laidOut.length === 0) return null
    // `stretch` is what makes the two columns line up: without it a card with a
    // unit note is taller than its neighbour and the rows go ragged.
    return (
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: spacing[2],
          alignItems: 'stretch',
          marginBottom: spacing[4],
        }}
      >
        {laidOut.map(l => {
          const field = fieldByName.get(l.fieldName)
          return field ? renderCard(field, l.spansRow) : null
        })}
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

      {renderFields()}

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

      {askForImportDate && !isSaved && !isWithdrawn && (
        <div
          style={{
            border: `1px solid ${colours.border}`,
            borderLeft: `3px solid ${colours.amber}`,
            borderRadius: '6px',
            padding: spacing[3],
            marginBottom: spacing[3],
            backgroundColor: colours.amberBg,
          }}
        >
          <label style={{ display: 'block' }}>
            <span style={textStyles.rowTitle}>Import date</span>
            <span
              style={{ ...textStyles.caption, display: 'block', color: colours.textSecondary, margin: `${spacing[1]} 0 ${spacing[2]}` }}
            >
              We could not find a date on this document. Enter the date the goods were imported: the import
              case is filed for the quarter it falls in.
            </span>
            <input
              type="date"
              value={values.import_date ?? ''}
              onChange={e => setValues(v => ({ ...v, import_date: e.target.value }))}
              style={{
                padding: '7px 10px',
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
                border: `1px solid ${missingDate ? colours.amber : colours.border}`,
                borderRadius: '4px',
                backgroundColor: colours.surface,
              }}
            />
          </label>
        </div>
      )}

      {document.autoAccepted && !confirmed && (
        <div
          style={{
            border: `1px solid ${colours.border}`,
            borderLeft: `3px solid ${colours.amber}`,
            borderRadius: '6px',
            padding: spacing[3],
            marginBottom: spacing[3],
            backgroundColor: colours.amberBg,
          }}
        >
          <p style={textStyles.rowTitle}>These figures were saved without a check</p>
          <p style={{ ...textStyles.caption, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
            They are in your records as Declared. Check them below and confirm to save them as Verified.
          </p>
        </div>
      )}

      {handoff && (
        <div
          style={{
            border: `1px solid ${colours.border}`,
            borderLeft: `3px solid ${colours.amber}`,
            borderRadius: '6px',
            padding: spacing[3],
            marginBottom: spacing[3],
            backgroundColor: colours.amberBg,
          }}
        >
          <p style={textStyles.rowTitle}>
            {handoff.status === 'NEEDS_INPUT'
              ? 'Your figures are saved. The import case needs a detail the document did not give'
              : handoff.caseId
                ? 'Your figures are saved, but the import case is not complete'
                : 'Your figures are saved, but no import case was opened'}
          </p>
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
            {handoff.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          {handoff.status === 'NEEDS_INPUT' && (handoff.needs?.length ?? 0) > 0 && (
            <CbamHandoffInputs
              documentId={document.id}
              needs={handoff.needs!}
              onResult={next => {
                if (next.problems.length === 0 && next.caseId) {
                  router.push(`/cbam/${encodeURIComponent(next.caseId)}`)
                  return
                }
                setHandoff(next)
              }}
            />
          )}
          <div style={{ display: 'flex', gap: spacing[2], marginTop: spacing[3] }}>
            {handoff.status !== 'NEEDS_INPUT' && (
              <CbamResumeHandoff
                documentId={document.id}
                onResult={next => {
                  if (next.problems.length === 0 && next.caseId) {
                    router.push(`/cbam/${encodeURIComponent(next.caseId)}`)
                    return
                  }
                  setHandoff(next)
                }}
              />
            )}
            {handoff.caseId && (
              <a
                href={`/cbam/${encodeURIComponent(handoff.caseId)}`}
                style={{
                  padding: '7px 16px',
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  color: colours.surface,
                  backgroundColor: colours.navy,
                  borderRadius: '4px',
                  textDecoration: 'none',
                }}
              >
                Open the case
              </a>
            )}
            <a
              href="/records"
              style={{
                padding: '7px 16px',
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                textDecoration: 'none',
              }}
            >
              See the saved figures
            </a>
          </div>
        </div>
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

      {/* Three states, three sets of actions. A saved document has no primary
          action left: the records exist and the audit chain is append-only, so
          confirming again is not a thing that can happen. It used to render a
          live Confirm button that answered 409. */}
      <div style={footerStyle}>
        {isWithdrawn ? (
          <span
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
            }}
          >
            Deleted. These figures are no longer in your records.
          </span>
        ) : confirmDelete ? (
          <>
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
                marginRight: 'auto',
                lineHeight: typography.lineHeight.body,
              }}
            >
              {hasRecords
                ? `Delete ${document.fileName}? Its figures come out of your records, totals and
                   exports. The audit trail keeps an entry saying they were withdrawn, as it must —
                   nothing certified is ever erased.`
                : `Delete ${document.fileName} and everything read from it? Nothing has been saved
                   yet, so nothing is recoverable.`}
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
        ) : isSaved ? (
          <>
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
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: colours.red,
                color: colours.surface,
                fontSize: typography.sizes.base,
                fontWeight: typography.weights.medium,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                letterSpacing: typography.tracking.wide,
              }}
            >
              Delete document
            </button>
          </>
        ) : (
          <>
            {/* Destructive action sits with the others rather than in its own
                section, but stays visually separate: outlined rather than filled
                while there is a primary action to compete with. */}
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
    </div>
  )
}
