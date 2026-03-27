"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuthContext } from "@/lib/auth/AuthProvider";

/**
 * TopBar — brand spec:
 *   56px tall. Left: wordmark "nucleos" — Inter 300, tight tracking, #141414.
 *   Centre: Cases · Review · Registration · Insights nav links.
 *   Right: "Upload →" (navy, 500), user first name, Sign out.
 *
 *   Mobile (<768px): wordmark at same size. Centre nav hidden.
 *   User name + sign out accessible via tap on account area.
 *   No hamburger. No icon alongside the wordmark.
 */

const NAV_LINKS = [
  { label: "Cases",        href: "/" },
  { label: "Review",       href: "/review" },
  { label: "Registration", href: "/registration" },
  { label: "Insights",     href: "/insights" },
] as const;

export function TopBar() {
  const { user, signOut } = useAuthContext();
  const pathname = usePathname();
  const firstName = user?.name?.split(" ")[0] ?? user?.sub?.split("@")[0] ?? "";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header
      style={{
        height:          "var(--topbar-height)",
        backgroundColor: "var(--color-surface)",
        borderBottom:    "var(--border-width) solid var(--color-border)",
        position:        "sticky",
        top:             0,
        zIndex:          100,
      }}
    >
      <div
        className="page-content"
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          width:          "100%",
          height:         "100%",
          paddingTop:     0,
          paddingBottom:  0,
        }}
      >
        {/* ── Left: wordmark ───────────────────────────────────────── */}
        <Link href="/" aria-label="nucleos" style={{ flexShrink: 0, textDecoration: "none" }}>
          <span style={{
            fontSize:      "15px",
            fontWeight:    300,
            color:         "var(--color-text-primary)",
            letterSpacing: "-0.03em",
            lineHeight:    1,
            fontFamily:    "inherit",
          }}>
            nucleos
          </span>
        </Link>

        {/* ── Centre: primary nav (desktop only) ───────────────────── */}
        <nav className="topbar-nav" aria-label="Primary navigation">
          {NAV_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              style={{
                fontSize:      "var(--text-sm)",
                fontWeight:    isActive(href) ? "var(--font-focal)" : "var(--font-body)",
                color:         isActive(href)
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
                textDecoration: "none",
                transition:    "color var(--transition-fast)",
                paddingBottom: isActive(href) ? "2px" : "0",
                borderBottom:  isActive(href)
                  ? "var(--border-width) solid var(--color-navy)"
                  : "var(--border-width) solid transparent",
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* ── Right: upload CTA + user ──────────────────────────────── */}
        <div
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        "var(--space-24)",
            flexShrink: 0,
          }}
        >
          <Link
            href="/upload"
            className="topbar-upload"
            style={{
              fontSize:   "var(--text-base)",
              fontWeight: "var(--font-focal)",
              color:      "var(--color-navy)",
              textDecoration: "none",
            }}
          >
            Upload →
          </Link>

          {/* Desktop: name + sign out inline */}
          <div className="topbar-user-desktop" style={{ display: "flex", alignItems: "center", gap: "var(--space-16)" }}>
            {firstName && (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                {firstName}
              </span>
            )}
            <button
              onClick={signOut}
              style={{
                fontSize:   "var(--text-sm)",
                color:      "var(--color-text-secondary)",
                background: "none",
                border:     "none",
                cursor:     "pointer",
                padding:    0,
                fontFamily: "inherit",
                fontWeight: "var(--font-body)",
                transition: "color var(--transition-fast)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)"; }}
            >
              Sign out
            </button>
          </div>

          {/* Mobile: tap to reveal account panel */}
          <button
            className="topbar-user-mobile"
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-expanded={mobileMenuOpen}
            aria-label="Account menu"
            style={{
              background: "none",
              border:     "none",
              cursor:     "pointer",
              padding:    0,
              display:    "none", // shown via CSS
              fontSize:   "var(--text-sm)",
              color:      "var(--color-text-secondary)",
              fontFamily: "inherit",
              fontWeight: "var(--font-body)",
            }}
          >
            {firstName || "Account"}
          </button>
        </div>
      </div>

      {/* ── Mobile account dropdown (no hamburger — account only) ── */}
      {mobileMenuOpen && (
        <div
          className="topbar-mobile-menu"
          style={{
            position:        "absolute",
            top:             "var(--topbar-height)",
            right:           0,
            left:            0,
            backgroundColor: "var(--color-surface)",
            borderBottom:    "var(--border-width) solid var(--color-border)",
            padding:         "var(--space-16) var(--space-24)",
            display:         "flex",
            flexDirection:   "column",
            gap:             "var(--space-16)",
            zIndex:          99,
          }}
        >
          {/* Mobile nav links */}
          {NAV_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileMenuOpen(false)}
              style={{
                fontSize:   "var(--text-base)",
                fontWeight: isActive(href) ? "var(--font-focal)" : "var(--font-body)",
                color:      isActive(href) ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                textDecoration: "none",
              }}
            >
              {label}
            </Link>
          ))}

          <div style={{ borderTop: "var(--border-width) solid var(--color-border)", paddingTop: "var(--space-16)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {firstName && (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                {firstName}
              </span>
            )}
            <button
              onClick={() => { setMobileMenuOpen(false); signOut(); }}
              style={{
                fontSize:   "var(--text-sm)",
                color:      "var(--color-text-secondary)",
                background: "none",
                border:     "none",
                cursor:     "pointer",
                padding:    0,
                fontFamily: "inherit",
                fontWeight: "var(--font-body)",
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* ── Responsive CSS ────────────────────────────────────────────── */}
      <style>{`
        .topbar-nav          { display: flex; gap: var(--space-32); align-items: center; }
        .topbar-upload       { display: inline; }
        .topbar-user-desktop { display: flex; }
        .topbar-user-mobile  { display: none !important; }

        @media (max-width: 768px) {
          .topbar-nav          { display: none; }
          .topbar-upload       { display: none; }
          .topbar-user-desktop { display: none !important; }
          .topbar-user-mobile  { display: inline !important; }
        }
      `}</style>
    </header>
  );
}
