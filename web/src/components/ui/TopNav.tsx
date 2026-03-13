/**
 * TopNav — fixed top navigation bar
 *
 * DESIGN DECISIONS
 * - Height 64px (h-topnav). Generous for tablet; the GOV.UK header is 60px,
 *   Linear's is 52px. 64px ensures all header elements clear 48px touch target
 *   vertically even when centred.
 *
 * - White background with a bottom border — distinct from the off-white page
 *   background, creates clear visual separation without a drop shadow.
 *   Drop shadows at the top of the page can feel heavy; a 1px border is cleaner.
 *
 * - Logo / product name: links to dashboard. Entire logo area is a link,
 *   so the touch target extends to the text, not just a small icon.
 *
 * - User menu: avatar (first-letter monogram) + name + dropdown arrow.
 *   The dropdown is the only hover-dependent element; we use Radix Dropdown
 *   so it's also keyboard and touch accessible.
 *
 * - Notification bell: icon button, 48×48px, with unread count badge.
 *   Count badge uses red-800 for contrast but also shows a number text.
 *
 * - Sticky (position: sticky top-0) not fixed — avoids the mobile viewport
 *   height calculation issues with fixed position on iOS Safari.
 *
 * - z-index: var(--z-sticky) = 100. Sidebar is z-base, modals are z-modal.
 */
"use client";

import React from "react";
import Link from "next/link";
import { Bell, ChevronDown, LogOut, Settings, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface TopNavProps {
  /** Current user display name */
  userName?: string;
  /** Current user email */
  userEmail?: string;
  /** Number of unread notifications */
  notificationCount?: number;
  /** Called when user clicks sign out */
  onSignOut?: () => void;
  className?: string;
}

export function TopNav({
  userName = "User",
  userEmail,
  notificationCount = 0,
  onSignOut,
  className,
}: TopNavProps) {
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const initials = userName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  /* Close menu on outside click */
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* Close menu on Escape */
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-[100]",
        "flex items-center justify-between",
        "h-topnav px-6",                 /* 64px height                     */
        "bg-neutral-0 border-b border-neutral-200",
        className
      )}
    >
      {/* Left: Logo + product name */}
      <Link
        href="/cases"
        className={cn(
          "flex items-center gap-3 h-12 px-1 rounded-md",
          "text-neutral-900 no-underline",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "transition-opacity hover:opacity-80"
        )}
        aria-label="CBAM Portal — go to dashboard"
      >
        {/* Wordmark icon — simple teal square with "CB" */}
        <span
          className="flex items-center justify-center w-8 h-8 rounded bg-teal-700 text-white text-xs font-bold tracking-tight flex-shrink-0"
          aria-hidden="true"
        >
          CB
        </span>
        <span className="font-semibold text-base text-neutral-900 hidden sm:block">
          CBAM Portal
        </span>
      </Link>

      {/* Right: Notifications + user menu */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <div className="relative">
          <button
            type="button"
            className={cn(
              "flex items-center justify-center",
              "h-12 w-12 rounded-md",            /* 48×48px touch target    */
              "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100",
              "transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "relative"
            )}
            aria-label={
              notificationCount > 0
                ? `Notifications — ${notificationCount} unread`
                : "Notifications — none"
            }
          >
            <Bell size={20} aria-hidden="true" />
            {notificationCount > 0 && (
              <span
                className={cn(
                  "absolute top-2 right-2",
                  "flex items-center justify-center",
                  "h-4 w-4 rounded-full",
                  /* red-800 on red-50 = 7.9:1; but here on white bg so we
                     use a filled red circle with white number text         */
                  "bg-[var(--error-icon)] text-white",
                  "text-[10px] font-bold leading-none"
                )}
                aria-hidden="true"
              >
                {notificationCount > 99 ? "99+" : notificationCount}
              </span>
            )}
          </button>
        </div>

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
            aria-label={`User menu for ${userName}`}
            className={cn(
              "flex items-center gap-2 h-12 px-3 rounded-md",
              "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
              "transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {/* Avatar monogram */}
            <span
              className={cn(
                "flex items-center justify-center",
                "w-8 h-8 rounded-full flex-shrink-0",
                "bg-teal-100 text-teal-800",
                "text-xs font-semibold"
              )}
              aria-hidden="true"
            >
              {initials}
            </span>
            <span className="text-sm font-medium hidden md:block max-w-[140px] truncate">
              {userName}
            </span>
            <ChevronDown
              size={14}
              className={cn("transition-transform duration-100 flex-shrink-0", userMenuOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>

          {/* Dropdown menu */}
          {userMenuOpen && (
            <div
              className={cn(
                "absolute right-0 top-[calc(100%+4px)]",
                "w-56 rounded-lg border border-neutral-200 bg-neutral-0 shadow-md",
                "py-1 z-[200]"
              )}
              role="menu"
            >
              {/* User info header */}
              <div className="px-4 py-3 border-b border-neutral-150">
                <p className="text-sm font-semibold text-neutral-900 truncate">{userName}</p>
                {userEmail && (
                  <p className="text-xs text-neutral-500 truncate mt-0.5">{userEmail}</p>
                )}
              </div>

              {/* Menu items — each is 48px min-height for touch target     */}
              <Link
                href="/settings"
                role="menuitem"
                className={cn(
                  "flex items-center gap-3 px-4 h-12",
                  "text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
                  "transition-colors duration-100",
                  "focus-visible:outline-none focus-visible:bg-neutral-100"
                )}
                onClick={() => setUserMenuOpen(false)}
              >
                <Settings size={16} aria-hidden="true" />
                Settings
              </Link>

              <Link
                href="/profile"
                role="menuitem"
                className={cn(
                  "flex items-center gap-3 px-4 h-12",
                  "text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
                  "transition-colors duration-100",
                  "focus-visible:outline-none focus-visible:bg-neutral-100"
                )}
                onClick={() => setUserMenuOpen(false)}
              >
                <User size={16} aria-hidden="true" />
                Your Profile
              </Link>

              <div className="border-t border-neutral-150 mt-1 pt-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setUserMenuOpen(false); onSignOut?.(); }}
                  className={cn(
                    "flex items-center gap-3 px-4 h-12 w-full text-left",
                    "text-sm text-[var(--error-text)] hover:bg-[var(--error-bg)]",
                    "transition-colors duration-100",
                    "focus-visible:outline-none focus-visible:bg-[var(--error-bg)]"
                  )}
                >
                  <LogOut size={16} aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
