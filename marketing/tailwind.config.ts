import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        xs:   ["11px", { lineHeight: "1.6" }],
        sm:   ["13px", { lineHeight: "1.6" }],
        base: ["15px", { lineHeight: "1.6" }],
        lg:   ["24px", { lineHeight: "1.1" }],
        hero: ["52px", { lineHeight: "1.1" }],
        "hero-xl": ["72px", { lineHeight: "1.0" }],
      },
      colors: {
        bg:               "var(--color-bg)",
        surface:          "var(--color-surface)",
        navy:             "var(--color-navy)",
        "navy-hover":     "var(--color-navy-hover)",
        "footer-bg":      "var(--color-footer-bg)",
        "text-primary":   "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary":  "var(--color-text-tertiary)",
        border:           "var(--color-border)",
        green:            "var(--color-green)",
        amber:            "var(--color-amber)",
        red:              "var(--color-red)",
        "green-bg":       "var(--color-green-bg)",
        "amber-bg":       "var(--color-amber-bg)",
        "red-bg":         "var(--color-red-bg)",
      },
      maxWidth: {
        content: "var(--max-width)",
        "content-wide": "1120px",
      },
      height: {
        topbar: "var(--topbar-height)",
        btn:    "var(--btn-height)",
        input:  "var(--input-height)",
      },
      borderRadius: {
        btn:   "var(--btn-radius)",
        input: "var(--input-radius)",
        card:  "var(--card-radius)",
        badge: "var(--badge-radius)",
      },
      boxShadow: {
        card: "var(--card-shadow)",
      },
      spacing: {
        "18": "72px",
        "22": "88px",
      },
    },
  },
  plugins: [],
};

export default config;
