"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuthContext } from "@/lib/auth/AuthProvider";

/**
 * TopBar — brand spec (nucleos-brand-identity.html + nucleos-nav-avatar.html):
 *   56px tall. Left: "nucleos" wordmark — Inter 300, -0.03em, #141414.
 *   Centre: Cases · Review · Registration · Insights (desktop only).
 *   Right: "Upload →" (navy, 500) · avatar (32px circle, initials, navy).
 *
 *   Avatar opens a 256px dropdown:
 *     identity block (name + email) · notification toggle · sign out · delete account.
 *   Delete account reveals inline confirmation — no modal.
 *   Click-outside and Escape close the dropdown.
 */

const NAV_LINKS = [
  { label: "Cases",        href: "/" },
  { label: "Review",       href: "/review" },
  { label: "Registration", href: "/registration" },
  { label: "Insights",     href: "/insights" },
] as const;

function getInitials(name?: string | null, sub?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (sub) return sub[0].toUpperCase();
  return "?";
}

export function TopBar() {
  const { user, signOut } = useAuthContext();
  const pathname = usePathname();

  const [avatarOpen,    setAvatarOpen]    = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [notifOn,       setNotifOn]       = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const avatarWrapRef = useRef<HTMLDivElement>(null);

  const initials = getInitials(user?.name, user?.sub);
  const email    = user?.sub ?? "";
  const fullName = user?.name ?? email;

  // Close dropdown on click-outside or Escape
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (avatarWrapRef.current && !avatarWrapRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeDropdown();
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function closeDropdown() {
    setAvatarOpen(false);
    setDeleteConfirm(false);
  }

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
                fontSize:       "var(--text-sm)",
                fontWeight:     isActive(href) ? "var(--font-focal)" : "var(--font-body)",
                color:          isActive(href) ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                textDecoration: "none",
                transition:     "color var(--transition-fast)",
                paddingBottom:  isActive(href) ? "2px" : "0",
                borderBottom:   isActive(href)
                  ? "var(--border-width) solid var(--color-navy)"
                  : "var(--border-width) solid transparent",
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* ── Right: upload CTA + avatar ────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-24)", flexShrink: 0 }}>

          <Link
            href="/upload"
            className="topbar-upload"
            style={{
              fontSize:       "var(--text-base)",
              fontWeight:     "var(--font-focal)",
              color:          "var(--color-navy)",
              textDecoration: "none",
            }}
          >
            Upload →
          </Link>

          {/* Mobile nav toggle */}
          <button
            className="topbar-mobile-nav-btn"
            onClick={() => setMobileNavOpen((o) => !o)}
            aria-label="Navigation menu"
            style={{
              display:    "none",
              background: "none",
              border:     "none",
              cursor:     "pointer",
              padding:    0,
              fontSize:   "var(--text-sm)",
              color:      "var(--color-text-secondary)",
              fontFamily: "inherit",
              fontWeight: "var(--font-body)",
            }}
          >
            Menu
          </button>

          {/* ── Avatar + dropdown ──────────────────────────────────── */}
          <div ref={avatarWrapRef} style={{ position: "relative" }}>

            {/* Avatar button */}
            <button
              onClick={() => { setAvatarOpen((o) => !o); if (avatarOpen) setDeleteConfirm(false); }}
              aria-label="Account settings"
              aria-expanded={avatarOpen}
              aria-haspopup="true"
              style={{
                width:           "32px",
                height:          "32px",
                borderRadius:    "50%",
                backgroundColor: "var(--color-navy)",
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
                cursor:          "pointer",
                flexShrink:      0,
                border:          "none",
                outline:         "none",
                transition:      "background-color 150ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-navy)"; }}
            >
              <span style={{
                fontSize:      "11px",
                fontWeight:    500,
                color:         "#FFFFFF",
                letterSpacing: "0.02em",
                lineHeight:    1,
                fontFamily:    "inherit",
              }}>
                {initials}
              </span>
            </button>

            {/* Dropdown */}
            <div
              role="menu"
              style={{
                position:        "absolute",
                top:             "calc(100% + 8px)",
                right:           0,
                width:           "256px",
                backgroundColor: "var(--color-surface)",
                border:          "var(--border-width) solid var(--color-border)",
                borderRadius:    "8px",
                boxShadow:       "0 4px 16px rgba(0,0,0,0.08)",
                overflow:        "hidden",
                opacity:         avatarOpen ? 1 : 0,
                transform:       avatarOpen ? "translateY(0)" : "translateY(-4px)",
                pointerEvents:   avatarOpen ? "all" : "none",
                transition:      "opacity 150ms, transform 150ms",
                zIndex:          200,
              }}
            >
              {/* Identity */}
              <div style={{ padding: "16px 20px", borderBottom: "var(--border-width) solid var(--color-border)" }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-text-primary)", display: "block", marginBottom: "3px" }}>
                  {fullName}
                </span>
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-tertiary)", display: "block" }}>
                  {email}
                </span>
              </div>

              {/* Preferences */}
              <div style={{ padding: "12px 20px 6px" }}>
                <span style={{ fontSize: "10px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--color-text-tertiary)" }}>
                  Preferences
                </span>
              </div>
              <div style={{ padding: "8px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "var(--border-width) solid var(--color-border)" }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-primary)" }}>
                  Email notifications
                </span>
                {/* Toggle */}
                <div
                  onClick={() => setNotifOn((v) => !v)}
                  style={{
                    position:        "relative",
                    width:           "36px",
                    height:          "20px",
                    borderRadius:    "10px",
                    backgroundColor: notifOn ? "var(--color-navy)" : "var(--color-border)",
                    cursor:          "pointer",
                    flexShrink:      0,
                    transition:      "background-color 200ms",
                  }}
                >
                  <div style={{
                    position:        "absolute",
                    top:             "3px",
                    left:            notifOn ? "19px" : "3px",
                    width:           "14px",
                    height:          "14px",
                    borderRadius:    "50%",
                    backgroundColor: "#FFFFFF",
                    transition:      "left 200ms",
                  }} />
                </div>
              </div>

              {/* Sign out */}
              <button
                onClick={() => { closeDropdown(); signOut(); }}
                style={{
                  display:         "flex",
                  alignItems:      "center",
                  padding:         "11px 20px",
                  fontSize:        "var(--text-sm)",
                  fontWeight:      300,
                  color:           "var(--color-text-primary)",
                  cursor:          "pointer",
                  border:          "none",
                  background:      "none",
                  width:           "100%",
                  textAlign:       "left",
                  fontFamily:      "inherit",
                  transition:      "background-color 100ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
              >
                <svg style={{ width: "16px", height: "16px", marginRight: "10px", opacity: 0.5, flexShrink: 0 }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                  <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6"/>
                </svg>
                Sign out
              </button>

              {/* Delete account */}
              {!deleteConfirm && (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  style={{
                    display:         "flex",
                    alignItems:      "center",
                    padding:         "11px 20px",
                    fontSize:        "var(--text-sm)",
                    fontWeight:      300,
                    color:           "var(--color-red)",
                    cursor:          "pointer",
                    border:          "none",
                    borderTop:       "var(--border-width) solid var(--color-border)",
                    marginTop:       "4px",
                    background:      "none",
                    width:           "100%",
                    textAlign:       "left",
                    fontFamily:      "inherit",
                    transition:      "background-color 100ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-red-bg)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  <svg style={{ width: "16px", height: "16px", marginRight: "10px", opacity: 0.7, flexShrink: 0 }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                    <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"/>
                  </svg>
                  Delete account
                </button>
              )}

              {/* Inline delete confirmation */}
              {deleteConfirm && (
                <div style={{ padding: "16px 20px", borderTop: "var(--border-width) solid var(--color-border)" }}>
                  <p style={{ fontSize: "12px", fontWeight: 300, color: "var(--color-text-primary)", lineHeight: 1.7, marginBottom: "12px" }}>
                    This will permanently delete your account and all associated data.{" "}
                    <strong style={{ fontWeight: 500, color: "var(--color-red)" }}>This cannot be undone.</strong>
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      style={{
                        flex:        1,
                        height:      "32px",
                        border:      "var(--border-width) solid var(--color-border)",
                        borderRadius: "6px",
                        background:  "var(--color-surface)",
                        fontFamily:  "inherit",
                        fontSize:    "12px",
                        fontWeight:  300,
                        color:       "var(--color-text-primary)",
                        cursor:      "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { closeDropdown(); /* DELETE /api/account in production */ }}
                      style={{
                        flex:        1,
                        height:      "32px",
                        border:      "none",
                        borderRadius: "6px",
                        background:  "var(--color-red)",
                        fontFamily:  "inherit",
                        fontSize:    "12px",
                        fontWeight:  500,
                        color:       "#FFFFFF",
                        cursor:      "pointer",
                      }}
                    >
                      Delete account
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile nav menu (nav links only — account is in avatar dropdown) ── */}
      {mobileNavOpen && (
        <div
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
          {NAV_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileNavOpen(false)}
              style={{
                fontSize:       "var(--text-base)",
                fontWeight:     isActive(href) ? "var(--font-focal)" : "var(--font-body)",
                color:          isActive(href) ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                textDecoration: "none",
              }}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      {/* ── Responsive CSS ─────────────────────────────────────────── */}
      <style>{`
        .topbar-nav            { display: flex; gap: var(--space-32); align-items: center; }
        .topbar-upload         { display: inline; }
        .topbar-mobile-nav-btn { display: none !important; }

        @media (max-width: 768px) {
          .topbar-nav            { display: none; }
          .topbar-upload         { display: none; }
          .topbar-mobile-nav-btn { display: inline !important; }
        }
      `}</style>
    </header>
  );
}
