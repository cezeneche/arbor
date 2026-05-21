// Shared constants, formatters, and primitive components used across the
// case detail tab components.

import type { AuditEvent } from "@/lib/types";

// UK CBAM rates (£/tCO₂e) — HMRC placeholder estimates, Finance No.2 Bill 2025-26.
// Formula: UK ETS price × (1 − free_allocation_factor_for_sector).
// Mirrors cbam_uk_rates.py so the case detail and home page totals are consistent.
export const UK_CBAM_RATES: Record<string, number> = {
  iron_steel:  6.75,   // £45 × (1 − 0.85)
  aluminium:   9.00,   // £45 × (1 − 0.80)
  cement:     11.25,   // £45 × (1 − 0.75)
  fertilisers: 13.50,  // £45 × (1 − 0.70)
  hydrogen:   15.75,   // £45 × (1 − 0.65)
};

// Rough sector-average specific embedded emissions (tCO₂e/t) — Annex VI defaults.
// Used as fallback when no supplier data is present.
export const ROUGH_SEE: Record<string, number> = {
  iron_steel: 1.8, aluminium: 2.0, cement: 0.9,
  fertilisers: 2.5, hydrogen: 9.5, electricity: 0.4,
};

export const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
};

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtMass(kg?: number | null): string {
  if (kg == null) return "—";
  if (kg >= 1000) return `${(kg / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} t`;
  return `${kg.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
}

export function isChainValid(events: AuditEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    const cur  = events[i];
    const prev = events[i - 1];
    const a = cur.prev_hmac  ?? cur.chain_hash;
    const b = prev.hmac_sha256 ?? prev.signature;
    if (a && b && a !== b) return false;
  }
  return true;
}

export function actorLabel(ev: AuditEvent): string {
  return ev.actor ?? ev.actor_sub ?? "system";
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-focal)", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
      {children}
    </p>
  );
}

export function Divider() {
  return <div style={{ height: "var(--border-width)", backgroundColor: "var(--color-border)", margin: "var(--space-40) 0" }} />;
}
