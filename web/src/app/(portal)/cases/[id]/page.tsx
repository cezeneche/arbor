"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCase } from "@/lib/hooks/useCases";
import { useAuth } from "@/lib/auth/useAuth";
import { useRole } from "@/lib/auth/useRole";
import { getAuditLog } from "@/lib/api/audit";
import { approveCase, rejectCase } from "@/lib/api/cases";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  methodLabel,
  methodBadgeVariant,
  toStatusVariant,
  statusLabel,
} from "@/lib/design-system";
import type { AuditEvent } from "@/lib/types";
import type { OpenGaps, RichGoodsLine } from "@/lib/api/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const UK_ETS_RATE = 52.4;

/** Annex VI world-average direct SEE (tCO₂e/t) */
const ROUGH_SEE: Record<string, number> = {
  iron_steel:  1.8,
  aluminium:   2.0,
  cement:      0.9,
  fertilisers: 2.5,
  hydrogen:    9.5,
  electricity: 0.4,
};

const MONO: React.CSSProperties = {
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function sectorLabel(s?: string | null): string {
  const map: Record<string, string> = {
    iron_steel: "Iron & steel", aluminium:   "Aluminium",
    cement:     "Cement",       fertilisers: "Fertilisers",
    hydrogen:   "Hydrogen",     electricity: "Electricity",
  };
  return s ? (map[s] ?? s.replace(/_/g, " ")) : "—";
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtMass(kg?: number | null): string {
  if (kg == null) return "—";
  if (kg >= 1000) return `${(kg / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} t`;
  return `${kg.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
}

function fmtEmissions(kgco2e?: number | null): string {
  if (kgco2e == null) return "—";
  const tco2e = kgco2e / 1000;
  return `${tco2e.toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} tCO₂e`;
}

function isChainValid(events: AuditEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    const cur  = events[i];
    const prev = events[i - 1];
    const curPrev  = cur.prev_hmac  ?? cur.chain_hash;
    const prevHmac = prev.hmac_sha256 ?? prev.signature;
    if (curPrev && prevHmac && curPrev !== prevHmac) return false;
  }
  return true;
}

function actorLabel(ev: AuditEvent): string {
  return ev.actor ?? ev.actor_sub ?? "system";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize:      "var(--text-xs)",
      fontWeight:    "var(--font-focal)",
      color:         "var(--color-text-tertiary)",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      margin:        0,
    }}>
      {children}
    </p>
  );
}

function Divider() {
  return (
    <div style={{
      height:          "var(--border-width)",
      backgroundColor: "var(--color-border)",
      margin:          "var(--space-40) 0",
    }} />
  );
}

// ── Goods line table ───────────────────────────────────────────────────────────

function GoodsLineTable({ lines }: { lines: RichGoodsLine[] }) {
  if (lines.length === 0) {
    return (
      <div style={{
        padding:      "var(--space-32)",
        textAlign:    "center",
        border:       "var(--border-width) solid var(--color-border)",
        borderRadius: "8px",
      }}>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", margin: 0 }}>
          No goods lines extracted yet. Upload a supplier document to populate this case.
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: "var(--border-width) solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "120px 1fr 100px 130px 120px",
        gap:                 "var(--space-16)",
        padding:             "var(--space-8) var(--space-24)",
        borderBottom:        "var(--border-width) solid var(--color-border)",
        backgroundColor:     "var(--color-bg)",
      }}>
        {["CN code", "Sector", "Net mass", "Direct CO₂e", "Method"].map((h, i) => (
          <span key={h} style={{
            fontSize:   "var(--text-xs)",
            fontWeight: "var(--font-focal)",
            color:      "var(--color-text-tertiary)",
            textAlign:  i >= 2 && i <= 3 ? "right" : "left",
          }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {lines.map((line, i) => {
        const see      = ROUGH_SEE[line.sector ?? ""] ?? 1.5;
        const massKg   = line.net_mass_kg ?? line.quantity ?? 0;
        const directKg = line.direct_kgco2e != null
          ? line.direct_kgco2e
          : massKg > 0 ? (massKg / 1000) * see * 1000 : null;
        const method   = line.method ?? "default";
        const isLast   = i === lines.length - 1;

        return (
          <div
            key={line.id}
            style={{
              display:             "grid",
              gridTemplateColumns: "120px 1fr 100px 130px 120px",
              gap:                 "var(--space-16)",
              alignItems:          "center",
              padding:             "var(--space-16) var(--space-24)",
              borderBottom:        isLast ? undefined : "var(--border-width) solid var(--color-border)",
            }}
          >
            {/* CN code — monospace */}
            <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", ...MONO }}>
              {line.cn_code || "—"}
            </span>

            {/* Sector + description */}
            <div style={{ minWidth: 0 }}>
              <p style={{
                fontSize:     "var(--text-sm)",
                fontWeight:   "var(--font-body)",
                color:        "var(--color-text-primary)",
                margin:       0,
                overflow:     "hidden",
                textOverflow: "ellipsis",
                whiteSpace:   "nowrap",
              }}>
                {sectorLabel(line.sector)}
              </p>
              {line.description && (
                <p style={{
                  fontSize:     "var(--text-xs)",
                  color:        "var(--color-text-tertiary)",
                  margin:       "2px 0 0",
                  overflow:     "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace:   "nowrap",
                }}>
                  {line.description}
                </p>
              )}
            </div>

            {/* Net mass — right-aligned */}
            <span style={{
              fontSize:           "var(--text-sm)",
              color:              "var(--color-text-secondary)",
              textAlign:          "right",
              fontVariantNumeric: "tabular-nums",
              whiteSpace:         "nowrap",
            }}>
              {fmtMass(massKg)}
            </span>

            {/* Direct CO₂e — right-aligned */}
            <span style={{
              fontSize:           "var(--text-sm)",
              fontWeight:         line.direct_kgco2e != null ? "var(--font-focal)" : "var(--font-body)",
              color:              line.direct_kgco2e != null ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
              textAlign:          "right",
              fontVariantNumeric: "tabular-nums",
              whiteSpace:         "nowrap",
            }}>
              {fmtEmissions(directKg)}
              {line.direct_kgco2e == null && massKg > 0 && (
                <span style={{ fontSize: "9px", display: "block", color: "var(--color-text-tertiary)" }}>
                  estimated
                </span>
              )}
            </span>

            {/* Method badge */}
            <div>
              <Badge variant={methodBadgeVariant(method)}>
                {methodLabel(method)}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Audit trail tab ────────────────────────────────────────────────────────────

function AuditTrailTab({ caseId }: { caseId: string }) {
  const { data: raw = [] } = useQuery<AuditEvent[]>({
    queryKey:  ["audit-log", caseId],
    queryFn:   () => getAuditLog(caseId),
    staleTime: 60_000,
    enabled:   Boolean(caseId),
  });

  // The API returns { events: [...] } or a bare array
  const auditEvents: AuditEvent[] = Array.isArray(raw)
    ? raw
    : ((raw as { events?: AuditEvent[] }).events ?? []);

  const chainValid = auditEvents.length === 0 || isChainValid(auditEvents);

  return (
    <div>
      {!chainValid && (
        <div style={{
          padding:         "var(--space-16) var(--space-24)",
          marginBottom:    "var(--space-24)",
          backgroundColor: "var(--color-red-bg)",
          border:          "var(--border-width) solid var(--color-red)",
          borderRadius:    "6px",
        }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)", margin: 0 }}>
            Chain integrity check failed — this case requires manual verification before submission.
          </p>
        </div>
      )}

      {chainValid && auditEvents.length > 0 && (
        <div style={{
          display:         "flex",
          alignItems:      "center",
          gap:             "var(--space-8)",
          marginBottom:    "var(--space-24)",
        }}>
          <span style={{
            display:         "inline-block",
            width:           "6px",
            height:          "6px",
            borderRadius:    "50%",
            backgroundColor: "var(--color-green)",
            flexShrink:      0,
          }} />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            Chain integrity verified — {auditEvents.length} event{auditEvents.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {auditEvents.length === 0 ? (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          No audit events yet.
        </p>
      ) : (
        <div style={{ border: "var(--border-width) solid var(--color-border)", borderRadius: "8px", overflow: "hidden" }}>
          {auditEvents.map((ev: AuditEvent, i: number) => {
            const hmac  = ev.hmac_sha256 ?? ev.signature;
            const actor = actorLabel(ev);
            const isLast = i === auditEvents.length - 1;

            return (
              <div
                key={ev.id}
                style={{
                  display:             "grid",
                  gridTemplateColumns: "160px 1fr auto",
                  alignItems:          "center",
                  gap:                 "var(--space-24)",
                  padding:             "var(--space-12) var(--space-24)",
                  borderBottom:        isLast ? undefined : "var(--border-width) solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                  {fmtTime(ev.created_at)}
                </span>
                <div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", margin: 0 }}>
                    {ev.event_type.replace(/_/g, " ")}
                  </p>
                  {actor !== "system" && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
                      {actor}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
                  {ev.verified === false && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-red)" }}>invalid</span>
                  )}
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", ...MONO }}>
                    {hmac?.slice(0, 12) ?? "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Document fields panel ──────────────────────────────────────────────────────
// Hardcoded 10-field CBAM checklist. Pre-filled from extraction; asterisk if missing.
// Fields per HMRC CBAM return requirements and EU 2023/1773 Art. 4–6.

type CbamFieldDef = {
  key:      string;
  label:    string;
  hint:     string;
  required: boolean; // blocking if missing (red *) vs advisory (amber *)
};

const CBAM_FIELDS: CbamFieldDef[] = [
  { key: "importer_eori",      label: "Importer EORI",               hint: "Required for HMRC registration and return.",                                        required: true  },
  { key: "origin_country",     label: "Country of origin",            hint: "2-letter ISO code from supplier invoice or mill certificate.",                      required: true  },
  { key: "cn_code",            label: "CN8 commodity code",           hint: "8-digit Combined Nomenclature code from customs declaration.",                      required: true  },
  { key: "net_mass_kg",        label: "Net weight (kg)",              hint: "Net weight excluding packaging — required to calculate embedded emissions.",         required: true  },
  { key: "emissions_data",     label: "Emissions data",               hint: "Verified supplier data or Annex VI default values — required before submission.",   required: true  },
  { key: "invoice_number",     label: "Invoice / reference number",   hint: "Add the invoice number to enable customs reconciliation.",                          required: false },
  { key: "entry_reference",    label: "Customs entry ref (MRN)",      hint: "18-character Movement Reference Number from the customs declaration.",              required: false },
  { key: "incoterm",           label: "Incoterms",                    hint: "Delivery terms (e.g. CIF, FOB) from the commercial invoice.",                       required: false },
  { key: "verified_emissions", label: "Supplier-verified emissions",  hint: "Without these you pay conservative default values, which cost more.",               required: false },
  { key: "installation_id",    label: "Supplier installation ID",     hint: "EU CBAM installation identifier — required for verified emissions claims.",          required: false },
];

function getCbamFieldValue(key: string, case_: import("@/lib/api/types").CaseDetail): string | null {
  const shipment = (case_.shipments ?? [])[0] as import("@/lib/types").CBAMShipment | undefined;
  const gl       = (case_.goods_lines ?? [])[0] as import("@/lib/api/types").RichGoodsLine | undefined;

  switch (key) {
    case "importer_eori":
      return case_.importer_eori || null;
    case "origin_country":
      return shipment?.origin_country || gl?.origin_country || null;
    case "cn_code":
      return gl?.cn_code || null;
    case "net_mass_kg": {
      const kg = gl?.net_mass_kg ?? gl?.quantity;
      if (kg == null) return null;
      return `${kg.toLocaleString("en-GB")} kg`;
    }
    case "emissions_data": {
      const m = gl?.method;
      if (!m) return null;
      if (m === "actual")    return "Verified supplier data";
      if (m === "estimated") return "Estimated";
      if (m === "default")   return "Annex VI default values";
      return m;
    }
    case "invoice_number":
      return null; // tracked via open_gaps; not yet surfaced in case detail response
    case "entry_reference":
      return shipment?.entry_reference || null;
    case "incoterm":
      return shipment?.incoterm || null;
    case "verified_emissions": {
      if (gl?.method !== "actual" || gl?.direct_kgco2e == null) return null;
      const tco2e = gl.direct_kgco2e / 1000;
      return `${tco2e.toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} tCO₂e`;
    }
    case "installation_id":
      return gl?.installation_id || null;
    default:
      return null;
  }
}

function isMissingInGaps(key: string, gaps: import("@/lib/api/types").OpenGaps | null): boolean {
  if (!gaps) return false;
  const all = [...(gaps.missing ?? []), ...(gaps.warnings ?? [])];
  const gapMap: Record<string, string> = {
    importer_eori:      "importer_eori_missing",
    origin_country:     "origin_country_missing",
    cn_code:            "cn_code_missing",
    net_mass_kg:        "mass_missing_or_non_positive",
    emissions_data:     "missing_emissions",
    invoice_number:     "invoice_number_missing",
    entry_reference:    "entry_reference_missing",
    incoterm:           "incoterm_missing",
    verified_emissions: "method_not_actual",
    installation_id:    "installation_id_missing",
  };
  const code = gapMap[key];
  if (!code) return false;
  return all.some(c => c.includes(code));
}

function DocumentFieldsPanel({
  case_,
}: {
  case_: import("@/lib/api/types").CaseDetail;
}) {
  return (
    <div style={{ marginBottom: "var(--space-40)" }}>
      <div style={{ marginBottom: "var(--space-16)" }}>
        <SectionLabel>Document fields</SectionLabel>
      </div>
      <div style={{
        border:       "var(--border-width) solid var(--color-border)",
        borderRadius: "8px",
        overflow:     "hidden",
      }}>
        {CBAM_FIELDS.map((field, i) => {
          const value   = getCbamFieldValue(field.key, case_);
          const missing = value == null || isMissingInGaps(field.key, case_.open_gaps);
          const color   = field.required ? "var(--color-red)" : "var(--color-amber)";
          const isLast  = i === CBAM_FIELDS.length - 1;

          return (
            <div
              key={field.key}
              style={{
                display:             "grid",
                gridTemplateColumns: "1fr 1fr",
                alignItems:          "center",
                gap:                 "var(--space-16)",
                padding:             "var(--space-12) var(--space-24)",
                borderBottom:        isLast ? undefined : "var(--border-width) solid var(--color-border)",
                backgroundColor:     missing ? "transparent" : undefined,
              }}
            >
              {/* Label */}
              <p style={{
                fontSize:   "var(--text-sm)",
                fontWeight: "var(--font-body)",
                color:      "var(--color-text-secondary)",
                margin:     0,
              }}>
                {field.label}
                {missing && (
                  <span style={{ color, fontWeight: 500, marginLeft: "4px" }} title={field.hint}>
                    *
                  </span>
                )}
              </p>

              {/* Value or missing indicator */}
              {value != null ? (
                <p style={{
                  fontSize:           "var(--text-sm)",
                  fontWeight:         "var(--font-body)",
                  color:              "var(--color-text-primary)",
                  margin:             0,
                  fontFamily:         ["cn_code", "importer_eori", "entry_reference", "installation_id"].includes(field.key)
                    ? "ui-monospace, 'SF Mono', Menlo, monospace"
                    : undefined,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {value}
                </p>
              ) : (
                <p style={{
                  fontSize:   "var(--text-xs)",
                  fontWeight: "var(--font-body)",
                  color,
                  margin:     0,
                }}>
                  * Missing — {field.hint}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Required fields template ───────────────────────────────────────────────────
// Maps machine-readable gap codes (substrings) to user-facing labels + action.
// CBAM-reg.md §4 Steps 2–6; EU 2023/1773 Art. 4–6; HMRC CBAM return fields.

const MISSING_LABELS: Array<{ match: string; label: string; action: string }> = [
  { match: "importer_eori_missing",        label: "Importer EORI number",           action: "Enter the importer's EORI — required for HMRC registration and return." },
  { match: "reporting_year_missing",       label: "Reporting year",                 action: "Set the reporting period year." },
  { match: "reporting_quarter_missing",    label: "Reporting quarter",              action: "Set the reporting quarter (1–4)." },
  { match: "origin_country_missing",       label: "Country of origin",              action: "Obtain the 2-letter ISO country code from the supplier invoice or mill certificate." },
  { match: "cn_code_missing",              label: "CN8 commodity code",             action: "Confirm the 8-digit Combined Nomenclature code from the customs declaration." },
  { match: "mass_missing_or_non_positive", label: "Net weight (kg)",                action: "Enter the net weight of goods excluding packaging — required to calculate embedded emissions." },
  { match: "missing_emissions",            label: "Emissions data",                 action: "Request supplier-verified data or confirm use of Annex VI default values." },
];

const WARNING_LABELS: Array<{ match: string; label: string; action: string }> = [
  { match: "invoice_number_missing",       label: "Invoice / reference number",     action: "Add the invoice number to enable customs reconciliation." },
  { match: "entry_reference_missing",      label: "Customs entry reference (MRN)",  action: "Obtain the 18-character Movement Reference Number from the customs declaration." },
  { match: "entry_reference_format_invalid", label: "Customs entry reference format invalid", action: "The MRN does not match the 18-character EU/HMRC format — verify against the customs declaration." },
  { match: "incoterm_missing",             label: "Incoterms",                      action: "Add the delivery terms (e.g. CIF, FOB) from the commercial invoice." },
  { match: "method_not_actual",            label: "Supplier-verified emissions",    action: "Request a verified emissions report from the supplier to replace default values and reduce liability." },
  { match: "installation_id_missing",      label: "Supplier installation ID",       action: "Obtain the EU CBAM installation identifier from the supplier for verified emissions claims." },
  { match: "sector_mismatch",              label: "Sector classification mismatch", action: "The CN code maps to a different sector than declared — verify the CN code against TARIC." },
];

function _resolveLabel(code: string, map: typeof MISSING_LABELS): { label: string; action: string } | null {
  for (const entry of map) {
    if (code.includes(entry.match)) return entry;
  }
  return null;
}

function OpenGapsPanel({ gaps }: { gaps: OpenGaps }) {
  const missingItems = gaps.missing
    .map(code => _resolveLabel(code, MISSING_LABELS))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const warningItems = gaps.warnings
    .map(code => _resolveLabel(code, WARNING_LABELS))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // De-duplicate by label (same field can appear per-goods-line multiple times)
  const seen = new Set<string>();
  const uniqueMissing = missingItems.filter(x => seen.has(x.label) ? false : (seen.add(x.label), true));
  const uniqueWarnings = warningItems.filter(x => seen.has(x.label) ? false : (seen.add(x.label), true));

  if (uniqueMissing.length === 0 && uniqueWarnings.length === 0) return null;

  const tierColor = gaps.blocking ? "var(--color-red)" : gaps.risk_tier === "high" ? "var(--color-amber)" : "var(--color-amber)";

  return (
    <div style={{ marginBottom: "var(--space-40)" }}>
      <div style={{
        backgroundColor: "var(--color-surface)",
        border:          "var(--border-width) solid var(--color-border)",
        borderLeft:      `3px solid ${tierColor}`,
        borderRadius:    "0 8px 8px 0",
        padding:         "var(--space-24)",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-16)", marginBottom: "var(--space-16)" }}>
          <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", margin: 0 }}>
            Required information
          </p>
          <span style={{
            fontSize:        "var(--text-xs)",
            fontWeight:      "var(--font-focal)",
            color:           tierColor,
            textTransform:   "uppercase",
            letterSpacing:   "0.06em",
          }}>
            {gaps.blocking ? "Blocking" : `Quality ${gaps.score}/100`}
          </span>
        </div>

        {uniqueMissing.length > 0 && (
          <div style={{ marginBottom: uniqueWarnings.length > 0 ? "var(--space-16)" : 0 }}>
            <p style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-red)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-8)" }}>
              Missing — required before submission
            </p>
            {uniqueMissing.map((item) => (
              <GapRow key={item.label} label={item.label} action={item.action} variant="missing" />
            ))}
          </div>
        )}

        {uniqueWarnings.length > 0 && (
          <div>
            <p style={{ fontSize: "var(--text-xs)", fontWeight: 500, color: "var(--color-amber)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-8)" }}>
              Incomplete — accuracy concerns
            </p>
            {uniqueWarnings.map((item) => (
              <GapRow key={item.label} label={item.label} action={item.action} variant="warning" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GapRow({ label, action, variant }: { label: string; action: string; variant: "missing" | "warning" }) {
  const color = variant === "missing" ? "var(--color-red)" : "var(--color-amber)";
  return (
    <div style={{
      display:      "grid",
      gridTemplateColumns: "8px 1fr",
      gap:          "var(--space-12)",
      paddingBottom: "var(--space-12)",
      marginBottom:  "var(--space-12)",
      borderBottom:  "var(--border-width) solid var(--color-border)",
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: color, marginTop: "5px", flexShrink: 0, display: "inline-block" }} />
      <div>
        <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", margin: "0 0 2px" }}>
          {label}
        </p>
        <p style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>
          {action}
        </p>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CaseDetailPage({ params }: { params: { id: string } }) {
  const { id }  = params;
  const { user } = useAuth();
  const role     = useRole();
  const isAdmin  = role === "admin";

  const { case_, isLoading, error } = useCase(id);

  const [activeTab,    setActiveTab]    = useState<"details" | "audit">("details");
  const [actionDone,   setActionDone]   = useState<"approved" | "flagged" | null>(null);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagText,     setFlagText]     = useState("");
  const [actioning,    setActioning]    = useState(false);

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="page-content" style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}>
        <div>
          <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            <Skeleton height={14} width={80} style={{ marginBottom: "var(--space-40)" }} />
            <Skeleton height={24} width={200} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={13} width={280} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={13} width={140} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-32)", paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Skeleton height={11} width={80} style={{ marginBottom: "var(--space-8)" }} />
                <Skeleton height={24} width={120} />
              </div>
            ))}
          </div>
          <div style={{ paddingBottom: "var(--space-40)" }}>
            <Skeleton height={11} width={72} style={{ marginBottom: "var(--space-16)" }} />
            <Skeleton height={48} style={{ marginBottom: "var(--space-8)" }} />
            <Skeleton height={48} />
          </div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────────

  if (error || !case_) {
    return (
      <div className="page-content" style={{ paddingTop: "var(--space-48)" }}>
        <Link href="/" style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "inline-block", marginBottom: "var(--space-40)" }}>
          ← Cases
        </Link>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-red)" }}>
          {error?.message ?? "Case not found."}
        </p>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────────

  const goods_lines = (case_.goods_lines ?? []) as RichGoodsLine[];

  const sector     = goods_lines[0]?.sector ? sectorLabel(goods_lines[0].sector) : "—";
  const country    = (case_.shipments?.[0] as { origin_country?: string })?.origin_country
    ?? goods_lines[0]?.origin_country
    ?? "—";
  const importDate = (case_.shipments?.[0] as { import_date?: string })?.import_date
    ?? goods_lines[0]?.import_date
    ?? case_.created_at;

  // Liability — use actual direct emissions if available, else rough SEE estimate
  const totalDirectKgco2e = goods_lines.reduce((sum, gl) => {
    const kg = gl.net_mass_kg ?? gl.quantity ?? 0;
    if (gl.direct_kgco2e != null) return sum + gl.direct_kgco2e;
    const see = ROUGH_SEE[gl.sector ?? ""] ?? 1.5;
    return sum + (kg / 1000) * see * 1000;
  }, 0);

  const cbamCharge   = (totalDirectKgco2e / 1000) * UK_ETS_RATE;
  const cpr          = 0;
  const netLiability = cbamCharge - cpr;

  const isProcessing = case_.status === "processing";
  const isPending    = case_.review_status === "pending_review";
  const isApproved   = case_.review_status === "approved" || case_.status === "signed_off";

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function handleApprove() {
    setActioning(true);
    try {
      await approveCase(id, {
        reviewer_name:  user?.sub ?? "reviewer",
        reviewer_email: user?.sub ?? "reviewer@nucleos",
        comments:       "Approved via case detail",
      });
      setActionDone("approved");
    } catch { /* state unchanged */ }
    setActioning(false);
  }

  async function handleSendFlag() {
    if (!flagText.trim()) return;
    setActioning(true);
    try {
      await rejectCase(id, {
        reviewer_name:  user?.sub ?? "reviewer",
        reviewer_email: user?.sub ?? "reviewer@nucleos",
        comments:       flagText.trim(),
      });
      setActionDone("flagged");
    } catch { /* ignore */ }
    setActioning(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="page-content"
      style={{ paddingTop: "var(--space-48)", paddingBottom: "var(--space-80)" }}
    >
      <div>

        {/* ══════════════════════ HEADER ══════════════════════ */}
        <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
          <Link
            href="/"
            style={{
              display:        "inline-block",
              fontSize:       "var(--text-sm)",
              fontWeight:     "var(--font-body)",
              color:          "var(--color-text-secondary)",
              textDecoration: "none",
              marginBottom:   "var(--space-40)",
            }}
          >
            ← Cases
          </Link>

          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-24)" }}>
            <div>
              <p style={{ fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-text-primary)", marginBottom: "var(--space-8)" }}>
                {sector !== "—" ? `${sector} · ${country}` : case_.importer_name || "Untitled case"}
              </p>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", marginBottom: "var(--space-8)" }}>
                {case_.id}
              </p>
              <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                {fmtDate(importDate)}
              </p>
            </div>
            <Badge variant={toStatusVariant(case_.status)}>
              {statusLabel(case_.status)}
            </Badge>
          </div>
        </div>

        {/* ══════════════════════ PROCESSING NOTICE ══════════════════════ */}
        {isProcessing && (
          <div style={{
            display:         "flex",
            alignItems:      "center",
            gap:             "var(--space-12)",
            padding:         "var(--space-16) var(--space-24)",
            marginBottom:    "var(--space-40)",
            backgroundColor: "var(--color-surface)",
            border:          "var(--border-width) solid var(--color-border)",
            borderLeft:      "3px solid var(--color-navy)",
            borderRadius:    "0 var(--btn-radius) var(--btn-radius) 0",
          }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0 }}>
              Document is being processed. Goods lines and emissions data will appear shortly.
            </p>
          </div>
        )}

        {/* ══════════════════════ REQUIRED INFORMATION ══════════════════ */}
        {case_.open_gaps && (case_.open_gaps.missing.length > 0 || case_.open_gaps.warnings.length > 0) && !isProcessing && (
          <OpenGapsPanel gaps={case_.open_gaps} />
        )}

        {/* ══════════════════════ FINANCIAL SUMMARY ══════════════════════ */}
        <div style={{ paddingBottom: "var(--space-40)", borderBottom: "var(--border-width) solid var(--color-border)", marginBottom: "var(--space-40)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-32)" }}>
            <div>
              <SectionLabel>CBAM charge</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(cbamCharge)}
              </p>
              {goods_lines.length > 0 && goods_lines.some(gl => gl.direct_kgco2e == null) && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                  Annex VI default — supplier data would refine this
                </p>
              )}
            </div>
            <div>
              <SectionLabel>Carbon price relief</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: cpr > 0 ? "var(--color-green)" : "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(cpr)}
              </p>
            </div>
            <div>
              <SectionLabel>Net liability</SectionLabel>
              <p style={{ marginTop: "var(--space-8)", fontSize: "var(--text-lg)", fontWeight: "var(--font-focal)", color: "var(--color-navy)", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(netLiability)}
              </p>
            </div>
          </div>
        </div>

        {/* ══════════════════════ TABS ══════════════════════ */}
        <div style={{ display: "flex", gap: "var(--space-32)", marginBottom: "var(--space-32)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
          {(["details", "audit"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                paddingBottom:    "var(--space-12)",
                fontSize:         "var(--text-sm)",
                fontWeight:       activeTab === tab ? "var(--font-focal)" : "var(--font-body)",
                color:            activeTab === tab ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                background:       "none",
                border:           "none",
                borderBottom:     activeTab === tab ? "2px solid var(--color-navy)" : "2px solid transparent",
                marginBottom:     "-1px",
                cursor:           "pointer",
                fontFamily:       "inherit",
                textTransform:    "capitalize",
                transition:       "color 100ms",
              }}
            >
              {tab === "details" ? "Details" : "Audit chain"}
            </button>
          ))}
        </div>

        {/* ══════════════════════ DETAILS TAB ══════════════════════ */}
        {activeTab === "details" && (
          <div>

            {/* Goods lines */}
            <div style={{ marginBottom: "var(--space-8)" }}>
              <SectionLabel>Goods lines</SectionLabel>
            </div>
            <div style={{ marginBottom: "var(--space-40)" }}>
              <GoodsLineTable lines={goods_lines} />
            </div>

            <Divider />

            {/* 10-field CBAM document fields — pre-filled from extraction, asterisk if missing */}
            <DocumentFieldsPanel case_={case_} />

            {/* Case metadata */}
            <div style={{ marginBottom: "var(--space-16)" }}>
              <SectionLabel>Case details</SectionLabel>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-24)", marginBottom: "var(--space-40)" }}>
              {[
                ["Importer",      case_.importer_name || "—"],
                ["Period",        `Q${case_.reporting_quarter} ${case_.reporting_year}`],
                ["Import date",   fmtDate(importDate)],
                ["Status",        statusLabel(case_.status)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p style={{ fontSize: "var(--text-xs)", fontWeight: "var(--font-focal)", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                    {label}
                  </p>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <Divider />

            {/* Actions */}
            <div>
              {actionDone === "approved" && (
                <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-primary)" }}>
                  Case approved.{" "}
                  <Link href="/" style={{ color: "var(--color-navy)" }}>← Cases</Link>
                </p>
              )}

              {actionDone === "flagged" && (
                <p style={{ fontSize: "var(--text-base)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                  Flag submitted.{" "}
                  <Link href="/" style={{ color: "var(--color-text-secondary)" }}>← Cases</Link>
                </p>
              )}

              {!actionDone && !isAdmin && (
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)" }}>
                  You have view-only access. Contact your admin to approve cases.
                </p>
              )}

              {!actionDone && isAdmin && isPending && (
                <div>
                  <div style={{ display: "flex", gap: "var(--space-16)", flexWrap: "wrap" }}>
                    <Button variant="primary" loading={actioning && !showFlagForm} onClick={handleApprove}>
                      Approve case
                    </Button>
                    <Button variant="secondary" onClick={() => setShowFlagForm((v) => !v)}>
                      Flag for review
                    </Button>
                  </div>

                  {showFlagForm && (
                    <div style={{ marginTop: "var(--space-24)" }}>
                      <textarea
                        rows={3}
                        value={flagText}
                        onChange={(e) => setFlagText(e.target.value)}
                        placeholder="Describe the issue…"
                        style={{
                          width:           "100%",
                          padding:         "var(--space-16)",
                          fontSize:        "var(--text-base)",
                          fontWeight:      "var(--font-body)",
                          fontFamily:      "inherit",
                          color:           "var(--color-text-primary)",
                          backgroundColor: "var(--color-surface)",
                          border:          "var(--border-width) solid var(--color-border)",
                          borderRadius:    "var(--btn-radius)",
                          resize:          "vertical",
                          outline:         "none",
                          boxSizing:       "border-box",
                        }}
                      />
                      <div style={{ marginTop: "var(--space-8)" }}>
                        <Button variant="secondary" loading={actioning && showFlagForm} onClick={handleSendFlag}>
                          Send flag
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!actionDone && isAdmin && isApproved && (
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => { window.location.href = `/api-proxy/ledger/api/cases/${id}/hmrc-return`; }}
                  >
                    Download HMRC return (PDF)
                  </Button>
                  <p style={{ marginTop: "var(--space-16)" }}>
                    <a
                      href={`/api-proxy/ledger/api/cases/${id}/eu-xml`}
                      style={{ fontSize: "var(--text-sm)", fontWeight: "var(--font-body)", color: "var(--color-text-secondary)", textDecoration: "underline" }}
                    >
                      Download EU XML declaration
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════ AUDIT CHAIN TAB ══════════════════════ */}
        {activeTab === "audit" && (
          <AuditTrailTab caseId={id} />
        )}

      </div>
    </div>
  );
}
