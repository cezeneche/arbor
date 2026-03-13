"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* ── Icons ─────────────────────────────────────────────────────────────────── */

function IconLeaf() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2C8 2 4 6 4 12c0 4 2.5 7.5 8 8 0-4 1-7 4-10C19 7 21 4 20 2c-2 0-4.5 1-8 0z"
        stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
      <path d="M4 20c2-2 4-4 8-8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  );
}

function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3"  y="3"  width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="13" y="3"  width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="3"  y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
    </svg>
  );
}

function IconBarChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3"  y="12" width="4" height="9" rx="1" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="10" y="7"  width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="17" y="3"  width="4" height="18" rx="1" stroke="currentColor" strokeWidth="1.75"/>
    </svg>
  );
}

function IconShieldCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2L4 6v6c0 5 3.6 9.2 8 10 4.4-.8 8-5 8-10V6L12 2z"
        stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
      <path
        d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Nav config ─────────────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", Icon: IconDashboard },
  { href: "/insights",  label: "Insights",  Icon: IconBarChart  },
  { href: "/audit",     label: "Audit",     Icon: IconShieldCheck },
  { href: "/settings",  label: "Settings",  Icon: IconGear      },
] as const;

/* ── User avatar ────────────────────────────────────────────────────────────── */

function initials(sub: string, tenantId: string): string {
  const a = (sub?.trim()[0] ?? "U").toUpperCase();
  const b = (tenantId?.trim()[0] ?? "O").toUpperCase();
  return a + b;
}

/* ── Props ──────────────────────────────────────────────────────────────────── */

interface SidebarProps {
  sub:       string;
  tenantId:  string;
  /** Mobile drawer: true = show overlay */
  drawerOpen:    boolean;
  onDrawerClose: () => void;
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function Sidebar({ sub, tenantId, drawerOpen, onDrawerClose }: SidebarProps) {
  const pathname = usePathname();

  /* Resolve active route — /dashboard matches both /dashboard and / */
  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
    return pathname.startsWith(href);
  }

  const sidebarContent = (
    <nav
      aria-label="Main navigation"
      style={{
        display:        "flex",
        flexDirection:  "column",
        height:         "100%",
        backgroundColor:"var(--color-surface)",
        borderRight:    "1px solid var(--color-border)",
      }}
    >
      {/* ── Brand ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display:     "flex",
          alignItems:  "center",
          gap:         "var(--space-3)",
          padding:     "var(--space-5) var(--space-4)",
          borderBottom:"1px solid var(--color-border)",
          flexShrink:   0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
            width:           "32px",
            height:          "32px",
            borderRadius:    "var(--radius-lg)",
            backgroundColor: "var(--color-accent-subtle)",
            border:          "1px solid var(--color-accent-border)",
            color:           "var(--color-accent)",
            flexShrink:      0,
          }}
        >
          <IconLeaf />
        </span>
        {/* Text hidden on tablet (icon-only mode) via CSS class */}
        <div className="sidebar-wordmark">
          <p
            style={{
              margin:      0,
              fontSize:    "var(--text-sm)",
              fontWeight:  "var(--font-weight-semibold)",
              color:       "var(--color-text-primary)",
              lineHeight:  "var(--leading-snug)",
              whiteSpace:  "nowrap",
            }}
          >
            CBAM Platform
          </p>
          <p
            style={{
              margin:      0,
              fontSize:    "11px",
              color:       "var(--color-text-muted)",
              lineHeight:  "var(--leading-normal)",
              whiteSpace:  "nowrap",
            }}
          >
            EU 2023/956
          </p>
        </div>
      </div>

      {/* ── Nav items ─────────────────────────────────────────────────────── */}
      <ul
        role="list"
        style={{
          flex:       1,
          padding:    "var(--space-3) var(--space-2)",
          margin:     0,
          listStyle:  "none",
          display:    "flex",
          flexDirection:"column",
          gap:        "var(--space-1)",
          overflowY:  "auto",
        }}
      >
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={onDrawerClose}
                style={{
                  display:        "flex",
                  alignItems:     "center",
                  gap:            "var(--space-3)",
                  minHeight:      "var(--touch-min)",   /* 48px */
                  padding:        "0 var(--space-3)",
                  borderRadius:   "var(--radius-md)",
                  textDecoration: "none",
                  fontFamily:     "var(--font-sans)",
                  fontSize:       "var(--text-sm)",
                  fontWeight:     active
                    ? "var(--font-weight-semibold)"
                    : "var(--font-weight-medium)",
                  color: active
                    ? "var(--color-accent-text)"
                    : "var(--color-text-secondary)",
                  backgroundColor: active
                    ? "var(--color-accent-subtle)"
                    : "transparent",
                  /* Active indicator: teal left border. Uses box-shadow
                     so it doesn't affect layout (avoids padding shift). */
                  boxShadow: active
                    ? "inset 3px 0 0 var(--color-accent)"
                    : "none",
                  transition: "background-color var(--transition-fast), color var(--transition-fast)",
                  position:   "relative",
                  overflow:   "hidden",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
                      "var(--color-surface-raised)";
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "var(--color-text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
                      "transparent";
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "var(--color-text-secondary)";
                  }
                }}
              >
                <span
                  style={{
                    display:    "flex",
                    alignItems: "center",
                    flexShrink: 0,
                    color:      "inherit",
                  }}
                >
                  <Icon />
                </span>
                <span className="sidebar-label">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* ── User ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display:     "flex",
          alignItems:  "center",
          gap:         "var(--space-3)",
          padding:     "var(--space-4)",
          borderTop:   "1px solid var(--color-border)",
          flexShrink:  0,
        }}
      >
        {/* Avatar circle with initials */}
        <span
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
            userSelect:      "none",
            letterSpacing:   "var(--tracking-wide)",
          }}
        >
          {initials(sub, tenantId)}
        </span>

        <div className="sidebar-wordmark" style={{ overflow: "hidden", minWidth: 0 }}>
          <p
            style={{
              margin:      0,
              fontSize:    "var(--text-xs)",
              fontWeight:  "var(--font-weight-semibold)",
              color:       "var(--color-text-primary)",
              lineHeight:  "var(--leading-snug)",
              overflow:    "hidden",
              textOverflow:"ellipsis",
              whiteSpace:  "nowrap",
            }}
          >
            {sub}
          </p>
          <p
            style={{
              margin:      0,
              fontSize:    "11px",
              color:       "var(--color-text-muted)",
              lineHeight:  "var(--leading-normal)",
              overflow:    "hidden",
              textOverflow:"ellipsis",
              whiteSpace:  "nowrap",
              fontFamily:  "var(--font-mono)",
            }}
          >
            {tenantId}
          </p>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      {/*
       * Desktop + tablet sidebar (md and up).
       * Width switches from 56px (icon-only) at md to 220px at lg.
       * .sidebar-label and .sidebar-wordmark are hidden on icon-only mode
       * via the <style> tag in PortalShell.
       */}
      <aside
        className="sidebar-fixed"
        aria-label="Sidebar navigation"
        style={{ height: "100%" }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer --------------------------------------------------- */}
      {drawerOpen && (
        <>
          {/* Dim backdrop — tapping closes the drawer */}
          <div
            aria-hidden="true"
            onClick={onDrawerClose}
            style={{
              position:        "fixed",
              inset:           0,
              backgroundColor: "rgba(0,0,0,0.6)",
              zIndex:          "var(--z-overlay)",
            }}
          />

          {/* Drawer panel */}
          <div
            role="dialog"
            aria-label="Navigation menu"
            aria-modal="true"
            style={{
              position:   "fixed",
              top:        0,
              left:       0,
              bottom:     0,
              width:      "220px",
              zIndex:     "var(--z-modal)",
              boxShadow:  "var(--shadow-lg)",
            }}
          >
            {sidebarContent}
          </div>
        </>
      )}
    </>
  );
}
