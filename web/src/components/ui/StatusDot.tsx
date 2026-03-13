/**
 * StatusDot — coloured dot + text label
 *
 * Status is communicated via BOTH colour and text — never colour alone.
 * Accessible to users with colour-vision deficiencies.
 */

export type StatusValue =
  | "approved"
  | "pending"
  | "processing"
  | "error"
  | "flagged";

interface StatusDotProps {
  status: StatusValue;
  /** Dot + text size. Defaults to "md". */
  size?: "sm" | "md";
  /** Override the displayed text. Defaults to the capitalised status name. */
  label?: string;
}

const DOT_COLOUR: Record<StatusValue, string> = {
  approved:   "var(--color-approved)",
  pending:    "var(--color-pending)",
  processing: "var(--color-processing)",
  error:      "var(--color-error)",
  flagged:    "var(--color-flagged)",
};

const TEXT_COLOUR: Record<StatusValue, string> = {
  approved:   "var(--color-approved-text)",
  pending:    "var(--color-pending-text)",
  processing: "var(--color-processing-text)",
  error:      "var(--color-error-text)",
  flagged:    "var(--color-flagged-text)",
};

const DEFAULT_LABEL: Record<StatusValue, string> = {
  approved:   "Approved",
  pending:    "Pending",
  processing: "Processing",
  error:      "Error",
  flagged:    "Flagged",
};

export function StatusDot({ status, size = "md", label }: StatusDotProps) {
  const dotPx    = size === "sm" ? "8px"  : "10px";
  const fontSize = size === "sm" ? "var(--text-xs)" : "var(--text-sm)";
  const displayLabel = label ?? DEFAULT_LABEL[status];

  return (
    <span
      style={{
        display:    "inline-flex",
        alignItems: "center",
        gap:        "6px",
        fontSize,
        fontWeight: "var(--font-weight-medium)",
        color:      TEXT_COLOUR[status],
        lineHeight: "var(--leading-normal)",
        whiteSpace: "nowrap",
      }}
    >
      {/* Dot is aria-hidden — text label carries the meaning for screen readers */}
      <span
        aria-hidden="true"
        style={{
          display:         "inline-block",
          width:           dotPx,
          height:          dotPx,
          borderRadius:    "var(--radius-full)",
          backgroundColor: DOT_COLOUR[status],
          flexShrink:      0,
        }}
      />
      {displayLabel}
    </span>
  );
}
