"use client";

import Link from "next/link";
import { useAuthContext } from "@/lib/auth/AuthProvider";

/**
 * TopBar — Rams spec:
 *   56px tall. Left: "Nucleos" logotype. Right: "Upload documents →" (navy, 500),
 *   user first name (13px secondary), "Sign out" (13px secondary).
 *   No sidebar. No icons. No hamburger.
 */
export function TopBar() {
  const { user, signOut } = useAuthContext();
  const firstName = user?.name?.split(" ")[0] ?? user?.sub ?? "";

  return (
    <header
      style={{
        height:          "var(--topbar-height)",
        backgroundColor: "var(--color-surface)",
        borderBottom:    "var(--border-width) solid var(--color-border)",
        display:         "flex",
        alignItems:      "center",
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
          paddingTop:     0,
          paddingBottom:  0,
        }}
      >
        {/* Logotype */}
        <Link
          href="/"
          style={{
            fontSize:      "var(--text-base)",
            fontWeight:    "var(--font-focal)",
            color:         "var(--color-text-primary)",
            letterSpacing: "var(--tracking-body)",
          }}
        >
          Nucleos
        </Link>

        {/* Right side */}
        <nav
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        "var(--space-32)",
          }}
        >
          <Link
            href="/upload"
            style={{
              fontSize:   "var(--text-base)",
              fontWeight: "var(--font-focal)",
              color:      "var(--color-navy)",
            }}
          >
            Upload documents →
          </Link>

          {firstName && (
            <span
              style={{
                fontSize: "var(--text-sm)",
                color:    "var(--color-text-secondary)",
              }}
            >
              {firstName}
            </span>
          )}

          <button
            onClick={signOut}
            style={{
              fontSize:        "var(--text-sm)",
              color:           "var(--color-text-secondary)",
              background:      "none",
              border:          "none",
              cursor:          "pointer",
              padding:         0,
              fontFamily:      "inherit",
              fontWeight:      "var(--font-body)",
              transition:      "color var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
            }}
          >
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
