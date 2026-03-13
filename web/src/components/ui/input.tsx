/**
 * Input — CBAM Portal design system
 *
 * DESIGN DECISIONS
 * - Height is min-h-[48px] — touch target minimum. This is intentionally
 *   taller than a typical web input (34–40px) to support tablet users.
 * - Font size 16px: critical on iOS — inputs with <16px trigger auto-zoom,
 *   which is disorienting for non-technical users on tablets.
 * - Error state shows a red border + red ring on focus, plus an optional
 *   error message below. Error is conveyed via border colour AND an explicit
 *   text message — never by colour alone.
 * - Hint text uses neutral-600 (7.0:1 on white — AAA) rather than neutral-400.
 *   Muted-grey hint text that fails contrast is a common accessibility failure.
 * - Label is always visible (no placeholder-as-label anti-pattern).
 *   Placeholder is supplemental only.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/* ─── Raw input element ──────────────────────────────────────────────────── */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        /* Layout */
        "flex w-full rounded-md",
        /* Sizing — 48px height, 16px text (prevents iOS zoom)              */
        "min-h-[48px] px-4 py-3 text-base",
        /* Colours */
        "border border-neutral-300 bg-neutral-0 text-neutral-900",
        "placeholder:text-neutral-400",
        /* Focus */
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-teal-700",
        /* Disabled */
        "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 disabled:border-neutral-200",
        /* Transition */
        "transition-colors duration-100",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

/* ─── Composed field: Label + Input + Hint + Error ──────────────────────── */
export interface InputFieldProps extends React.ComponentProps<"input"> {
  label: string;
  hint?: string;
  error?: string;
  /* id is required on InputField so the label is always associated        */
  id: string;
}

function InputField({ label, hint, error, id, className, ...inputProps }: InputFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-medium text-neutral-800 leading-none"
      >
        {label}
        {inputProps.required && (
          <span className="ml-1 text-[var(--error-text)]" aria-label="required">
            *
          </span>
        )}
      </label>

      <Input
        id={id}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? "true" : undefined}
        className={cn(
          error && "border-[var(--error-text)] focus-visible:ring-[var(--error-text)]",
          className
        )}
        {...inputProps}
      />

      {/* Hint: neutral-600 text — 7.0:1 contrast ✓ AAA */}
      {hint && !error && (
        <p id={hintId} className="text-xs text-neutral-600 leading-snug">
          {hint}
        </p>
      )}

      {/* Error: red text + role=alert so screen readers announce immediately */}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[var(--error-text)] leading-snug font-medium"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export { Input, InputField };
