/**
 * AppSidebar — left navigation sidebar
 *
 * DESIGN DECISIONS
 * - Width: 240px (--sidebar-width). Wider than typical (200–220px) to give
 *   longer nav labels room without truncation — "Document Management" needs
 *   space. Narrow enough to leave ≥960px for content on a 1200px viewport.
 *
 * - Background: white (neutral-0), same as cards — separated from the off-white
 *   page background by a right border. No shadow — border is sufficient.
 *
 * - Nav items: height 48px (touch target), full-width, left-aligned text.
 *   Active item: teal-50 background + teal-700 text + teal-700 left border (3px).
 *   Three distinct indicators: background colour, text colour, left border.
 *   This ensures active state is never communicated by colour alone.
 *
 * - Section headings: 12px uppercase, wide tracking, neutral-500.
 *   Visually de-emphasised so they group without competing with nav items.
 *
 * - Mobile: sidebar collapses to a slide-in drawer (state controlled by
 *   PageShell). When collapsed, a hamburger button in TopNav opens it.
 *   Overlay dims the content area; clicking overlay closes the sidebar.
 *
 * - Keyboard: Tab navigates between items. The sidebar itself is not a
 *   focus trap — it's a nav landmark so screen reader users can skip it.
 *
 * - `aria-current="page"` on the active item — the correct ARIA attribute
 *   for current-page indication (not aria-selected, which is for listboxes).
 */
"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Upload,
  Ship,
  BarChart3,
  FileText,
  ClipboardCheck,
  Settings,
  HelpCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string | number;
}

interface NavSection {
  heading?: string;
  items: NavItem[];
}

/* CBAM portal navigation structure */
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Dashboard",          href: "/cases",        icon: LayoutDashboard },
    ],
  },
  {
    heading: "Compliance",
    items: [
      { label: "CBAM Cases",         href: "/cases/list",   icon: FolderOpen },
      { label: "Upload Documents",   href: "/upload",       icon: Upload },
      { label: "Shipments",          href: "/shipments",    icon: Ship },
    ],
  },
  {
    heading: "Reporting",
    items: [
      { label: "Emissions Data",     href: "/emissions",    icon: BarChart3 },
      { label: "Narratives",         href: "/pipeline",     icon: FileText },
      { label: "Audit Log",          href: "/audit",        icon: ClipboardCheck },
    ],
  },
  {
    heading: "Account",
    items: [
      { label: "Settings",           href: "/settings",     icon: Settings },
      { label: "Help & Guidance",    href: "/help",         icon: HelpCircle },
    ],
  },
];

interface AppSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export function AppSidebar({ isOpen = true, onClose, className }: AppSidebarProps) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/cases") return pathname === "/cases" || pathname === "/";
    return pathname.startsWith(href);
  }

  const sidebarContent = (
    <nav
      aria-label="Main navigation"
      className={cn(
        "flex flex-col h-full w-sidebar",
        "bg-neutral-0 border-r border-neutral-200",
        "py-4 overflow-y-auto",
      )}
    >
      {/* Close button — visible on mobile only */}
      <div className="flex items-center justify-between px-4 mb-2 md:hidden">
        <span className="text-sm font-semibold text-neutral-700">Navigation</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-12 w-12 rounded-md text-neutral-600 hover:bg-neutral-100"
            aria-label="Close navigation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      {NAV_SECTIONS.map((section, si) => (
        <div key={si} className={cn("px-3", si > 0 && "mt-6")}>
          {section.heading && (
            <p className={cn(
              "px-3 mb-1",
              "text-[11px] font-semibold uppercase tracking-widest",
              "text-neutral-400 leading-none"
            )}>
              {section.heading}
            </p>
          )}

          <ul role="list" className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={onClose}
                    className={cn(
                      /* Touch target: 48px height, full width              */
                      "flex items-center gap-3 h-12 px-3 rounded-md w-full",
                      "text-sm font-medium",
                      "transition-colors duration-100",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? [
                            /* Active: three visual cues (bg + text + border) */
                            "bg-teal-50 text-teal-800",
                            "border-l-[3px] border-l-teal-700 pl-[calc(0.75rem-3px)]",
                          ]
                        : [
                            "text-neutral-700 border-l-[3px] border-l-transparent",
                            "hover:bg-neutral-100 hover:text-neutral-900",
                          ]
                    )}
                  >
                    <Icon
                      size={18}
                      className="flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge !== undefined && (
                      <span
                        className={cn(
                          "ml-auto flex-shrink-0",
                          "flex items-center justify-center",
                          "min-w-[20px] h-5 rounded-full px-1.5",
                          "text-[10px] font-bold",
                          active
                            ? "bg-teal-700 text-white"
                            : "bg-neutral-200 text-neutral-600"
                        )}
                        aria-label={`${item.badge} items`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* Bottom: version / legal note */}
      <div className="mt-auto px-6 pt-4 border-t border-neutral-150">
        <p className="text-[11px] text-neutral-400 leading-relaxed">
          EU CBAM Transitional Period
          <br />
          Regulation 2023/956 · 2023/1773
        </p>
      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar — always visible */}
      <aside
        className={cn(
          "hidden md:flex flex-shrink-0",
          "h-[calc(100vh-64px)]",          /* full height below TopNav      */
          "sticky top-topnav",             /* sticks below the top nav      */
          className
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar — slide-in drawer */}
      {isOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-[150] bg-black/40 md:hidden"
            aria-hidden="true"
            onClick={onClose}
          />
          {/* Drawer */}
          <aside
            className={cn(
              "fixed left-0 top-0 bottom-0 z-[160]",
              "md:hidden",
              className
            )}
          >
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  );
}
