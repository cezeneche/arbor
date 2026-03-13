/**
 * CaseRow — full-width list row for CBAM cases
 *
 * Layout: StatusDot (left) → text block (center, flex-1) → action button (right).
 * Min height: 56px (--touch-row).
 * Flagged rows get a 4px amber left border — a second visual channel beyond the dot.
 */

import { StatusDot, type StatusValue } from "./StatusDot";

interface CaseRowProps {
  caseId:      string;
  title:       string;
  subtitle?:   string;
  status:      StatusValue;
  actionLabel: string;
  onClick:     () => void;
}

export function CaseRow({
  caseId,
  title,
  subtitle,
  status,
  actionLabel,
  onClick,
}: CaseRowProps) {
  const isFlagged = status === "flagged";

  return (
    <div
      style={{
        display:         "flex",
        alignItems:      "center",
        gap:             "var(--space-4)",
        minHeight:       "var(--touch-row)",
        padding:         "var(--space-3) var(--space-5)",
        backgroundColor: "var(--color-surface)",
        borderBottom:    "1px solid var(--color-border)",
        borderLeft:      isFlagged
          ? "4px solid var(--color-flagged)"
          : "4px solid transparent",
        boxSizing:       "border-box" as const,
        transition:      "background-color var(--transition-fast)",
        width:           "100%",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor =
          "var(--color-surface-raised)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor =
          "var(--color-surface)";
      }}
    >
      {/* Status indicator */}
      <div
        style={{
          flexShrink: 0,
          minWidth:   "110px",
        }}
      >
        <StatusDot status={status} size="sm" />
      </div>

      {/* Case ID + title + subtitle */}
      <div
        style={{
          flex:          1,
          display:       "flex",
          flexDirection: "column",
          gap:           "2px",
          overflow:      "hidden",
          minWidth:      0,
        }}
      >
        {/* Case ID */}
        <span
          style={{
            fontSize:    "var(--text-xs)",
            fontWeight:  "var(--font-weight-medium)",
            color:       "var(--color-text-muted)",
            fontFamily:  "var(--font-mono)",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase" as const,
          }}
        >
          {caseId}
        </span>

        {/* Title */}
        <span
          style={{
            fontSize:    "var(--text-base)",
            fontWeight:  "var(--font-weight-semibold)",
            color:       "var(--color-text-primary)",
            lineHeight:  "var(--leading-snug)",
            overflow:    "hidden",
            textOverflow:"ellipsis",
            whiteSpace:  "nowrap" as const,
          }}
        >
          {title}
        </span>

        {/* Subtitle */}
        {subtitle && (
          <span
            style={{
              fontSize:   "var(--text-xs)",
              color:      "var(--color-text-secondary)",
              lineHeight: "var(--leading-normal)",
              overflow:   "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap" as const,
            }}
          >
            {subtitle}
          </span>
        )}
      </div>

      {/* Action button — min 48×48px touch target */}
      <button
        type="button"
        onClick={onClick}
        aria-label={`${actionLabel} for case ${caseId}`}
        style={{
          display:         "inline-flex",
          alignItems:      "center",
          justifyContent:  "center",
          flexShrink:      0,
          minHeight:       "var(--touch-min)",
          padding:         "0 var(--space-4)",
          borderRadius:    "var(--radius-md)",
          border:          "1px solid var(--color-accent-border)",
          backgroundColor: "transparent",
          color:           "var(--color-accent-text)",
          fontFamily:      "var(--font-sans)",
          fontSize:        "var(--text-sm)",
          fontWeight:      "var(--font-weight-semibold)",
          cursor:          "pointer",
          whiteSpace:      "nowrap" as const,
          transition:      "background-color var(--transition-fast)",
          outline:         "none",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "var(--color-accent-subtle)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "transparent";
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
