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
  const label = t.manual ? 'Confirmed' : style.label

  const intervalText =
    detail && t.interval
      ? ` · ${Math.round(t.interval.low * 100)}–${Math.round(t.interval.high * 100)}%`
      : ''
  const title = t.manual
    ? 'Confirmed by you'
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
      {t.manual ? label : `${label} · ${pct}%${intervalText}`}
    </span>
  )
}
