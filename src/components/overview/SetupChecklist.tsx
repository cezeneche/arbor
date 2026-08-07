import Link from 'next/link'
import { colours, typography, spacing } from '@/lib/design-system'

// §10. Below ten records a dashboard reads as broken however well it is styled:
// a coverage matrix of two cells and a provenance bar of three records say
// nothing. This replaces sections 4 to 7 until there is enough to summarise.

export interface SetupChecklistProps {
  /** Record types started, out of those the org has any activity in. */
  typesStarted: { label: string; started: boolean }[]
  openPeriods: { label: string; hasRecord: boolean }[]
  documentBacked: number
  totalRecords: number
  threshold: number
}

const label = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colours.textTertiary,
  letterSpacing: typography.tracking.wider,
  textTransform: 'uppercase' as const,
  display: 'block',
  marginBottom: spacing[1],
}

function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: '10px',
        height: '10px',
        borderRadius: '2px',
        marginRight: '10px',
        backgroundColor: done ? colours.navy : 'transparent',
        border: done ? `1px solid ${colours.navy}` : `0.5px solid ${colours.border}`,
      }}
    />
  )
}

function Row({ text, done }: { text: string; done: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '9px 0',
        borderBottom: `0.5px solid ${colours.border}`,
        fontSize: typography.sizes.sm,
        fontWeight: typography.weights.light,
        color: done ? colours.textPrimary : colours.textSecondary,
      }}
    >
      <Tick done={done} />
      {text}
    </div>
  )
}

export function SetupChecklist({
  typesStarted,
  openPeriods,
  documentBacked,
  totalRecords,
  threshold,
}: SetupChecklistProps) {
  const remaining = Math.max(0, threshold - totalRecords)

  return (
    <section style={{ marginBottom: spacing[5] }}>
      <span style={label}>Getting started</span>
      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `0 0 ${spacing[3]}`,
          lineHeight: typography.lineHeight.body,
        }}
      >
        {remaining > 0
          ? `${remaining} more record${remaining === 1 ? '' : 's'} and this page switches to coverage and provenance. Below that they would be summarising too little to mean anything.`
          : 'Coverage and provenance are ready.'}
      </p>

      {typesStarted.length > 0 && (
        <div style={{ marginBottom: spacing[3] }}>
          <span style={label}>Record types</span>
          <div style={{ borderTop: `0.5px solid ${colours.border}` }}>
            {typesStarted.map(t => (
              <Row key={t.label} text={t.label} done={t.started} />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: spacing[3] }}>
        <span style={label}>Open periods</span>
        <div style={{ borderTop: `0.5px solid ${colours.border}` }}>
          {openPeriods.map(p => (
            <Row key={p.label} text={p.label} done={p.hasRecord} />
          ))}
        </div>
      </div>

      <p
        style={{
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.light,
          color: colours.textSecondary,
          margin: `0 0 ${spacing[3]}`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {documentBacked} of {totalRecords} record{totalRecords === 1 ? '' : 's'} backed by a document.
      </p>

      <Link
        href="/upload"
        style={{
          display: 'inline-block',
          padding: '10px 20px',
          backgroundColor: colours.navy,
          color: colours.surface,
          fontSize: typography.sizes.sm,
          fontWeight: typography.weights.medium,
          borderRadius: '3px',
          textDecoration: 'none',
        }}
      >
        Upload documents
      </Link>
    </section>
  )
}
