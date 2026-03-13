/**
 * AlertBanner — page-level notification strip
 *
 * Sits at the top of any page. Never dismissible — the user must act.
 * Three severity levels: warning | error | info.
 * Each communicates via colour, icon, and text — never colour alone.
 */

interface AlertBannerProps {
  severity: "warning" | "error" | "info";
  message:  string;
  ctaLabel: string;
  onCta:    () => void;
}

const CONFIG = {
  warning: {
    bg:     "var(--alert-warning-bg)",
    border: "var(--alert-warning-border)",
    text:   "var(--alert-warning-text)",
    label:  "Warning",
    icon:   (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2L2 20h20L12 2z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <line x1="12" y1="9" x2="12" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17.5" r="0.75" fill="currentColor" />
      </svg>
    ),
    role: "alert" as const,
  },
  error: {
    bg:     "var(--alert-error-bg)",
    border: "var(--alert-error-border)",
    text:   "var(--alert-error-text)",
    label:  "Error",
    icon:   (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="0.75" fill="currentColor" />
      </svg>
    ),
    role: "alert" as const,
  },
  info: {
    bg:     "var(--alert-info-bg)",
    border: "var(--alert-info-border)",
    text:   "var(--alert-info-text)",
    label:  "Information",
    icon:   (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="7.5" r="0.75" fill="currentColor" />
      </svg>
    ),
    role: "status" as const,
  },
} satisfies Record<
  "warning" | "error" | "info",
  {
    bg: string; border: string; text: string; label: string;
    icon: React.ReactNode; role: "alert" | "status";
  }
>;

export function AlertBanner({ severity, message, ctaLabel, onCta }: AlertBannerProps) {
  const c = CONFIG[severity];

  return (
    <div
      role={c.role}
      aria-label={`${c.label}: ${message}`}
      style={{
        display:         "flex",
        alignItems:      "center",
        gap:             "var(--space-3)",
        padding:         "var(--space-3) var(--space-5)",
        backgroundColor: c.bg,
        borderBottom:    `2px solid ${c.border}`,
        color:           c.text,
        fontFamily:      "var(--font-sans)",
        fontSize:        "var(--text-sm)",
        lineHeight:      "var(--leading-normal)",
        /* Full width strip — positioned by the parent page layout */
        width:           "100%",
        boxSizing:       "border-box" as const,
        flexWrap:        "wrap" as const,
        minHeight:       "var(--touch-min)",
      }}
    >
      {/* Icon — second visual channel beyond colour */}
      <span
        style={{
          display:    "flex",
          alignItems: "center",
          flexShrink: 0,
          color:      c.text,
        }}
      >
        {c.icon}
      </span>

      {/* Severity label — bold prefix */}
      <span
        style={{
          fontWeight: "var(--font-weight-semibold)",
          flexShrink: 0,
          color:      c.text,
        }}
      >
        {c.label}:
      </span>

      {/* Message */}
      <span
        style={{
          flex:       1,
          color:      c.text,
          minWidth:   "120px",
        }}
      >
        {message}
      </span>

      {/* CTA — user must act; no dismiss button */}
      <button
        type="button"
        onClick={onCta}
        style={{
          display:         "inline-flex",
          alignItems:      "center",
          padding:         "0 var(--space-4)",
          minHeight:       "var(--touch-min)",
          minWidth:        "80px",
          borderRadius:    "var(--radius-md)",
          border:          `1px solid ${c.border}`,
          backgroundColor: "transparent",
          color:           c.text,
          fontFamily:      "var(--font-sans)",
          fontSize:        "var(--text-sm)",
          fontWeight:      "var(--font-weight-semibold)",
          cursor:          "pointer",
          flexShrink:      0,
          transition:      "background-color var(--transition-fast)",
          outline:         "none",
          whiteSpace:      "nowrap" as const,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = c.bg;
          (e.currentTarget as HTMLButtonElement).style.opacity = "0.8";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
          (e.currentTarget as HTMLButtonElement).style.opacity = "1";
        }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
