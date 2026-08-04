'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing, textStyles, borders } from '@/lib/design-system'
import type { DefinitionOverviewRow, CounterpartyAgreement } from '@/lib/layer3/definitions-overview'

// Confirmations are inline — no modals. A definition is agreed by reading the
// wording and pressing agree on the row it sits in, never in a popup that hides
// the text being agreed to.

interface Props {
  definitions: DefinitionOverviewRow[]
  counterparties: { entityId: string; legalName: string }[]
  /** Buyers get the technical detail (field name, version, domain code); SMEs do not. */
  showTechnicalDetail: boolean
}

const STATUS_COLOUR: Record<string, { fg: string; bg: string }> = {
  AGREED: { fg: colours.green, bg: colours.greenBg },
  PROPOSED: { fg: colours.amber, bg: colours.amberBg },
  SUPERSEDED: { fg: colours.amber, bg: colours.amberBg },
  NOT_AGREED: { fg: colours.red, bg: colours.redBg },
  NONE: { fg: colours.slate, bg: colours.slateBg },
  NOT_APPLICABLE: { fg: colours.slate, bg: colours.slateBg },
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const c = STATUS_COLOUR[status] ?? STATUS_COLOUR.NONE
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: borders.radius.xs,
        backgroundColor: c.bg,
        color: c.fg,
        fontSize: typography.sizes.label,
        fontWeight: typography.weights.medium,
        letterSpacing: typography.tracking.wide,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

export function DefinitionsList({ definitions, counterparties, showTechnicalDetail }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openProposal, setOpenProposal] = useState<string | null>(null)
  const [target, setTarget] = useState<string>('')

  async function respond(agreementId: string, decision: 'accept' | 'reject') {
    setBusy(agreementId)
    setError(null)
    try {
      const res = await fetch(`/api/definitions/agreements/${agreementId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'That did not save. Try again.')
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function propose(fieldDefinitionId: string) {
    if (!target) return
    setBusy(fieldDefinitionId)
    setError(null)
    try {
      const res = await fetch('/api/definitions/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldDefinitionId, counterpartyEntityId: target }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'That did not send. Try again.')
        return
      }
      setOpenProposal(null)
      setTarget('')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const buttonBase = {
    padding: '6px 14px',
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    borderRadius: borders.radius.sm,
    letterSpacing: typography.tracking.wide,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2] }}>
      {error && (
        <p
          style={{
            ...textStyles.caption,
            color: colours.red,
            backgroundColor: colours.redBg,
            padding: spacing[1],
            borderRadius: borders.radius.sm,
          }}
        >
          {error}
        </p>
      )}

      {definitions.map(def => {
        const awaiting = def.counterparties.filter(c => c.awaitingUs)
        const alreadyWith = new Set(def.counterparties.map(c => c.counterpartyEntityId))
        const available = counterparties.filter(c => !alreadyWith.has(c.entityId))

        return (
          <div
            key={def.id}
            style={{
              backgroundColor: colours.surface,
              border: `1px solid ${awaiting.length > 0 ? colours.amber : colours.border}`,
              borderRadius: borders.radius.lg,
              padding: spacing[3],
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[2], alignItems: 'flex-start' }}>
              <div>
                <p style={textStyles.sectionTitle}>{def.label}</p>
                <p style={{ ...textStyles.caption, marginTop: '2px' }}>
                  {def.domainLabel}
                  {showTechnicalDetail && (
                    <>
                      {' · '}
                      {def.fieldName} · version {def.version}
                      {def.canonicalUnit ? ` · stored in ${def.canonicalUnit}` : ''}
                    </>
                  )}
                </p>
              </div>
            </div>

            <p style={{ ...textStyles.value, marginTop: spacing[2], lineHeight: typography.lineHeight.body }}>
              {def.definition}
            </p>

            <div
              style={{
                marginTop: spacing[2],
                padding: spacing[2],
                backgroundColor: colours.background,
                borderRadius: borders.radius.sm,
              }}
            >
              <p style={{ ...textStyles.eyebrow, marginBottom: '4px' }}>What counts</p>
              <p style={{ ...textStyles.value, lineHeight: typography.lineHeight.body }}>{def.boundary}</p>
            </div>

            {/* Where each company you share with stands on this wording. */}
            {def.counterparties.length > 0 && (
              <div style={{ marginTop: spacing[2], display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {def.counterparties.map((c: CounterpartyAgreement) => (
                  <div
                    key={c.agreementId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: spacing[2],
                      paddingTop: '10px',
                      borderTop: `1px solid ${colours.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1], flexWrap: 'wrap' }}>
                      <span style={textStyles.rowTitle}>{c.counterpartyName}</span>
                      <StatusPill status={c.status} label={c.statusLabel} />
                      {c.status === 'SUPERSEDED' && (
                        <span style={textStyles.caption}>
                          they agreed the wording as it stood at version {c.agreedVersion}
                        </span>
                      )}
                    </div>

                    {c.awaitingUs ? (
                      <div style={{ display: 'flex', gap: spacing[1] }}>
                        <button
                          onClick={() => respond(c.agreementId, 'accept')}
                          disabled={busy === c.agreementId}
                          style={{
                            ...buttonBase,
                            color: colours.surface,
                            backgroundColor: colours.navy,
                            border: `1px solid ${colours.navy}`,
                          }}
                        >
                          {busy === c.agreementId ? 'Saving…' : 'Agree'}
                        </button>
                        <button
                          onClick={() => respond(c.agreementId, 'reject')}
                          disabled={busy === c.agreementId}
                          style={{
                            ...buttonBase,
                            color: colours.textSecondary,
                            backgroundColor: 'transparent',
                            border: `1px solid ${colours.border}`,
                          }}
                        >
                          Not how we record it
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {/* Ask another company to agree this wording. Inline, never a modal. */}
            {available.length > 0 && (
              <div style={{ marginTop: spacing[2], paddingTop: '10px', borderTop: `1px solid ${colours.border}` }}>
                {openProposal === def.id ? (
                  <div style={{ display: 'flex', gap: spacing[1], alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={target}
                      onChange={e => setTarget(e.target.value)}
                      style={{
                        padding: '6px 10px',
                        fontSize: typography.sizes.sm,
                        fontWeight: typography.weights.light,
                        color: colours.textPrimary,
                        border: `1px solid ${colours.border}`,
                        borderRadius: borders.radius.sm,
                        backgroundColor: colours.surface,
                      }}
                    >
                      <option value="">Choose a company…</option>
                      {available.map(c => (
                        <option key={c.entityId} value={c.entityId}>
                          {c.legalName}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => propose(def.id)}
                      disabled={!target || busy === def.id}
                      style={{
                        ...buttonBase,
                        color: colours.surface,
                        backgroundColor: target ? colours.navy : colours.textTertiary,
                        border: `1px solid ${target ? colours.navy : colours.textTertiary}`,
                        cursor: target ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {busy === def.id ? 'Sending…' : 'Send'}
                    </button>
                    <button
                      onClick={() => {
                        setOpenProposal(null)
                        setTarget('')
                      }}
                      style={{
                        ...buttonBase,
                        color: colours.textSecondary,
                        backgroundColor: 'transparent',
                        border: `1px solid ${colours.border}`,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setOpenProposal(def.id)}
                    style={{
                      ...buttonBase,
                      color: colours.navy,
                      backgroundColor: 'transparent',
                      border: `1px solid ${colours.border}`,
                    }}
                  >
                    Ask a customer to agree this
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
