import { colours, spacing, textStyles, typography } from '@/lib/design-system'
import { REGIME_LABEL } from '@/lib/nucleos/jurisdiction'
import type { RegimeCalculation } from '@/lib/nucleos/case-calculation'

// What the goods lines actually declare.
//
// The screen the engine never had. Everything on it comes from the calculation
// result and nothing is re-derived here — in particular the mark-up percentage,
// which lives in Nucleos's versioned table and would drift the moment a second
// copy existed in TypeScript.
//
// Both axes on every line, side by side and equally weighted. `Measured` is how
// the figure was arrived at; `Verified` is how well evidenced the record behind
// it is. They answer different questions and a reviewer needs both — a mill
// certificate is routinely a real measurement on an unverified document.
//
// The rejected methods are not an aside. A declaration has to be able to say
// why it did not use actual data, and that sentence with its regulation
// reference is the answer. It renders as prose, not a collapsed detail.

function Badge({
  label,
  tone,
}: {
  label: string
  tone: 'method' | 'provenance'
}) {
  const isVerified = label === 'Verified'
  const isMeasured = label === 'Measured'
  const colour =
    tone === 'provenance'
      ? isVerified
        ? colours.green
        : label === 'Estimated'
          ? colours.slate
          : colours.amber
      : isMeasured
        ? colours.green
        : label === 'Estimated'
          ? colours.slate
          : colours.amber
  const bg =
    tone === 'provenance'
      ? isVerified
        ? colours.greenBg
        : label === 'Estimated'
          ? colours.slateBg
          : colours.amberBg
      : isMeasured
        ? colours.greenBg
        : label === 'Estimated'
          ? colours.slateBg
          : colours.amberBg

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '3px',
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.medium,
        letterSpacing: typography.tracking.wide,
        color: colour,
        backgroundColor: bg,
      }}
    >
      {label}
    </span>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ ...textStyles.eyebrow, marginBottom: '4px' }}>{label}</p>
      <p style={textStyles.value}>{value}</p>
    </div>
  )
}

export function CbamEmissions({ results }: { results: RegimeCalculation[] }) {
  if (results.length === 0) {
    return (
      <p style={textStyles.sectionSubtitle}>
        No emissions have been worked out for this case yet.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[4] }}>
      {results.map(({ regime, presented, problems }) => (
        <div key={regime}>
          {/* Only named when there is more than one. A single-regime importer
              has no choice to understand. */}
          {results.length > 1 && (
            <p style={{ ...textStyles.eyebrow, marginBottom: spacing[2] }}>
              {REGIME_LABEL[regime]}
            </p>
          )}

          {problems.length > 0 && (
            <ul
              style={{
                margin: `0 0 ${spacing[3]}`,
                paddingLeft: '18px',
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.amber,
                lineHeight: '1.6',
              }}
            >
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}

          {!presented ? null : (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  paddingBottom: spacing[2],
                  borderBottom: `1px solid ${colours.border}`,
                  marginBottom: spacing[3],
                }}
              >
                <div>
                  <p style={{ ...textStyles.eyebrow, marginBottom: '4px' }}>
                    Total embedded emissions
                  </p>
                  <p
                    style={{
                      fontSize: typography.sizes.lg,
                      fontWeight: typography.weights.medium,
                      color: colours.textPrimary,
                      margin: 0,
                      letterSpacing: typography.tracking.tight,
                    }}
                  >
                    {presented.totalEmbedded}
                  </p>
                </div>
                <p style={{ ...textStyles.caption, color: colours.textTertiary }}>
                  {presented.period}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
                {presented.lines.map(line => (
                  <div
                    key={line.lineId}
                    style={{
                      border: `1px solid ${colours.border}`,
                      borderRadius: '6px',
                      padding: spacing[3],
                      backgroundColor: colours.surface,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: spacing[1],
                        alignItems: 'center',
                        marginBottom: spacing[2],
                        flexWrap: 'wrap',
                      }}
                    >
                      <Badge label={line.method} tone="method" />
                      <Badge label={line.provenance} tone="provenance" />
                      <span style={{ ...textStyles.caption, color: colours.textTertiary }}>
                        {line.methodDetail}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: spacing[3],
                      }}
                    >
                      <Figure label="Direct" value={line.direct} />
                      <Figure label="Indirect" value={line.indirect} />
                      <Figure label="Per tonne" value={line.seeTotal} />
                      <Figure label="Embedded" value={line.embedded} />
                    </div>

                    {line.markupNote && (
                      <p
                        style={{
                          ...textStyles.caption,
                          color: colours.amber,
                          marginTop: spacing[2],
                          lineHeight: '1.6',
                        }}
                      >
                        {line.markupNote}
                      </p>
                    )}

                    {line.rejections.length > 0 && (
                      <div style={{ marginTop: spacing[3] }}>
                        <p style={{ ...textStyles.eyebrow, marginBottom: '6px' }}>
                          Why a better figure was not used
                        </p>
                        {line.rejections.map((r, i) => (
                          <p
                            key={i}
                            style={{
                              ...textStyles.caption,
                              color: colours.textPrimary,
                              lineHeight: '1.6',
                              margin: '0 0 4px',
                            }}
                          >
                            <strong style={{ fontWeight: typography.weights.medium }}>
                              {r.method}:
                            </strong>{' '}
                            {r.reason}{' '}
                            <span style={{ color: colours.textTertiary }}>({r.regulationRef})</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {line.warnings.length > 0 && (
                      <ul
                        style={{
                          margin: `${spacing[2]} 0 0`,
                          paddingLeft: '18px',
                          fontSize: typography.sizes.xs,
                          fontWeight: typography.weights.light,
                          color: colours.textTertiary,
                          lineHeight: '1.6',
                        }}
                      >
                        {line.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}

                    {line.trace.length > 0 && (
                      <details style={{ marginTop: spacing[2] }}>
                        <summary
                          style={{
                            ...textStyles.caption,
                            color: colours.navy,
                            cursor: 'pointer',
                          }}
                        >
                          How this figure was reached ({line.trace.length} steps)
                        </summary>
                        <ol
                          style={{
                            margin: `${spacing[1]} 0 0`,
                            paddingLeft: '18px',
                            fontSize: typography.sizes.xs,
                            fontWeight: typography.weights.light,
                            color: colours.textSecondary,
                            lineHeight: '1.7',
                          }}
                        >
                          {line.trace.map((atom, i) => (
                            <li key={i}>
                              <strong style={{ fontWeight: typography.weights.medium }}>
                                {atom.step}
                              </strong>{' '}
                              → {atom.outcome}. {atom.detail}
                              {atom.regulation_ref ? ` (${atom.regulation_ref})` : ''}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                ))}
              </div>

              {presented.warnings.length > 0 && (
                <ul
                  style={{
                    margin: `${spacing[3]} 0 0`,
                    paddingLeft: '18px',
                    fontSize: typography.sizes.xs,
                    fontWeight: typography.weights.light,
                    color: colours.textTertiary,
                    lineHeight: '1.6',
                  }}
                >
                  {presented.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              {/* Which engine and which tables. A figure that cannot name them
                  cannot be reproduced once the tables move on, and regulatory
                  tables are versioned precisely because they do. */}
              <p
                style={{
                  ...textStyles.caption,
                  color: colours.textTertiary,
                  marginTop: spacing[3],
                }}
              >
                {presented.provenanceStamp}
              </p>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
