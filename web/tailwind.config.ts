/**
 * CBAM Portal — Tailwind Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Every design token from tokens.css is mapped to a Tailwind utility.
 * shadcn/ui HSL vars (--primary, --background, etc.) are preserved so Radix
 * primitives continue to work; they are remapped to the dark palette in
 * globals.css.
 *
 * TOUCH-TARGET NOTE
 * h-12 (48px) is the minimum for interactive elements.
 * h-[52px]   is the height of primary CTA buttons.
 * h-14 (56px) is the minimum height of list rows.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      /* ── COLOURS ─────────────────────────────────────────────────────────── */
      colors: {
        /* shadcn HSL-var bridge — consumed by Radix primitives               */
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input:  "hsl(var(--input))",
        ring:   "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT:              "hsl(var(--sidebar-background))",
          foreground:           "hsl(var(--sidebar-foreground))",
          primary:              "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent:               "hsl(var(--sidebar-accent))",
          "accent-foreground":  "hsl(var(--sidebar-accent-foreground))",
          border:               "hsl(var(--sidebar-border))",
          ring:                 "hsl(var(--sidebar-ring))",
        },

        /* ── CBAM SEMANTIC TOKEN COLOURS ─────────────────────────────────── */

        /* Page structure */
        page:            "var(--color-page)",
        surface:         "var(--color-surface)",
        "surface-raised":"var(--color-surface-raised)",
        "border-default":"var(--color-border)",

        /* Text */
        "text-primary":   "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted":     "var(--color-text-muted)",
        "text-on-accent": "var(--color-text-on-accent)",

        /* Accent */
        "cbam-accent":       "var(--color-accent)",
        "cbam-accent-hover": "var(--color-accent-hover)",
        "cbam-accent-text":  "var(--color-accent-text)",

        /* Status: approved */
        approved: {
          DEFAULT: "var(--color-approved)",
          text:    "var(--color-approved-text)",
          bg:      "var(--color-approved-bg)",
          border:  "var(--color-approved-border)",
        },

        /* Status: pending */
        pending: {
          DEFAULT: "var(--color-pending)",
          text:    "var(--color-pending-text)",
          bg:      "var(--color-pending-bg)",
          border:  "var(--color-pending-border)",
        },

        /* Status: processing */
        processing: {
          DEFAULT: "var(--color-processing)",
          text:    "var(--color-processing-text)",
          bg:      "var(--color-processing-bg)",
          border:  "var(--color-processing-border)",
        },

        /* Status: error */
        "cbam-error": {
          DEFAULT: "var(--color-error)",
          text:    "var(--color-error-text)",
          bg:      "var(--color-error-bg)",
          border:  "var(--color-error-border)",
        },

        /* Status: flagged */
        flagged: {
          DEFAULT: "var(--color-flagged)",
          text:    "var(--color-flagged-text)",
          bg:      "var(--color-flagged-bg)",
          border:  "var(--color-flagged-border)",
        },

        /* Badge variants */
        "badge-method": {
          bg:     "var(--badge-method-bg)",
          text:   "var(--badge-method-text)",
          border: "var(--badge-method-border)",
        },
        "badge-sector": {
          bg:     "var(--badge-sector-bg)",
          text:   "var(--badge-sector-text)",
          border: "var(--badge-sector-border)",
        },
        "badge-quarter": {
          bg:     "var(--badge-quarter-bg)",
          text:   "var(--badge-quarter-text)",
          border: "var(--badge-quarter-border)",
        },

        /* Alert severities */
        "alert-warning": {
          bg:     "var(--alert-warning-bg)",
          border: "var(--alert-warning-border)",
          text:   "var(--alert-warning-text)",
        },
        "alert-error": {
          bg:     "var(--alert-error-bg)",
          border: "var(--alert-error-border)",
          text:   "var(--alert-error-text)",
        },
        "alert-info": {
          bg:     "var(--alert-info-bg)",
          border: "var(--alert-info-border)",
          text:   "var(--alert-info-text)",
        },

        /* Skeleton */
        "skeleton-base":  "var(--skeleton-base)",
        "skeleton-shine": "var(--skeleton-shine)",
      },

      /* ── BORDER RADIUS ────────────────────────────────────────────────────── */
      borderRadius: {
        none: "0px",
        sm:   "var(--radius-sm)",
        md:   "var(--radius-md)",
        DEFAULT: "var(--radius-md)",
        lg:   "var(--radius-lg)",
        xl:   "var(--radius-xl)",
        full: "var(--radius-full)",
      },

      /* ── SHADOWS ──────────────────────────────────────────────────────────── */
      boxShadow: {
        xs:      "var(--shadow-xs)",
        sm:      "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md:      "var(--shadow-md)",
        lg:      "var(--shadow-lg)",
        none:    "none",
      },

      /* ── TYPOGRAPHY ───────────────────────────────────────────────────────── */
      fontFamily: {
        sans: [
          "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont",
          "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif",
        ],
        mono: [
          "ui-monospace", "SFMono-Regular", "SF Mono", "Consolas",
          "Liberation Mono", "Menlo", "monospace",
        ],
      },
      fontSize: {
        /* 14px is the hard minimum for any visible text                       */
        xs:    ["0.875rem",  { lineHeight: "1.5" }],    /* 14px absolute min  */
        sm:    ["0.9375rem", { lineHeight: "1.5" }],    /* 15px               */
        base:  ["1rem",      { lineHeight: "1.65" }],   /* 16px body default  */
        lg:    ["1.125rem",  { lineHeight: "1.5" }],    /* 18px               */
        xl:    ["1.25rem",   { lineHeight: "1.4" }],    /* 20px               */
        "2xl": ["1.5rem",    { lineHeight: "1.3" }],    /* 24px               */
        "3xl": ["1.875rem",  { lineHeight: "1.2" }],    /* 30px               */
        "4xl": ["2.25rem",   { lineHeight: "1.15" }],   /* 36px metrics       */
      },

      /* ── LAYOUT ───────────────────────────────────────────────────────────── */
      minHeight: {
        touch:  "48px",    /* WCAG 2.5.5 minimum touch target                 */
        cta:    "52px",    /* Primary button height                            */
        row:    "56px",    /* List row minimum                                 */
        topnav: "64px",
      },
      height: {
        touch:  "48px",
        cta:    "52px",
        row:    "56px",
        topnav: "64px",
      },
      width: {
        sidebar: "240px",
        touch:   "48px",
      },
      maxWidth: {
        content: "1200px",
      },

      /* ── TRANSITIONS ──────────────────────────────────────────────────────── */
      transitionDuration: {
        fast:   "80ms",
        normal: "150ms",
        slow:   "250ms",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
