import { colours, typography } from '@/lib/design-system'
import { trustDisplay, type TrustBand } from '@/lib/confidence/trust-display'
import type { ConfidencePosterior } from '@/lib/confidence/types'

// the field-level confidence badge. Colour and label are driven by
// the calibrated trust classifier, so a low-confidence field can never render
// identically to a high-confidence one. `detail` adds the credible interval and
// calibration note for buyer/technical screens; suppliers see the plain form.
const BAND_STYLE: Record<TrustBand, { colour: string; bg: string; label: string }> = {
  high: { colour: colours.green, bg: colours.greenBg, label: 'High' },
  moderate: { colour: colours.amber, bg: colours.amberBg, label: 'Moderate' },
  low: { colour: colours.red, bg: colours.redBg, label: 'Low' },
}

export function TrustIndicator({
  confidenceScore,
  confidencePosterior,
  detail = false,
}: {
  confidenceScore: number
  confidencePosterior?: ConfidencePosterior | null
  detail?: boolean
}) {
  const t = trustDisplay({ confidenceScore, confidencePosterior })
  const style = BAND_STYLE[t.band]
  const pct = Math.round(t.value * 100)
  // "Confirmed" sat next to a Verified / Declared certification badge and read
  // as the same scale, and as stronger than Declared. It is a different axis:
  // where the value came from, not how sure the reader was.
  const label = t.manual ? 'Entered by you' : style.label

  const range = t.interval
    ? `${Math.round(t.interval.low * 100)}–${Math.round(t.interval.high * 100)}%`
    : null

  // Never print the number the band just overruled. "Moderate · 100%" states a
  // figure the classifier rejected; the interval is the actual claim.
  const figure = t.overruled && range ? range : `${pct}%${detail && range ? ` · ${range}` : ''}`

  const title = t.manual
    ? 'Entered by you, not read from a document'
    : `${t.summary}${
        t.interval
          ? ` (calibrated; ${Math.round(t.interval.mass * 100)}% interval ${Math.round(
              t.interval.low * 100,
            )}–${Math.round(t.interval.high * 100)}%)`
          : t.calibrated
            ? ' (calibrated)'
            : ' (model estimate, not yet calibrated)'
      }`

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.medium,
        letterSpacing: typography.tracking.wide,
        color: style.colour,
        backgroundColor: style.bg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: style.colour }}
      />
      {t.manual ? label : `${label} · ${figure}`}
    </span>
  )
}
