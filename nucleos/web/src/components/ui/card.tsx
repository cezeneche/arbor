import { type HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds elevation shadow — only for interactive/clickable cards */
  interactive?: boolean;
  padding?: string;
}

/**
 * Card — Rams spec:
 *   Radius 8px, border 0.5px, background surface (#FFFFFF), padding 32px.
 *   Elevation shadow only on interactive (clickable) cards.
 */
export function Card({ interactive, padding, style, children, ...props }: CardProps) {
  return (
    <div
      style={{
        backgroundColor: "var(--color-surface)",
        border:          "var(--border-width) solid var(--color-border)",
        borderRadius:    "var(--card-radius)",
        padding:         padding ?? "var(--card-padding)",
        boxShadow:       interactive ? "var(--card-shadow)" : "none",
        cursor:          interactive ? "pointer" : "default",
        transition:      interactive ? "box-shadow var(--transition-fast)" : undefined,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
