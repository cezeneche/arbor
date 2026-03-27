"use client";

/**
 * NucleosMark — the Nucleos brand mark.
 *
 * The geometric N whose two diagonals converge at a weighted centre point.
 * That convergence is the visual expression of what the product does:
 * many inputs resolved to one number.
 *
 * Two variants:
 *   icon      — the N mark alone. Use in TopBar (mobile), favicon context,
 *               and anywhere space is constrained.
 *   wordmark  — the N mark + "Nucleos" wordmark beside it. Use in TopBar
 *               (desktop), auth pages, homepage hero.
 *
 * Colour:
 *   navy      — default. Use on white/light backgrounds (auth, homepage).
 *   white     — use on navy/dark backgrounds.
 *
 * Size constraints (from brand.mark in design-system.ts):
 *   Never render below 16px. The component enforces a floor.
 *
 * Rules enforced in code (cannot be overridden by callers):
 *   - Flat stroke terminals (no rounded caps)
 *   - Fixed stroke-width ratio relative to size
 *   - Convergence point at weighted centre (not geometric centre)
 *   - Colour restricted to navy or white — no other values
 */

import { brand } from "@/lib/design-system";

type MarkColour = "navy" | "white";
type MarkVariant = "icon" | "wordmark";

interface NucleosMarkProps {
  /** Render just the N mark, or the N mark + wordmark. Default: "wordmark". */
  variant?: MarkVariant;
  /** Mark colour. Default: "navy". */
  colour?: MarkColour;
  /** Height of the mark in px. The width scales proportionally.
   *  Minimum enforced: brand.mark.minSizePx (16px). */
  size?: number;
  className?: string;
}

const COLOUR_MAP: Record<MarkColour, string> = {
  navy:  "var(--color-navy)",
  white: "#ffffff",
};

export function NucleosMark({
  variant = "wordmark",
  colour  = "navy",
  size    = brand.mark.navSizePx,
  className,
}: NucleosMarkProps) {
  // Enforce minimum size — never render below brand floor
  const h = Math.max(size, brand.mark.minSizePx);
  const fill = COLOUR_MAP[colour];

  // The N mark SVG.
  // Viewbox: 100 × 120 (5:6 ratio — tall N proportion)
  // Stroke-width scales with height so terminals stay sharp at all sizes.
  // The convergence point sits at 42% of height (not 50%) — weighted centre.
  // Flat stroke terminals: stroke-linecap="butt", stroke-linejoin="miter"
  const markWidth = Math.round(h * (5 / 6));
  const sw = Math.max(1, h * 0.09); // stroke-width as proportion of height

  const NMark = (
    <svg
      width={markWidth}
      height={h}
      viewBox="0 0 50 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/*
        The N:
        Left stroke  — top-left (5,4) down to bottom-left (5,56)
        Right stroke — top-right (45,4) down to bottom-right (45,56)
        Diagonal     — top-left (5,4) → convergence point (28,25) → bottom-right (45,56)

        Convergence at (28,25): 56% across, 42% down — weighted centre.
        The diagonal is two line segments meeting at the convergence point,
        creating a subtle kink that makes the mark identifiable at small sizes.
      */}
      <polyline
        points="5,4 5,56"
        stroke={fill}
        strokeWidth={sw}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <polyline
        points="45,4 45,56"
        stroke={fill}
        strokeWidth={sw}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      {/* Diagonal: two segments meeting at convergence point */}
      <polyline
        points="5,4 28,25 45,56"
        stroke={fill}
        strokeWidth={sw}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );

  if (variant === "icon") {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", alignItems: "center" }}
        aria-label={brand.name}
        role="img"
      >
        {NMark}
      </span>
    );
  }

  // Wordmark: mark + "Nucleos" text
  const fontSize = Math.round(h * 0.52);
  const gap      = Math.round(h * 0.35);

  return (
    <span
      className={className}
      style={{
        display:    "inline-flex",
        alignItems: "center",
        gap:        `${gap}px`,
      }}
      aria-label={brand.name}
      role="img"
    >
      {NMark}
      <span
        style={{
          fontFamily:  "var(--font-inter)",
          fontSize:    `${fontSize}px`,
          fontWeight:  500,
          color:       fill,
          letterSpacing: "-0.02em",
          lineHeight:  1,
          userSelect:  "none",
        }}
        aria-hidden="true"
      >
        {brand.name}
      </span>
    </span>
  );
}
