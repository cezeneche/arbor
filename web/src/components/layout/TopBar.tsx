"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuthContext } from "@/lib/auth/AuthProvider";

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

  const [avatarOpen,    setAvatarOpen]    = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [notifOn,       setNotifOn]       = useState(true);

  const avatarWrapRef = useRef<HTMLDivElement>(null);

  const initials = getInitials(user?.name, user?.sub);
  const email    = user?.sub ?? "";
  const fullName = user?.name ?? email;

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
        {/* LEFT: wordmark */}
        <Link href="/" aria-label="nucleos" style={{ textDecoration: "none", flexShrink: 0 }}>
          <span style={{
            fontSize:      "15px",
            fontWeight:    500,
            color:         "var(--color-text-primary)",
            letterSpacing: "-0.03em",
            lineHeight:    "24px",
            fontFamily:    "inherit",
          }}>
            nucleos
          </span>
        </Link>

        {/* RIGHT: Upload documents + avatar */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-24)", flexShrink: 0 }}>

          <Link
            href="/suppliers"
            style={{
              fontSize:       "13px",
              fontWeight:     300,
              color:          "var(--color-navy)",
              textDecoration: "none",
              fontFamily:     "inherit",
            }}
          >
            Emissions data
          </Link>

          <Link
            href="/carbon-relief"
            style={{
              fontSize:       "13px",
              fontWeight:     300,
              color:          "var(--color-navy)",
              textDecoration: "none",
              fontFamily:     "inherit",
            }}
          >
            Carbon relief
          </Link>

          <Link
            href="/upload"
            style={{
              display:         "inline-flex",
              alignItems:      "center",
              height:          "32px",
              padding:         "0 var(--space-16)",
              backgroundColor: "var(--color-navy)",
              color:           "#FFFFFF",
              fontSize:        "13px",
              fontWeight:      500,
              fontFamily:      "inherit",
              textDecoration:  "none",
              borderRadius:    "6px",
              whiteSpace:      "nowrap",
            }}
          >
            Upload document
          </Link>

          {/* Avatar + dropdown */}
          <div ref={avatarWrapRef} style={{ position: "relative" }}>

            <button
              onClick={() => { setAvatarOpen((o) => !o); if (avatarOpen) setDeleteConfirm(false); }}
              aria-label="Account settings"
              aria-expanded={avatarOpen}
              aria-haspopup="true"
              style={{
                width:           "26px",
                height:          "26px",
                borderRadius:    "50%",
                backgroundColor: "rgba(27, 47, 74, 0.7)",
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "center",
                cursor:          "pointer",
                flexShrink:      0,
                border:          "none",
                outline:         "none",
                transition:      "background-color 150ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(27, 47, 74, 0.9)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(27, 47, 74, 0.7)"; }}
            >
              <span style={{
                fontSize:      "10px",
                fontWeight:    500,
                color:         "var(--color-surface)",
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
              <div style={{ padding: "var(--space-16) var(--space-24)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-text-primary)", display: "block", marginBottom: "var(--space-8)" }}>
                  {fullName}
                </span>
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 300, color: "var(--color-text-tertiary)", display: "block" }}>
                  {email}
                </span>
              </div>

              {/* Preferences */}
              <div style={{ padding: "var(--space-8) var(--space-24)" }}>
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--color-text-tertiary)" }}>
                  Preferences
                </span>
              </div>
              <div style={{ padding: "var(--space-8) var(--space-24)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "var(--border-width) solid var(--color-border)" }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-primary)" }}>
                  Email notifications
                </span>
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
                    backgroundColor: "var(--color-surface)",
                    transition:      "left 200ms",
                  }} />
                </div>
              </div>

              {/* Sign out */}
              <button
                onClick={() => { closeDropdown(); signOut(); }}
                style={{
                  display:    "flex",
                  alignItems: "center",
                  padding:    "var(--space-8) var(--space-24)",
                  fontSize:   "var(--text-sm)",
                  fontWeight: 300,
                  color:      "var(--color-text-primary)",
                  cursor:     "pointer",
                  border:     "none",
                  background: "none",
                  width:      "100%",
                  textAlign:  "left",
                  fontFamily: "inherit",
                  transition: "background-color 100ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
              >
                <svg style={{ width: "16px", height: "16px", marginRight: "var(--space-8)", opacity: 0.5, flexShrink: 0 }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                  <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6"/>
                </svg>
                Sign out
              </button>

              {/* Delete account */}
              {!deleteConfirm && (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  style={{
                    display:    "flex",
                    alignItems: "center",
                    padding:    "var(--space-8) var(--space-24)",
                    fontSize:   "var(--text-sm)",
                    fontWeight: 300,
                    color:      "var(--color-red)",
                    cursor:     "pointer",
                    border:     "none",
                    borderTop:  "var(--border-width) solid var(--color-border)",
                    marginTop:  "var(--space-8)",
                    background: "none",
                    width:      "100%",
                    textAlign:  "left",
                    fontFamily: "inherit",
                    transition: "background-color 100ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-red-bg)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  <svg style={{ width: "16px", height: "16px", marginRight: "var(--space-8)", opacity: 0.7, flexShrink: 0 }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
                    <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"/>
                  </svg>
                  Delete account
                </button>
              )}

              {/* Inline delete confirmation */}
              {deleteConfirm && (
                <div style={{ padding: "var(--space-16) var(--space-24)", borderTop: "var(--border-width) solid var(--color-border)" }}>
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: 300, color: "var(--color-text-primary)", lineHeight: 1.7, marginBottom: "var(--space-16)" }}>
                    This will permanently delete your account and all associated data.{" "}
                    <strong style={{ fontWeight: 500, color: "var(--color-red)" }}>This cannot be undone.</strong>
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      style={{
                        flex:         1,
                        height:       "32px",
                        border:       "var(--border-width) solid var(--color-border)",
                        borderRadius: "6px",
                        background:   "var(--color-surface)",
                        fontFamily:   "inherit",
                        fontSize:     "var(--text-xs)",
                        fontWeight:   300,
                        color:        "var(--color-text-primary)",
                        cursor:       "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { closeDropdown(); /* DELETE /api/account in production */ }}
                      style={{
                        flex:         1,
                        height:       "32px",
                        border:       "none",
                        borderRadius: "6px",
                        background:   "var(--color-red)",
                        fontFamily:   "inherit",
                        fontSize:     "var(--text-xs)",
                        fontWeight:   500,
                        color:        "var(--color-surface)",
                        cursor:       "pointer",
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
    </header>
  );
}
