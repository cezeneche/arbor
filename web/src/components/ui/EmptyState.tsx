/**
 * EmptyState — centred placeholder for lists with no data
 *
 * Shows a simple inbox icon, a title, a descriptive message,
 * and an optional CTA button. Designed to reassure users
 * rather than confuse them when a list is genuinely empty.
 */

interface EmptyStateProps {
  title:     string;
  message:   string;
  ctaLabel?: string;
  onCta?:    () => void;
}

export function EmptyState({ title, message, ctaLabel, onCta }: EmptyStateProps) {
  const hasCta = Boolean(ctaLabel && onCta);

  return (
    <div
      style={{
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        textAlign:      "center",
        padding:        "var(--space-16) var(--space-6)",
        gap:            "var(--space-4)",
        width:          "100%",
        minHeight:      "240px",
        fontFamily:     "var(--font-sans)",
        boxSizing:      "border-box" as const,
      }}
    >
      {/* Icon */}
      <span
        aria-hidden="true"
        style={{
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          width:           "56px",
          height:          "56px",
          borderRadius:    "var(--radius-xl)",
          backgroundColor: "var(--color-surface-raised)",
          border:          "1px solid var(--color-border)",
          color:           "var(--color-text-muted)",
          flexShrink:      0,
        }}
      >
        {/* Inbox / tray icon — neutral, non-alarming */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="11" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 11l2.5-7h13L21 11" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 15h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>

      {/* Title */}
      <h3
        style={{
          margin:      0,
          fontSize:    "var(--text-lg)",
          fontWeight:  "var(--font-weight-semibold)",
          color:       "var(--color-text-primary)",
          lineHeight:  "var(--leading-snug)",
        }}
      >
        {title}
      </h3>

      {/* Message */}
      <p
        style={{
          margin:    0,
          fontSize:  "var(--text-base)",
          color:     "var(--color-text-secondary)",
          lineHeight:"var(--leading-relaxed)",
          maxWidth:  "400px",
        }}
      >
        {message}
      </p>

      {/* Optional CTA */}
      {hasCta && (
        <button
          type="button"
          onClick={onCta}
          style={{
            display:         "inline-flex",
            alignItems:      "center",
            justifyContent:  "center",
            marginTop:       "var(--space-2)",
            minHeight:       "var(--touch-min)",
            padding:         "0 var(--space-6)",
            borderRadius:    "var(--radius-lg)",
            border:          "none",
            backgroundColor: "var(--color-accent)",
            color:           "var(--color-text-on-accent)",
            fontFamily:      "var(--font-sans)",
            fontSize:        "var(--text-base)",
            fontWeight:      "var(--font-weight-semibold)",
            cursor:          "pointer",
            transition:      "background-color var(--transition-fast)",
            outline:         "none",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "var(--color-accent-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "var(--color-accent)";
          }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
