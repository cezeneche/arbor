"use client";

import { usePathname } from "next/navigation";

/* ── Hamburger icon ─────────────────────────────────────────────────────────── */

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line x1="3" y1="7"  x2="21" y2="7"  stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <line x1="3" y1="17" x2="21" y2="17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Page title resolution ──────────────────────────────────────────────────── */

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/insights":  "Insights",
  "/audit":     "Audit",
  "/settings":  "Settings",
};

function pageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  for (const [prefix, title] of Object.entries(TITLES)) {
    if (pathname.startsWith(prefix)) return title;
  }
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/* ── Props ──────────────────────────────────────────────────────────────────── */

interface TopBarProps {
  sub:        string;
  tenantId:   string;
  onMenuOpen: () => void;
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function TopBar({ sub, tenantId, onMenuOpen }: TopBarProps) {
  const pathname = usePathname();
  const title = pageTitle(pathname);

  const monogram =
    (sub?.trim()[0] ?? "U").toUpperCase() +
    (tenantId?.trim()[0] ?? "O").toUpperCase();

  return (
    /*
     * .topbar-mobile — shown on mobile only (<md), hidden at md+ breakpoint.
     * Controlled by the <style> block in PortalShell.
     */
    <header
      className="topbar-mobile"
      style={{
        position:        "sticky",
        top:             0,
        zIndex:          "var(--z-sticky)" as React.CSSProperties["zIndex"],
        display:         "flex",
        alignItems:      "center",
        gap:             "var(--space-3)",
        height:          "56px",
        padding:         "0 var(--space-4)",
        backgroundColor: "var(--color-surface)",
        borderBottom:    "1px solid var(--color-border)",
        boxSizing:       "border-box" as const,
      }}
    >
      {/* Hamburger — 48×48px touch target */}
      <button
        type="button"
        aria-label="Open navigation menu"
        onClick={onMenuOpen}
        style={{
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          width:           "var(--touch-min)",
          height:          "var(--touch-min)",
          borderRadius:    "var(--radius-md)",
          border:          "none",
          backgroundColor: "transparent",
          color:           "var(--color-text-secondary)",
          cursor:          "pointer",
          flexShrink:      0,
          transition:      "background-color var(--transition-fast)",
          outline:         "none",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "var(--color-surface-raised)";
          (e.currentTarget as HTMLButtonElement).style.color =
            "var(--color-text-primary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
        }}
      >
        <IconMenu />
      </button>

      {/* Page title — centred between hamburger and avatar */}
      <h1
        style={{
          flex:         1,
          margin:       0,
          fontSize:     "var(--text-base)",
          fontWeight:   "var(--font-weight-semibold)",
          color:        "var(--color-text-primary)",
          lineHeight:   "var(--leading-tight)",
          textAlign:    "center",
          whiteSpace:   "nowrap",
          overflow:     "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </h1>

      {/* User avatar — initials circle */}
      <div
        aria-hidden="true"
        title={`${sub} · ${tenantId}`}
        style={{
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          width:           "32px",
          height:          "32px",
          borderRadius:    "var(--radius-full)",
          backgroundColor: "var(--color-accent-subtle)",
          border:          "1px solid var(--color-accent-border)",
          color:           "var(--color-accent-text)",
          fontSize:        "11px",
          fontWeight:      "var(--font-weight-bold)",
          fontFamily:      "var(--font-sans)",
          flexShrink:      0,
          userSelect:      "none" as const,
          letterSpacing:   "var(--tracking-wide)",
        }}
      >
        {monogram}
      </div>
    </header>
  );
}
