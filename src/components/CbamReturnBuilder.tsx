'use client'

import { useState } from 'react'
import { colours, spacing, textStyles, typography } from '@/lib/design-system'
import type { ReturnFormat } from '@/lib/nucleos/jurisdiction'

// The end of the chain. One primary action: produce the return.
//
// What is offered is decided by the case's jurisdiction, not by a menu — a UK
// importer has no EU registry declaration to file and offering them one would
// be offering something they can never lodge.
//
// The HMRC return asks for three things the case does not hold: the VAT number,
// the postal address, and the accuracy declaration. They are asked for here and
// nowhere else, because the declaration is a statement the importer makes at the
// moment of filing and not a stored preference they could forget having set.
//
// A refusal is shown as a refusal, with the builder's own words. "No published
// rate for this sector" and "the service is down" need different actions, and
// collapsing them into one message would send the user to wait for a service
// that is working.

const LABELS: Record<ReturnFormat, { title: string; action: string; detail: string }> = {
  HMRC_RETURN: {
    title: 'HMRC return',
    action: 'Produce the return',
    detail:
      'The CBAM return you file with HMRC, built from the goods lines and emissions on this case.',
  },
  EU_XML: {
    title: 'EU declaration',
    action: 'Produce the declaration',
    detail:
      'The quarterly XML declaration you lodge with the EU registry, built from this case.',
  },
}

export function CbamReturnBuilder({
  caseId,
  available,
  blocked,
}: {
  caseId: string
  available: ReturnFormat[]
  /** Set when open gaps stop a return being produced. Says which. */
  blocked: string | null
}) {
  const [busy, setBusy] = useState<ReturnFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vat, setVat] = useState('')
  const [address, setAddress] = useState({ line1: '', city: '', postcode: '' })
  const [declared, setDeclared] = useState(false)

  async function produce(format: ReturnFormat) {
    setError(null)

    if (format === 'HMRC_RETURN') {
      if (!vat.trim()) {
        setError('Your VAT number is needed on the return.')
        return
      }
      if (!address.line1.trim() || !address.postcode.trim()) {
        setError('The return needs at least the first line of your address and a postcode.')
        return
      }
      if (!declared) {
        setError('You have to certify that the return is accurate before it can be produced.')
        return
      }
    }

    setBusy(format)
    try {
      const res = await fetch(`/api/cbam/cases/${encodeURIComponent(caseId)}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          ...(format === 'HMRC_RETURN'
            ? {
                importerVatNumber: vat.trim(),
                importerAddress: {
                  line1: address.line1.trim(),
                  city: address.city.trim(),
                  postcode: address.postcode.trim(),
                },
                accuracyDeclaration: true,
              }
            : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'The return could not be produced.')
        return
      }

      // Straight to a download. The bytes are the builder's, unchanged.
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url
      a.download =
        format === 'EU_XML'
          ? `cbam-eu-declaration-${caseId}.xml`
          : `hmrc-cbam-return-${caseId}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('The return could not be produced. Check your connection.')
    } finally {
      setBusy(null)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.light,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    backgroundColor: colours.surface,
    color: colours.textPrimary,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  }

  const needsHmrcDetails = available.includes('HMRC_RETURN')

  return (
    <div>
      {blocked && (
        <p
          style={{
            ...textStyles.sectionSubtitle,
            color: colours.amber,
            marginBottom: spacing[3],
            lineHeight: '1.6',
          }}
        >
          {blocked}
        </p>
      )}

      {needsHmrcDetails && !blocked && (
        <div style={{ marginBottom: spacing[3] }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: spacing[2],
              marginBottom: spacing[2],
            }}
          >
            <div>
              <p style={{ ...textStyles.eyebrow, marginBottom: '4px' }}>VAT number</p>
              <input
                type="text"
                value={vat}
                onChange={e => setVat(e.target.value)}
                placeholder="GB123456789"
                style={inputStyle}
              />
            </div>
            <div>
              <p style={{ ...textStyles.eyebrow, marginBottom: '4px' }}>Address</p>
              <input
                type="text"
                value={address.line1}
                onChange={e => setAddress(a => ({ ...a, line1: e.target.value }))}
                placeholder="1 Mill Road"
                style={inputStyle}
              />
            </div>
            <div>
              <p style={{ ...textStyles.eyebrow, marginBottom: '4px' }}>Town or city</p>
              <input
                type="text"
                value={address.city}
                onChange={e => setAddress(a => ({ ...a, city: e.target.value }))}
                placeholder="Sheffield"
                style={inputStyle}
              />
            </div>
            <div>
              <p style={{ ...textStyles.eyebrow, marginBottom: '4px' }}>Postcode</p>
              <input
                type="text"
                value={address.postcode}
                onChange={e => setAddress(a => ({ ...a, postcode: e.target.value }))}
                placeholder="S1 2AB"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Inline, not a dialog. The design rules forbid modals, and a
              declaration the user cannot see while they make it is worse. */}
          <label
            style={{
              display: 'flex',
              gap: spacing[1],
              alignItems: 'flex-start',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textPrimary,
              lineHeight: '1.6',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={declared}
              onChange={e => setDeclared(e.target.checked)}
              style={{ marginTop: '4px' }}
            />
            <span>
              I certify that the information in this return is correct and complete to the best
              of my knowledge.
            </span>
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: spacing[2], flexWrap: 'wrap' }}>
        {available.map(format => (
          <button
            key={format}
            onClick={() => produce(format)}
            disabled={busy !== null || Boolean(blocked)}
            style={{
              padding: '9px 18px',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              color: colours.surface,
              backgroundColor: blocked ? colours.textTertiary : colours.navy,
              border: 'none',
              borderRadius: '4px',
              cursor: busy || blocked ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              letterSpacing: typography.tracking.wide,
            }}
          >
            {busy === format ? 'Producing…' : LABELS[format].action}
          </button>
        ))}
      </div>

      <p style={{ ...textStyles.caption, marginTop: spacing[2], lineHeight: '1.6' }}>
        {available.map(f => LABELS[f].detail).join(' ')}
      </p>

      {error && (
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.red,
            backgroundColor: colours.redBg,
            padding: '10px 12px',
            borderRadius: '4px',
            marginTop: spacing[2],
            lineHeight: '1.6',
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
