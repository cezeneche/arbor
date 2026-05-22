"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "primary-inverse" | "ghost-inverse";
type Size = "sm" | "md";

interface ButtonProps {
  href?: string;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

const base =
  "inline-flex items-center justify-center font-inter cursor-pointer transition-colors select-none whitespace-nowrap rounded-btn";

const variants: Record<Variant, string> = {
  primary:
    "bg-navy text-surface hover:bg-navy-hover",
  ghost:
    "border text-navy hover:bg-bg",
  "primary-inverse":
    "bg-surface text-navy hover:bg-bg",
  "ghost-inverse":
    "border border-surface/30 text-surface hover:border-surface/60",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-4 h-8",
  md: "text-base px-6 h-btn",
};

export function Button({
  href,
  onClick,
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  className,
  children,
}: ButtonProps) {
  const classes = cn(base, variants[variant], sizes[size], className);

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(classes, disabled && "opacity-40 cursor-not-allowed")}
    >
      {children}
    </button>
  );
}
