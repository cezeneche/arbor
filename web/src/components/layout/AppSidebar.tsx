"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { clearToken, isReviewer } from "@/lib/auth";
import {
  LayoutDashboard,
  FolderOpen,
  Plus,
  ClipboardCheck,
  LogOut,
  Leaf,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
  reviewerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: FolderOpen },
  { href: "/cases/new", label: "New Case", icon: Plus },
  { href: "/review", label: "Review Queue", icon: ClipboardCheck, reviewerOnly: true },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const reviewer = isReviewer();

  function handleLogout() {
    clearToken();
    document.cookie = "cbam_token=; path=/; max-age=0";
    router.push("/login");
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-56 bg-slate-900 border-r border-slate-800 flex flex-col z-40">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20">
          <Leaf className="w-4 h-4 text-teal-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-none">CBAM</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          if (item.reviewerOnly && !reviewer) return null;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "10px",
                    fontWeight: "var(--font-weight-semibold)",
                    padding: "1px 6px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--color-pending-bg)",
                    border: "1px solid var(--color-pending-border)",
                    color: "var(--color-pending-text)",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-slate-800">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="w-full justify-start text-slate-400 hover:text-white hover:bg-slate-800 gap-3"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
