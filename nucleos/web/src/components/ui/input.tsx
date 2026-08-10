"use client";

import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

/**
 * Input — Rams spec:
 *   Height 40px, border 0.5px solid --color-border, radius 6px.
 *   Focus: border-color navy, no glow.
 *   Error: border red, message below in 11px red.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, label, id, style, ...props }, ref) => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {label && (
          <label
            htmlFor={id}
            style={{
              fontSize:   "var(--text-sm)",
              fontWeight: "var(--font-body)",
              color:      "var(--color-text-secondary)",
            }}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          style={{
            height:          "var(--input-height)",
            paddingLeft:     "var(--space-16)",
            paddingRight:    "var(--space-16)",
            borderRadius:    "var(--input-radius)",
            border:          `var(--border-width) solid ${error ? "var(--color-red)" : "var(--color-border)"}`,
            backgroundColor: "var(--color-surface)",
            color:           "var(--color-text-primary)",
            fontSize:        "var(--text-base)",
            fontWeight:      "var(--font-body)",
            fontFamily:      "inherit",
            outline:         "none",
            width:           "100%",
            transition:      "border-color var(--transition-fast)",
            ...style,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = error ? "var(--color-red)" : "var(--color-navy)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? "var(--color-red)" : "var(--color-border)";
          }}
          {...props}
        />
        {error && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              color:    "var(--color-red)",
            }}
          >
            {error}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
