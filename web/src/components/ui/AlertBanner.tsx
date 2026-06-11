interface AlertBannerProps {
  message: React.ReactNode;
  variant?: "amber" | "info";
}

export default function AlertBanner({ message, variant = "amber" }: AlertBannerProps) {
  const borderColor =
    variant === "info" ? "var(--color-navy)" : "var(--color-amber)";
  const bgColor =
    variant === "info"
      ? "rgba(27, 47, 74, 0.04)"
      : "rgba(138, 60, 10, 0.04)";

  return (
    <div
      style={{
        backgroundColor: bgColor,
        borderLeft:      `3px solid ${borderColor}`,
        borderRadius:    "0 6px 6px 0",
        padding:         "var(--space-16) var(--space-24)",
        marginBottom:    "var(--space-24)",
      }}
    >
      <p
        style={{
          fontSize:   "var(--text-sm)",
          fontWeight: 300,
          color:      "var(--color-text-secondary)",
          lineHeight: 1.6,
          margin:     0,
        }}
      >
        {message}
      </p>
    </div>
  );
}
