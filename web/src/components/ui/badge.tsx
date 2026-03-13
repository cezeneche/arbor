/**
 * Badge — domain metadata pill
 *
 * Three variants covering all CBAM metadata categories:
 *   method  — calculation method (actual, estimated, Annex VI default)
 *   sector  — commodity sector (cement, iron_steel, aluminium, fertilisers…)
 *   quarter — reporting period (Q1 2024, Q3 2025…)
 *
 * Contrast: all variants verified ≥ 4.5:1 on their tinted backgrounds (WCAG AA).
 * Tokens from tokens.css — no hardcoded colours.
 */

interface BadgeProps {
  label:   string;
  variant: "method" | "sector" | "quarter";
}

const STYLES: Record<
  "method" | "sector" | "quarter",
  { bg: string; text: string; border: string }
> = {
  method: {
    bg:     "var(--badge-method-bg)",
    text:   "var(--badge-method-text)",
    border: "var(--badge-method-border)",
  },
  sector: {
    bg:     "var(--badge-sector-bg)",
    text:   "var(--badge-sector-text)",
    border: "var(--badge-sector-border)",
  },
  quarter: {
    bg:     "var(--badge-quarter-bg)",
    text:   "var(--badge-quarter-text)",
    border: "var(--badge-quarter-border)",
  },
};

export function Badge({ label, variant }: BadgeProps) {
  const s = STYLES[variant];

  return (
    <span
      style={{
        display:         "inline-flex",
        alignItems:      "center",
        padding:         "2px 8px",
        borderRadius:    "var(--radius-full)",
        border:          `1px solid ${s.border}`,
        backgroundColor: s.bg,
        color:           s.text,
        fontSize:        "var(--text-xs)",          /* 14px — hard minimum */
        fontWeight:      "var(--font-weight-semibold)",
        fontFamily:      "var(--font-sans)",
        lineHeight:      "var(--leading-normal)",
        whiteSpace:      "nowrap" as const,
        letterSpacing:   "var(--tracking-normal)",
      }}
    >
      {label}
    </span>
  );
}

/* Named export only — consuming components should use the named export.
   No default export to avoid ambiguity with shadcn Badge primitives.    */
