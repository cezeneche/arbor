// ── UK CBAM calculation constants ─────────────────────────────────────────────
// Single source of truth. Update UK_ETS_RATE each quarter when HMRC publishes
// the new CBAM rate schedule (Finance (No.2) Act 2025-26, secondary legislation
// February 2026). Do NOT hardcode this value anywhere else.

// GBP per tCO₂e — Q4 2026 trial rate published by HMRC.
export const UK_ETS_RATE = 52.4;

// ── Sector display labels ──────────────────────────────────────────────────────
// Canonical map from DB sector key to human-readable label.
// Used on scope checker, upload, case detail, and supplier pages.
export const SECTOR_LABELS: Record<string, string> = {
  iron_steel:  "Iron & steel",
  aluminium:   "Aluminium",
  cement:      "Cement",
  fertilisers: "Fertilisers",
  hydrogen:    "Hydrogen",
  electricity: "Electricity",
};

export function sectorLabel(s: string | null | undefined): string {
  return s ? (SECTOR_LABELS[s] ?? s.replace(/_/g, " ")) : "—";
}
