/**
 * PageShell — root layout wrapper for all authenticated pages
 *
 * DESIGN DECISIONS
 * - Composes TopNav + AppSidebar + main content area into the standard
 *   three-panel layout used across all CBAM portal pages.
 *
 * - Main content area uses max-w-content (1200px) with horizontal padding
 *   (px-6 = 24px). On narrower viewports the padding prevents content from
 *   touching the edges — critical for tablet users.
 *
 * - Vertical padding: py-8 (32px) top, plenty of breathing room. GOV.UK
 *   uses 30px; we add 2px for the extra generosity requested.
 *
 * - Page title + description slot: rendered in the shell so every page has
 *   a consistent header structure. Title is an h1 (only one per page).
 *
 * - Breadcrumb slot: optional, renders above the title. Used by nested
 *   pages (case → shipment → goods line). Plain text links, no arrows —
 *   chevrons are decorative and add visual noise for non-technical users.
 *
 * - Mobile hamburger: shown in TopNav when sidebar is collapsed.
 *   We pass the toggle function down through PageShell so it stays
 *   co-located with the isOpen state.
 *
 * - The shell does NOT add a bottom padding larger than 32px to avoid
 *   content being clipped on short mobile viewports.
 */
"use client";

import React, { useState } from "react";
import { Menu } from "lucide-react";
import { TopNav } from "./TopNav";
import { AppSidebar } from "./AppSidebar";
import { cn } from "@/lib/utils";

interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageShellProps {
  children: React.ReactNode;
  /** Page title — rendered as h1, one per page */
  title?: string;
  /** Supporting subtitle below title */
  description?: string;
  /** Breadcrumb trail above the title */
  breadcrumbs?: Breadcrumb[];
  /** Slot for actions in the page header (e.g., primary action button) */
  headerActions?: React.ReactNode;
  /** Current user name for TopNav */
  userName?: string;
  userEmail?: string;
  notificationCount?: number;
  onSignOut?: () => void;
  className?: string;
}

export function PageShell({
  children,
  title,
  description,
  breadcrumbs,
  headerActions,
  userName,
  userEmail,
  notificationCount,
  onSignOut,
  className,
}: PageShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Top navigation */}
      <TopNav
        userName={userName}
        userEmail={userEmail}
        notificationCount={notificationCount}
        onSignOut={onSignOut}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <AppSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Main content */}
        <main
          id="main-content"              /* skip-to-content target           */
          className={cn(
            "flex-1 overflow-y-auto",
            "min-w-0",                   /* prevents flex child overflow     */
          )}
        >
          <div className={cn(
            "max-w-content mx-auto px-6 py-8",
            className
          )}>
            {/* Mobile menu button — top of content area, only on mobile    */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className={cn(
                "md:hidden flex items-center gap-2 mb-6",
                "h-12 px-3 -ml-3 rounded-md",
                "text-sm font-medium text-neutral-700",
                "hover:bg-neutral-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              aria-label="Open navigation menu"
              aria-expanded={sidebarOpen}
            >
              <Menu size={20} aria-hidden="true" />
              <span>Menu</span>
            </button>

            {/* Page header */}
            {(breadcrumbs || title || headerActions) && (
              <div className="mb-8">
                {/* Breadcrumbs */}
                {breadcrumbs && breadcrumbs.length > 0 && (
                  <nav
                    aria-label="Breadcrumb"
                    className="mb-3"
                  >
                    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {breadcrumbs.map((crumb, i) => (
                        <li key={i} className="flex items-center gap-2">
                          {i > 0 && (
                            <span className="text-neutral-400 text-sm" aria-hidden="true">/</span>
                          )}
                          {crumb.href ? (
                            <a
                              href={crumb.href}
                              className="text-sm text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            >
                              {crumb.label}
                            </a>
                          ) : (
                            <span
                              className="text-sm text-neutral-500"
                              aria-current="page"
                            >
                              {crumb.label}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </nav>
                )}

                {/* Title row */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    {title && (
                      <h1 className="text-2xl font-semibold text-neutral-900 leading-tight">
                        {title}
                      </h1>
                    )}
                    {description && (
                      <p className="mt-1.5 text-base text-neutral-600 leading-normal max-w-2xl">
                        {description}
                      </p>
                    )}
                  </div>
                  {headerActions && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {headerActions}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Page content */}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
