'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, spacing, typography, textStyles } from '@/lib/design-system'
import type { PresentedNarrative } from '@/lib/nucleos/narrative-presenter'

// The audit narrative for a case: the prose Nucleos wrote about how its figures
// were reached, checked against those figures. When the check finds a mismatch
// the verdict comes first, above the text, because the text is then not to be
// relied on until a person has looked.

const button = (busy: boolean): React.CSSProperties => ({
  padding: `${spacing[1]} ${spacing[3]}`,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  fontFamily: 'inherit',
  color: colours.textPrimary,
  backgroundColor: 'transparent',
  border: `1px solid ${colours.border}`,
  borderRadius: '4px',
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
})

const heading: React.CSSProperties = {
  ...textStyles.caption,
  color: colours.textTertiary,
  margin: `${spacing[2]} 0 4px`,
}

const body: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.light,
  color: colours.textPrimary,
  lineHeight: 1.6,
  margin: 0,
  maxWidth: '680px',
  whiteSpace: 'pre-wrap',
}

export function CbamAuditNarrative({ caseId, narrative }: { caseId: string; narrative: PresentedNarrative | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function write() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/cbam/cases/${encodeURIComponent(caseId)}/narrative`, { method: 'POST' })
      const result = (await res.json().catch(() => ({}))) as { error?: string; emailProblem?: string | null }
      if (!res.ok) {
        setMessage(result.error ?? 'The narrative could not be written.')
        return
      }
      if (result.emailProblem) setMessage(result.emailProblem)
      router.refresh()
    } catch {
      setMessage('The narrative could not be written. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {narrative && (
        <div style={{ marginBottom: spacing[3] }}>
          {narrative.reviewRequired && (
            <div
              style={{
                padding: spacing[2],
                marginBottom: spacing[2],
                backgroundColor: colours.amberBg,
                borderRadius: '4px',
                maxWidth: '680px',
              }}
            >
              <p style={{ ...body, fontWeight: typography.weights.medium, color: colours.amber }}>
                Needs review before it is relied on
              </p>
              <ul style={{ ...body, paddingLeft: '18px', margin: `4px 0 0` }}>
                {narrative.reasons.map(r => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {narrative.emailed && (
                <p style={{ ...textStyles.caption, color: colours.textSecondary, margin: `4px 0 0` }}>
                  {narrative.emailed}
                </p>
              )}
            </div>
          )}

          <p style={{ ...textStyles.caption, color: colours.textTertiary, margin: 0 }}>{narrative.byline}</p>

          {narrative.summary && (
            <>
              <p style={heading}>Summary</p>
              <p style={body}>{narrative.summary}</p>
            </>
          )}
          {narrative.methodology && (
            <>
              <p style={heading}>How the figures were reached</p>
              <p style={body}>{narrative.methodology}</p>
            </>
          )}
          {narrative.limitations.length > 0 && (
            <>
              <p style={heading}>Limitations</p>
              {narrative.limitations.map(l => (
                <p key={l} style={{ ...body, marginBottom: 4 }}>
                  {l}
                </p>
              ))}
            </>
          )}
          {narrative.openGaps.length > 0 && (
            <>
              <p style={heading}>Still to do before submitting</p>
              <ul style={{ ...body, paddingLeft: '18px' }}>
                {narrative.openGaps.map(g => (
                  <li key={`${g.field}-${g.issue}`}>
                    {g.issue} <span style={{ color: colours.textTertiary }}>({g.field})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!narrative.reviewRequired && narrative.reasons.length > 0 && (
            <>
              <p style={heading}>Points noted in the check</p>
              <ul style={{ ...body, paddingLeft: '18px' }}>
                {narrative.reasons.map(r => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {narrative.packHash && (
            <p style={{ ...textStyles.caption, color: colours.textTertiary, margin: `${spacing[2]} 0 0`, wordBreak: 'break-all' }}>
              Compliance pack {narrative.packHash}
            </p>
          )}
        </div>
      )}

      <button onClick={write} disabled={busy} style={button(busy)}>
        {busy ? 'Writing… this can take a minute' : narrative ? 'Write it again' : 'Write the audit narrative'}
      </button>
      {message && (
        <p style={{ ...textStyles.caption, color: colours.amber, margin: `${spacing[1]} 0 0`, maxWidth: '520px' }}>
          {message}
        </p>
      )}
    </div>
  )
}
