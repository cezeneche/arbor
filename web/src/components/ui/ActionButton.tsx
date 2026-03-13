/**
 * ActionButton — large primary / secondary action button
 *
 * Min 52px on desktop, 48px on mobile (WCAG 2.5.5).
 * Optional icon on the left, label + sublabel stacked vertically.
 */

import type { ReactNode } from "react";

interface ActionButtonProps {
  label:     string;
  sublabel?: string;
  variant:   "primary" | "secondary";
  onClick:   () => void;
  icon?:     ReactNode;
  disabled?: boolean;
  type?:     "button" | "submit" | "reset";
}

export function ActionButton({
  label,
  sublabel,
  variant,
  onClick,
  icon,
  disabled = false,
  type = "button",
}: ActionButtonProps) {
  const isPrimary = variant === "primary";

  const base: React.CSSProperties = {
    display:        "inline-flex",
    alignItems:     "center",
    justifyContent: "center",
    gap:            "10px",
    /* Desktop: 52px. Mobile: 48px via media query not available inline,
       so we set 52px and rely on min-height from the class below.         */
    minHeight:      "var(--touch-large)",
    paddingLeft:    "var(--space-5)",
    paddingRight:   "var(--space-5)",
    borderRadius:   "var(--radius-lg)",
    border:         "none",
    cursor:         disabled ? "not-allowed" : "pointer",
    opacity:        disabled ? 0.5 : 1,
    fontFamily:     "var(--font-sans)",
    fontSize:       "var(--text-base)",
    fontWeight:     "var(--font-weight-semibold)",
    lineHeight:     "var(--leading-normal)",
    textAlign:      "left" as const,
    transition:     "background-color var(--transition-fast), box-shadow var(--transition-fast)",
    width:          "100%",
    /* Primary: filled teal. Secondary: bordered ghost.                    */
    backgroundColor: isPrimary
      ? "var(--color-accent)"
      : "transparent",
    color: isPrimary
      ? "var(--color-text-on-accent)"
      : "var(--color-accent-text)",
    boxShadow:   isPrimary ? "var(--shadow-sm)" : "none",
    outline:     "none",
  };

  const borderStyle: React.CSSProperties = isPrimary
    ? {}
    : {
        border: "1px solid var(--color-accent-border)",
      };

  function handleMouseEnter(e: React.MouseEvent<HTMLButtonElement>) {
    if (disabled) return;
    (e.currentTarget as HTMLButtonElement).style.backgroundColor = isPrimary
      ? "var(--color-accent-hover)"
      : "var(--color-accent-subtle)";
    if (isPrimary) {
      (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-md)";
    }
  }

  function handleMouseLeave(e: React.MouseEvent<HTMLButtonElement>) {
    (e.currentTarget as HTMLButtonElement).style.backgroundColor = isPrimary
      ? "var(--color-accent)"
      : "transparent";
    if (isPrimary) {
      (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-sm)";
    }
  }

  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      style={{ ...base, ...borderStyle }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      /* Mobile override: min-height 48px via className */
      className="action-btn"
    >
      {icon && (
        <span
          aria-hidden="true"
          style={{
            display:    "flex",
            alignItems: "center",
            flexShrink: 0,
            width:      "20px",
            height:     "20px",
          }}
        >
          {icon}
        </span>
      )}

      <span
        style={{
          display:       "flex",
          flexDirection: "column",
          alignItems:    "flex-start",
          gap:           "2px",
        }}
      >
        <span>{label}</span>
        {sublabel && (
          <span
            style={{
              fontSize:   "var(--text-xs)",
              fontWeight: "var(--font-weight-regular)",
              opacity:    0.75,
              lineHeight: "var(--leading-normal)",
            }}
          >
            {sublabel}
          </span>
        )}
      </span>
    </button>
  );
}
