/**
 * MetricCard — single KPI / metric display card
 *
 * Structure: muted label above → large value → optional unit and trend.
 * Alert state adds an amber left border and warning indicator.
 */

interface MetricCardProps {
  label:  string;
  value:  string | number;
  unit?:  string;
  trend?: "up" | "down" | "neutral";
  alert?: boolean;
  /** Whether the card is clickable (renders a button) */
  onClick?: () => void;
}

const TREND_ICON: Record<"up" | "down" | "neutral", string> = {
  up:      "↑",
  down:    "↓",
  neutral: "—",
};

const TREND_LABEL: Record<"up" | "down" | "neutral", string> = {
  up:      "Trending up",
  down:    "Trending down",
  neutral: "No change",
};

const TREND_COLOUR: Record<"up" | "down" | "neutral", string> = {
  up:      "var(--color-approved-text)",
  down:    "var(--color-error-text)",
  neutral: "var(--color-text-muted)",
};

export function MetricCard({
  label,
  value,
  unit,
  trend,
  alert = false,
  onClick,
}: MetricCardProps) {
  const Tag = onClick ? "button" : "div";

  const containerStyle: React.CSSProperties = {
    display:         "flex",
    flexDirection:   "column",
    justifyContent:  "space-between",
    gap:             "var(--space-2)",
    backgroundColor: "var(--color-surface)",
    border:          `1px solid ${alert ? "var(--color-pending-border)" : "var(--color-border)"}`,
    borderLeft:      alert
      ? "4px solid var(--color-pending)"
      : `1px solid var(--color-border)`,
    borderRadius:    "var(--radius-lg)",
    padding:         "var(--space-5) var(--space-6)",
    minHeight:       "80px",
    width:           "100%",
    textAlign:       "left" as const,
    cursor:          onClick ? "pointer" : "default",
    transition:      "box-shadow var(--transition-fast)",
    fontFamily:      "inherit",
    outline:         "none",
    boxSizing:       "border-box" as const,
  };

  function handleMouseEnter(e: React.MouseEvent<HTMLElement>) {
    if (onClick) {
      (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-md)";
    }
  }
  function handleMouseLeave(e: React.MouseEvent<HTMLElement>) {
    (e.currentTarget as HTMLElement).style.boxShadow = "none";
  }

  const content = (
    <>
      {/* Row: label + optional alert badge */}
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          gap:            "var(--space-2)",
        }}
      >
        <span
          style={{
            fontSize:      "var(--text-xs)",
            fontWeight:    "var(--font-weight-semibold)",
            color:         "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-wide)",
            lineHeight:    "var(--leading-normal)",
          }}
        >
          {label}
        </span>

        {alert && (
          <span
            aria-label="Attention required"
            style={{
              display:         "inline-flex",
              alignItems:      "center",
              justifyContent:  "center",
              width:           "18px",
              height:          "18px",
              borderRadius:    "var(--radius-full)",
              backgroundColor: "var(--color-pending-bg)",
              border:          "1px solid var(--color-pending-border)",
              fontSize:        "10px",
              fontWeight:      "var(--font-weight-bold)",
              color:           "var(--color-pending-text)",
              flexShrink:      0,
              lineHeight:      1,
            }}
          >
            !
          </span>
        )}
      </div>

      {/* Value + unit */}
      <div
        style={{
          display:    "flex",
          alignItems: "baseline",
          gap:        "var(--space-1)",
          flexWrap:   "wrap" as const,
        }}
      >
        <span
          style={{
            fontSize:    "var(--text-3xl)",
            fontWeight:  "var(--font-weight-bold)",
            color:       "var(--color-text-primary)",
            lineHeight:  "var(--leading-tight)",
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontSize:   "var(--text-sm)",
              fontWeight: "var(--font-weight-medium)",
              color:      "var(--color-text-secondary)",
            }}
          >
            {unit}
          </span>
        )}
      </div>

      {/* Trend */}
      {trend && (
        <div
          aria-label={TREND_LABEL[trend]}
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        "4px",
            fontSize:   "var(--text-xs)",
            fontWeight: "var(--font-weight-medium)",
            color:      TREND_COLOUR[trend],
          }}
        >
          <span aria-hidden="true" style={{ fontSize: "var(--text-sm)" }}>
            {TREND_ICON[trend]}
          </span>
          <span>{TREND_LABEL[trend]}</span>
        </div>
      )}
    </>
  );

  return (
    <Tag
      style={containerStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...(onClick ? { onClick, type: "button" as const } : {})}
    >
      {content}
    </Tag>
  );
}
