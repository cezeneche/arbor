"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./ui/Button";

const links = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Scope checker", href: "/scope-checker" },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
  { label: "About", href: "/about" },
];

interface NavProps {
  dark?: boolean;
}

export function Nav({ dark = false }: NavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const textCls = dark
    ? "text-surface/80 hover:text-surface"
    : "text-text-secondary hover:text-text-primary";

  const wordmarkCls = dark ? "text-surface" : "text-text-primary";
  const borderCls = dark ? "border-surface/10" : "border-border";
  const bgCls = dark ? "bg-navy" : "bg-surface";
  const mobileBgCls = dark ? "bg-navy border-surface/10" : "bg-surface border-border";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b",
        bgCls,
        borderCls,
      )}
      style={{ height: "var(--topbar-height)" }}
    >
      <nav
        className="page-content h-full flex items-center justify-between"
        aria-label="Main navigation"
      >
        {/* Wordmark */}
        <Link
          href="/"
          className={cn(
            "font-inter text-base tracking-tight transition-opacity hover:opacity-70",
            wordmarkCls,
          )}
          style={{ fontWeight: 300, letterSpacing: "-0.02em" }}
        >
          nucleos
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "text-sm transition-colors",
                textCls,
                pathname === l.href && (dark ? "text-surface" : "text-text-primary"),
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className={cn("text-sm transition-colors", textCls)}
          >
            Sign in
          </Link>
          <Button href="/demo" variant={dark ? "primary-inverse" : "primary"} size="sm">
            Request a demo
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          className={cn(
            "md:hidden flex flex-col gap-1.5 p-2 rounded",
            dark ? "text-surface" : "text-text-primary",
          )}
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          <span
            className={cn(
              "block w-5 h-px transition-all",
              dark ? "bg-surface" : "bg-text-primary",
              open && "rotate-45 translate-y-[10px]",
            )}
          />
          <span
            className={cn(
              "block w-5 h-px transition-all",
              dark ? "bg-surface" : "bg-text-primary",
              open && "opacity-0",
            )}
          />
          <span
            className={cn(
              "block w-5 h-px transition-all",
              dark ? "bg-surface" : "bg-text-primary",
              open && "-rotate-45 -translate-y-[10px]",
            )}
          />
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div
          className={cn(
            "md:hidden absolute top-full left-0 right-0 border-b px-6 py-6 flex flex-col gap-5",
            mobileBgCls,
          )}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={cn(
                "text-base transition-colors",
                textCls,
              )}
            >
              {l.label}
            </Link>
          ))}
          <hr className={cn("border-t", dark ? "border-surface/10" : "border-border")} />
          <div className="flex flex-col gap-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className={cn("text-sm", textCls)}
            >
              Sign in
            </Link>
            <Button
              href="/demo"
              variant={dark ? "primary-inverse" : "primary"}
              size="sm"
            >
              Request a demo
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
