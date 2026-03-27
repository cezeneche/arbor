import Link from "next/link";
import { NucleosMark } from "@/components/ui/NucleosMark";
import { brand } from "@/lib/design-system";

/**
 * Footer — brand spec:
 *   Left: NucleosMark at footerSizePx (20px) — smallest permitted size.
 *         One-line product description beneath it.
 *   Right: Privacy · Terms (links). Copyright line.
 *
 *   No tagline. No marketing copy. Voice description only.
 *   Quiet, correct, consistent.
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
        {/* Left: mark + description */}
        <div>
          <NucleosMark variant="wordmark" colour="navy" size={brand.mark.footerSizePx} />
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
