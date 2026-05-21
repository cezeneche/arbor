import type { StatusVariant } from "@/lib/design-system";

interface BadgeProps {
  variant?: StatusVariant;
  children: React.ReactNode;
}

const variantStyles: Record<StatusVariant, { color: string; background: string }> = {
  approved: { color: "var(--color-green)", background: "var(--color-green-bg)" },
  pending:  { color: "var(--color-amber)", background: "var(--color-amber-bg)" },
  error:    { color: "var(--color-red)",   background: "var(--color-red-bg)"   },
  draft:    { color: "var(--color-text-secondary)", background: "var(--color-bg)" },
};

/**
 * Badge — Rams spec:
 *   Radius 4px (not pill). Font 11px weight 500. Padding 3px 8px.
 *   Colours communicate status only — never decoration.
 */
export function Badge({ variant = "draft", children }: BadgeProps) {
  const { color, background } = variantStyles[variant];

  return (
    <span
      style={{
        display:         "inline-flex",
        alignItems:      "center",
        paddingTop:      "var(--badge-py)",
        paddingBottom:   "var(--badge-py)",
        paddingLeft:     "var(--badge-px)",
        paddingRight:    "var(--badge-px)",
        borderRadius:    "var(--badge-radius)",
        fontSize:        "var(--text-xs)",
        fontWeight:      "var(--font-focal)",
        lineHeight:      1.4,
        color,
        backgroundColor: background,
        whiteSpace:      "nowrap",
      }}
    >
      {children}
    </span>
  );
}
