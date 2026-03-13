/**
 * SkeletonRow — animated loading placeholder matching CaseRow dimensions
 *
 * Uses CSS animation only (cbam-shimmer keyframe defined in tokens.css).
 * No animation libraries. Respects prefers-reduced-motion via the
 * .skeleton-shimmer class which collapses to a static fill.
 *
 * Renders an aria-hidden container so screen readers skip loading artefacts.
 * Wrap a set of SkeletonRows in a region with aria-label="Loading cases…"
 * and aria-busy="true" so assistive technology announces the loading state.
 */

interface SkeletonRowProps {
  /** Index used to vary widths so repeated rows don't look identical. */
  index?: number;
}

/* Three width patterns — cycle through them for visual variety */
const TITLE_WIDTHS  = ["60%", "45%", "55%"];
const SUB_WIDTHS    = ["40%", "50%", "35%"];

export function SkeletonRow({ index = 0 }: SkeletonRowProps) {
  const titleW = TITLE_WIDTHS[index % TITLE_WIDTHS.length];
  const subW   = SUB_WIDTHS[index % SUB_WIDTHS.length];

  /* Base style shared across all skeleton blocks */
  const block = (
    w: string | number,
    h: string | number,
    extraStyle?: React.CSSProperties
  ): React.CSSProperties => ({
    width:           w,
    height:          h,
    borderRadius:    "var(--radius-sm)",
    flexShrink:      0,
    ...extraStyle,
  });

  return (
    <div
      aria-hidden="true"
      style={{
        display:         "flex",
        alignItems:      "center",
        gap:             "var(--space-4)",
        minHeight:       "var(--touch-row)",       /* 56px — matches CaseRow  */
        padding:         "var(--space-3) var(--space-5)",
        backgroundColor: "var(--color-surface)",
        borderBottom:    "1px solid var(--color-border)",
        borderLeft:      "4px solid transparent",
        boxSizing:       "border-box" as const,
        width:           "100%",
      }}
    >
      {/* Status dot area — fixed 110px matching CaseRow */}
      <div style={{ flexShrink: 0, minWidth: "110px", display: "flex", alignItems: "center", gap: "6px" }}>
        <div
          className="skeleton-shimmer"
          style={block("10px", "10px", { borderRadius: "var(--radius-full)" })}
        />
        <div className="skeleton-shimmer" style={block("64px", "12px")} />
      </div>

      {/* Text block — takes remaining space */}
      <div
        style={{
          flex:          1,
          display:       "flex",
          flexDirection: "column",
          gap:           "6px",
          overflow:      "hidden",
          minWidth:      0,
        }}
      >
        {/* Case ID */}
        <div className="skeleton-shimmer" style={block("80px", "10px")} />
        {/* Title */}
        <div className="skeleton-shimmer" style={block(titleW, "14px")} />
        {/* Subtitle */}
        <div className="skeleton-shimmer" style={block(subW, "10px")} />
      </div>

      {/* Action button placeholder */}
      <div
        className="skeleton-shimmer"
        style={block("80px", "var(--touch-min)", {
          borderRadius: "var(--radius-md)",
          flexShrink:   0,
        })}
      />
    </div>
  );
}

/**
 * SkeletonList — convenience wrapper that renders N skeleton rows.
 *
 * Usage:
 *   <SkeletonList count={5} />
 */
interface SkeletonListProps {
  count?: number;
}

export function SkeletonList({ count = 5 }: SkeletonListProps) {
  return (
    <div
      role="status"
      aria-label="Loading cases…"
      aria-busy="true"
      style={{
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        overflow:     "hidden",
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} index={i} />
      ))}
      {/* Screen reader announcement */}
      <span className="sr-only">Loading, please wait.</span>
    </div>
  );
}
