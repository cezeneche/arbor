"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

/**
 * Button — Rams spec:
 *   Height 40px, horizontal padding 24px, border-radius 6px.
 *   Primary: navy background, white text.
 *   Secondary: white background, border, primary text.
 *   One primary per screen. Never two.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading, children, disabled, style, ...props }, ref) => {
    const isPrimary = variant === "primary";

    const base: React.CSSProperties = {
      display:        "inline-flex",
      alignItems:     "center",
      justifyContent: "center",
      gap:            "8px",
      height:         "var(--btn-height)",
      paddingLeft:    "var(--btn-px)",
      paddingRight:   "var(--btn-px)",
      borderRadius:   "var(--btn-radius)",
      fontSize:       "var(--text-base)",
      fontWeight:     "var(--font-focal)",
      fontFamily:     "inherit",
      lineHeight:     1,
      cursor:         disabled || loading ? "not-allowed" : "pointer",
      opacity:        disabled || loading ? 0.5 : 1,
      transition:     "background-color var(--transition-fast), color var(--transition-fast)",
      whiteSpace:     "nowrap",
      userSelect:     "none",
      backgroundColor: isPrimary ? "var(--color-navy)" : "var(--color-surface)",
      color:           isPrimary ? "#FFFFFF" : "var(--color-text-primary)",
      border:          isPrimary ? "none" : "var(--border-width) solid var(--color-border)",
      outline:         "none",
      ...style,
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        style={base}
        onMouseEnter={(e) => {
          if (!disabled && !loading && isPrimary) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-hover)";
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled && !loading && isPrimary) {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy)";
          }
        }}
        {...props}
      >
        {loading ? "Processing…" : children}
      </button>
    );
  }
);

Button.displayName = "Button";
