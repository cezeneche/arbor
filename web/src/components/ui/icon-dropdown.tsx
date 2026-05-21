"use client";

import { useState, useRef, useEffect } from "react";
import type { LucideIcon } from "lucide-react";

interface IconDropdownProps<T extends string> {
  icon:     LucideIcon;
  value:    T;
  options:  { value: T; label: string }[];
  onChange: (value: T) => void;
  title?:   string;
}

export function IconDropdown<T extends string>({
  icon: Icon,
  value,
  options,
  onChange,
  title,
}: IconDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isActive = options.findIndex(o => o.value === value) !== 0;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen(o => !o)}
        style={{
          width:           "32px",
          height:          "32px",
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          border:          "var(--border-width) solid var(--color-border)",
          borderRadius:    "6px",
          backgroundColor: isActive ? "var(--color-navy)" : "var(--color-surface)",
          cursor:          "pointer",
          flexShrink:      0,
        }}
      >
        <Icon size={14} color={isActive ? "#fff" : "var(--color-text-secondary)"} />
      </button>

      {open && (
        <div
          style={{
            position:        "absolute",
            top:             "calc(100% + 4px)",
            left:            0,
            minWidth:        "140px",
            backgroundColor: "var(--color-surface)",
            border:          "var(--border-width) solid var(--color-border)",
            borderRadius:    "6px",
            boxShadow:       "0 4px 12px rgba(0,0,0,0.08)",
            zIndex:          50,
            overflow:        "hidden",
          }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display:         "block",
                width:           "100%",
                padding:         "8px 12px",
                textAlign:       "left",
                border:          "none",
                backgroundColor: opt.value === value ? "var(--color-bg)" : "transparent",
                color:           opt.value === value ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                fontSize:        "var(--text-sm)",
                fontWeight:      opt.value === value ? "var(--font-focal)" : "var(--font-body)",
                fontFamily:      "inherit",
                cursor:          "pointer",
              }}
              onMouseEnter={e => { if (opt.value !== value) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-bg)"; }}
              onMouseLeave={e => { if (opt.value !== value) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
