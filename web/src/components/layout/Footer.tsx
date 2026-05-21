import Link from "next/link";
import { brand } from "@/lib/design-system";

export function Footer() {
  return (
    <footer
      style={{
        borderTop:       "0.5px solid var(--color-border)",
        paddingTop:      "var(--space-32)",
        paddingBottom:   "var(--space-32)",
        backgroundColor: "var(--color-footer-bg)",
      }}
    >
      <div
        className="page-content"
        style={{
          display:        "flex",
          alignItems:     "flex-start",
          justifyContent: "space-between",
          gap:            "var(--space-24)",
          flexWrap:       "wrap",
          paddingTop:     0,
          paddingBottom:  0,
        }}
      >
        {/* Left: wordmark + description */}
        <div>
          <span style={{
            fontSize:      "var(--text-sm)",
            fontWeight:    500,
            color:         "var(--color-text-primary)",
            letterSpacing: "-0.03em",
            lineHeight:    1,
            fontFamily:    "inherit",
          }}>
            nucleos
          </span>
          <p
            style={{
              fontSize:   "var(--text-xs)",
              color:      "var(--color-text-secondary)",
              fontWeight: "var(--font-body)",
              marginTop:  "var(--space-8)",
            }}
          >
            {brand.description}
          </p>
        </div>

        {/* Right: links + copyright */}
        <div
          style={{
            display:       "flex",
            flexDirection: "column",
            alignItems:    "flex-end",
            gap:           "var(--space-8)",
          }}
        >
          <div style={{ display: "flex", gap: "var(--space-16)" }}>
            <Link
              href="/privacy"
              style={{
                fontSize:       "var(--text-xs)",
                color:          "var(--color-text-secondary)",
                fontWeight:     "var(--font-body)",
                textDecoration: "none",
              }}
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              style={{
                fontSize:       "var(--text-xs)",
                color:          "var(--color-text-secondary)",
                fontWeight:     "var(--font-body)",
                textDecoration: "none",
              }}
            >
              Terms
            </Link>
          </div>
          <p
            style={{
              fontSize:   "var(--text-xs)",
              color:      "var(--color-text-secondary)",
              fontWeight: "var(--font-body)",
            }}
          >
            © {brand.copyrightYear} {brand.legalName}
          </p>
        </div>
      </div>
    </footer>
  );
}
