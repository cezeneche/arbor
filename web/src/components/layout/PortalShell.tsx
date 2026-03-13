"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/*
 * SIDEBAR WIDTHS
 * ──────────────────────────────────────────────────────────────────────────────
 * Desktop (≥ 1024px):   220px — full sidebar with icon + label
 * Tablet  (768–1023px):  56px — icon-only (labels + wordmark hidden)
 * Mobile  (<  768px):     0px — sidebar hidden; TopBar shown instead
 */
const W_FULL = "220px";
const W_ICON = "56px";

/* ── Props ──────────────────────────────────────────────────────────────────── */

interface PortalShellProps {
  children: React.ReactNode;
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function PortalShell({ children }: PortalShellProps) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [user, setUser] = useState<{ sub: string; tenantId: string } | null>(null);

  /* ── Auth guard — runs once on mount ─────────────────────────────────────── */
  useEffect(() => {
    const ctx = getAuthContext();
    if (!ctx) {
      router.replace("/login");
      return;
    }
    setUser({ sub: ctx.sub ?? "user", tenantId: ctx.tenant_id ?? "org" });
  }, [router]);

  /* Close drawer on Escape */
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  /* Prevent scrolling body while drawer is open on mobile */
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  /* Show nothing while verifying auth — prevents flash of unauthenticated UI */
  if (!user) return null;

  const { sub, tenantId } = user;

  return (
    <>
      {/*
       * SCOPED RESPONSIVE STYLES
       * ────────────────────────────────────────────────────────────────────────
       * A single <style> block manages all breakpoint-sensitive layout rules.
       * Classes are:
       *   .sidebar-fixed    — the fixed sidebar element
       *   .sidebar-label    — nav item text labels (hidden on tablet)
       *   .sidebar-wordmark — brand text + user info text (hidden on tablet)
       *   .topbar-mobile    — top bar header (shown on mobile only)
       *   .portal-main      — the right-hand content column
       */}
      <style>{`
        /* ── Mobile default (< 640px): sidebar hidden, TopBar visible ── */
        .sidebar-fixed    { display: none; position: fixed; top: 0; left: 0; bottom: 0; z-index: 40; }
        .sidebar-label    { display: block; }
        .sidebar-wordmark { display: block; }
        .topbar-mobile    { display: flex; }
        .portal-main      { margin-left: 0; }

        /* ── Tablet (640px – 1023px): icon-only sidebar ── */
        @media (min-width: 640px) {
          .sidebar-fixed    { display: block; width: ${W_ICON}; }
          .sidebar-label    { display: none; }
          .sidebar-wordmark { display: none; }
          .topbar-mobile    { display: none !important; }
          .portal-main      { margin-left: ${W_ICON}; }
        }

        /* ── Desktop (≥ 1024px): full sidebar with labels ── */
        @media (min-width: 1024px) {
          .sidebar-fixed    { width: ${W_FULL}; }
          .sidebar-label    { display: block; }
          .sidebar-wordmark { display: block; }
          .portal-main      { margin-left: ${W_FULL}; }
        }
      `}</style>

      {/* Skip to content — first focusable element; revealed on focus */}
      <a
        href="#main-content"
        style={{
          position:        "fixed",
          top:             "-100px",
          left:            "var(--space-4)",
          zIndex:          500 as React.CSSProperties["zIndex"],
          padding:         "var(--space-2) var(--space-5)",
          borderRadius:    "var(--radius-md)",
          backgroundColor: "var(--color-accent)",
          color:           "var(--color-text-on-accent)",
          fontSize:        "var(--text-sm)",
          fontWeight:      "var(--font-weight-semibold)",
          textDecoration:  "none",
          transition:      "top var(--transition-fast)",
          outline:         "none",
        }}
        onFocus={(e) => { (e.currentTarget as HTMLAnchorElement).style.top = "var(--space-4)"; }}
        onBlur={(e)  => { (e.currentTarget as HTMLAnchorElement).style.top = "-100px"; }}
      >
        Skip to main content
      </a>

      {/* Root layout */}
      <div
        style={{
          minHeight:       "100dvh",
          backgroundColor: "var(--color-page)",
        }}
      >
        {/* Fixed sidebar — desktop & tablet */}
        <Sidebar
          sub={sub}
          tenantId={tenantId}
          drawerOpen={drawerOpen}
          onDrawerClose={() => setDrawerOpen(false)}
        />

        {/* Right column: mobile topbar + page content */}
        <div
          className="portal-main"
          style={{
            display:       "flex",
            flexDirection: "column",
            minHeight:     "100dvh",
          }}
        >
          {/* TopBar — mobile only */}
          <TopBar
            sub={sub}
            tenantId={tenantId}
            onMenuOpen={() => setDrawerOpen(true)}
          />

          {/* Main content area */}
          <main
            id="main-content"
            tabIndex={-1}
            style={{
              flex:      1,
              width:     "100%",
              maxWidth:  "1200px",
              margin:    "0 auto",
              padding:   "var(--space-6)",
              boxSizing: "border-box" as const,
              outline:   "none",
            }}
          >
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
