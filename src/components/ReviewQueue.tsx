'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing, confidenceThreshold } from '@/lib/design-system'

export interface ReviewField {
  fieldName: string
  value: string
  unit: string | null
  flagged: boolean
  flagReason: string | null
  sourceText: string
  confidenceScore: number
}

export interface ReviewDoc {
  documentId: string
  fileName: string
  documentType: string
  domain: string
  periodStart: string
  periodEnd: string
  fields: ReviewField[]
}

function readable(s: string): string {
  return s.replace(/_/g, ' ')
}

export function ReviewQueue({ initial }: { initial: ReviewDoc[] }) {
  const router = useRouter()
  const [docs, setDocs] = useState(initial)
  const [values, setValues] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(initial.map((d) => [d.documentId, Object.fromEntries(d.fields.map((f) => [f.fieldName, f.value]))])),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function confirmDoc(doc: ReviewDoc): Promise<boolean> {
    const docValues = values[doc.documentId] ?? {}
    const fields = doc.fields
      .filter((f) => (docValues[f.fieldName] ?? '').trim() !== '')
      .map((f) => ({
        fieldName: f.fieldName,
        confirmedValue: docValues[f.fieldName],
        confirmedUnit: f.unit ?? undefined,
        domain: doc.domain,
        periodStart: doc.periodStart,
        periodEnd: doc.periodEnd,
        sourceText: f.sourceText,
        confidenceScore: 1.0, // user-confirmed
      }))
    if (fields.length === 0) return false

    const res = await fetch(`/api/documents/${doc.documentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    })
    return res.ok
  }

  async function handleConfirm(doc: ReviewDoc) {
    setBusy(doc.documentId)
    setError(null)
    const ok = await confirmDoc(doc)
    setBusy(null)
    if (ok) {
      setDocs((d) => d.filter((x) => x.documentId !== doc.documentId))
      router.refresh()
    } else {
      setError(`Could not confirm ${doc.fileName}. Check that each value is a number.`)
    }
  }

  async function handleConfirmAll() {
    setBusy('ALL')
    setError(null)
    const remaining: ReviewDoc[] = []
    for (const doc of docs) {
      const ok = await confirmDoc(doc)
      if (!ok) remaining.push(doc)
    }
    setBusy(null)
    setDocs(remaining)
    router.refresh()
    if (remaining.length > 0) setError('Some documents could not be confirmed automatically - check their values below.')
  }

  if (docs.length === 0) {
    return (
      <div style={{ padding: spacing[6], textAlign: 'center', backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px' }}>
        <p style={{ margin: 0, fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary }}>
          Nothing to review. You&apos;re all caught up.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: spacing[2] }}>
        <button
          type="button"
          onClick={handleConfirmAll}
          disabled={busy !== null}
          style={{ padding: '10px 20px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.surface, backgroundColor: colours.navy, border: 'none', borderRadius: '4px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          {busy === 'ALL' ? 'Confirming all…' : 'Confirm everything'}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: typography.sizes.sm, color: colours.red, marginBottom: spacing[2] }}>{error}</p>
      )}

      <div style={{ display: 'grid', gap: spacing[3] }}>
        {docs.map((doc) => (
          <div key={doc.documentId} style={{ backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: `${spacing[2]} ${spacing[3]}`, borderBottom: `1px solid ${colours.border}`, backgroundColor: colours.background, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary }}>{doc.fileName}</span>
                <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, marginLeft: spacing[2] }}>
                  {readable(doc.documentType.toLowerCase())} · {new Date(doc.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – {new Date(doc.periodEnd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleConfirm(doc)}
                disabled={busy !== null}
                style={{ padding: '7px 16px', fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, backgroundColor: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '4px', cursor: busy ? 'default' : 'pointer' }}
              >
                {busy === doc.documentId ? 'Saving…' : 'Confirm'}
              </button>
            </div>
            <div style={{ padding: spacing[2] }}>
              {doc.fields.map((f) => {
                const low = f.confidenceScore < confidenceThreshold
                return (
                  <div key={f.fieldName} style={{ display: 'flex', alignItems: 'center', gap: spacing[2], padding: `8px ${spacing[2]}`, backgroundColor: f.flagged || low ? colours.amberBg : 'transparent', borderRadius: '4px', marginBottom: '4px' }}>
                    <div style={{ flex: '0 0 220px' }}>
                      <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, textTransform: 'capitalize' }}>{readable(f.fieldName)}</div>
                      {(f.flagged || low) && (
                        <div style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.amber }}>
                          {f.flagReason ?? `We weren't sure - please check (${(f.confidenceScore * 100).toFixed(0)}%)`}
                        </div>
                      )}
                    </div>
                    <input
                      value={values[doc.documentId]?.[f.fieldName] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [doc.documentId]: { ...v[doc.documentId], [f.fieldName]: e.target.value } }))}
                      style={{ flex: 1, padding: '7px 10px', fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, border: `1px solid ${colours.border}`, borderRadius: '4px', backgroundColor: colours.surface }}
                    />
                    <span style={{ flex: '0 0 70px', fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary }}>{f.unit ?? ''}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
