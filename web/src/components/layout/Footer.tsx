import Link from "next/link";
import { brand } from "@/lib/design-system";

/**
 * Footer — brand spec:
 *   Left: "nucleos" wordmark — Inter 300, 13px, --color-text-tertiary.
 *         One-line product description beneath it (from brand spec voice rules).
 *   Right: Privacy · Terms. Copyright line.
 *   No tagline. No icon. No marketing copy.
 */
export function Footer() {
  return (
    <footer
      style={{
        borderTop:       "var(--border-width) solid var(--color-border)",
        paddingTop:      "var(--space-32)",
        paddingBottom:   "var(--space-32)",
        backgroundColor: "var(--color-bg)",
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
            fontWeight:    300,
            color:         "var(--color-text-tertiary)",
            letterSpacing: "-0.03em",
            lineHeight:    1,
            fontFamily:    "inherit",
          }}>
            nucleos
          </span>
          <p
            style={{
              fontSize:   "var(--text-xs)",
              color:      "var(--color-text-tertiary)",
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
                color:          "var(--color-text-tertiary)",
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
                color:          "var(--color-text-tertiary)",
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
              color:      "var(--color-text-tertiary)",
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
